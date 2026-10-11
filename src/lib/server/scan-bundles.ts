// Связанные кошельки (bundles): кто профинансировал крупнейших держателей. Если несколько топ-кошельков
// получили первый SOL с одного адреса или их первую транзакцию оплатил один и тот же кошелёк (или один
// держатель пополнил другого), это, скорее всего, один
// человек, который раскидал покупку по кошелькам. Пулы и кривые pump.fun — адреса программ (вне кривой
// ed25519), их пропускаем. Биржи тоже раздают SOL тысячам людей, поэтому «спонсора» с огромным балансом
// не считаем связью.
import "server-only";
import { PublicKey, type Connection, type ParsedInstruction, type ParsedTransactionWithMeta } from "@solana/web3.js";

export interface HolderAccount {
  account: string; // токен-аккаунт
  pct: number; // доля от эмиссии
}

export interface BundleReport {
  checked: number; // сколько кошельков удалось проследить
  clusters: { wallets: number; pct: number; funder: string }[];
  fresh: { wallets: number; pct: number }; // кошельки моложе 3 дней
}

const EXCHANGE_SOL = 5_000; // спонсор с таким балансом — почти наверняка горячий кошелёк биржи
const FRESH_MS = 3 * 86400_000;
const MAX_WALLETS = 12;

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

// Кто первым прислал SOL на кошелёк и когда это было. Кошельки с историей длиннее 1000 транзакций
// старые и активные — их не трассируем (и они точно не свежие).
async function firstFunding(conn: Connection, wallet: string): Promise<{ funder?: string; firstAt?: number } | null> {
  const sigs = await conn.getSignaturesForAddress(new PublicKey(wallet), { limit: 1000 });
  if (!sigs.length || sigs.length >= 1000) return null;
  const oldest = sigs[sigs.length - 1];
  const tx = await conn.getParsedTransaction(oldest.signature, { maxSupportedTransactionVersion: 0 });
  const firstAt = (oldest.blockTime ?? tx?.blockTime ?? 0) * 1000 || undefined;
  return { funder: tx ? funderOf(tx, wallet) : undefined, firstAt };
}

// Спонсор — кто прислал SOL в первой транзакции. Если перевода нет, но комиссию за эту транзакцию
// заплатил чужой кошелёк, он и управляет этим: так бандлеры заводят десятки кошельков одной подписью.
function funderOf(tx: ParsedTransactionWithMeta, wallet: string): string | undefined {
  const payer = tx.transaction.message.accountKeys.find((k) => k.signer)?.pubkey.toBase58();
  return transferInto(tx, wallet) ?? (payer && payer !== wallet ? payer : undefined);
}

function transferInto(tx: ParsedTransactionWithMeta, wallet: string): string | undefined {
  const all = [
    ...tx.transaction.message.instructions,
    ...(tx.meta?.innerInstructions ?? []).flatMap((x) => x.instructions),
  ] as ParsedInstruction[];
  for (const ix of all) {
    if (ix.program !== "system") continue;
    const info = (ix.parsed as { type?: string; info?: Record<string, string> })?.info;
    const type = (ix.parsed as { type?: string })?.type;
    if (!info) continue;
    if ((type === "transfer" || type === "transferWithSeed") && info.destination === wallet) return info.source;
    if (type === "createAccount" && info.newAccount === wallet) return info.source;
  }
  return undefined;
}

export async function traceBundles(conn: Connection, holders: HolderAccount[]): Promise<BundleReport> {
  // Токен-аккаунт → владелец. Владельцы-программы (пулы, кривые, локеры) отбрасываем.
  // Пачками по 5: бесплатный план QuickNode не даёт больше за один getMultipleAccounts.
  const keys = holders.map((h) => new PublicKey(h.account));
  const chunks = Array.from({ length: Math.ceil(keys.length / 5) }, (_, i) => keys.slice(i * 5, i * 5 + 5));
  const infos = (await Promise.all(chunks.map((c) => conn.getMultipleParsedAccounts(c)))).flatMap((r) => r.value);
  const pctBy = new Map<string, number>();
  infos.forEach((acc, i) => {
    const owner = (acc?.data as { parsed?: { info?: { owner?: string } } })?.parsed?.info?.owner;
    if (!owner || !PublicKey.isOnCurve(new PublicKey(owner).toBytes())) return;
    pctBy.set(owner, (pctBy.get(owner) ?? 0) + holders[i].pct);
  });
  const wallets = [...pctBy.keys()].slice(0, MAX_WALLETS);

  const traced = await pool(wallets, 4, (w) => firstFunding(conn, w).catch(() => null));
  const now = Date.now();
  const fresh = { wallets: 0, pct: 0 };
  const funderOf = new Map<string, string>();
  traced.forEach((t, i) => {
    if (!t) return;
    if (t.firstAt && now - t.firstAt < FRESH_MS) {
      fresh.wallets++;
      fresh.pct += pctBy.get(wallets[i]) ?? 0;
    }
    if (t.funder) funderOf.set(wallets[i], t.funder);
  });

  // Спонсоры, общие хотя бы для двух держателей или сами держатели. Проверяем, не биржа ли это.
  const count = new Map<string, number>();
  for (const f of funderOf.values()) count.set(f, (count.get(f) ?? 0) + 1);
  const candidates = [...count.keys()].filter((f) => (count.get(f) ?? 0) > 1 || pctBy.has(f));
  const balances = await pool(candidates, 4, (f) => conn.getBalance(new PublicKey(f)).catch(() => 0));
  const exchange = new Set(candidates.filter((_, i) => balances[i] / 1e9 > EXCHANGE_SOL));

  // Объединение: держатель ↔ его спонсор. Кластер — компонента, где не меньше двух держателей.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  for (const [w, f] of funderOf) if (candidates.includes(f) && !exchange.has(f)) parent.set(find(w), find(f));
  const groups = new Map<string, string[]>();
  for (const w of wallets) {
    const r = find(w);
    groups.set(r, [...(groups.get(r) ?? []), w]);
  }
  const clusters = [...groups.entries()]
    .filter(([, ws]) => ws.length > 1)
    .map(([root, ws]) => ({ wallets: ws.length, pct: ws.reduce((s, w) => s + (pctBy.get(w) ?? 0), 0), funder: root }))
    .sort((a, b) => b.pct - a.pct);

  return { checked: traced.filter(Boolean).length, clusters, fresh };
}
