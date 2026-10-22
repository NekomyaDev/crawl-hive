// Снайперы (crawler_snipers): кто купил токен в первых блоках после создания и сколько у них осталось.
// Источник — сама сеть через наш RPC (Helius в запасе): листаем подписи минта назад до создания, разбираем
// транзакции слота создания и двух следующих (~1 секунда — боты или сам создатель), по изменению токен-балансов
// находим покупателей (создателя не считаем, его доля — в истории разработчика), затем смотрим их текущие остатки.
// Публичное API сделок pump.fun для серверов закрыто Cloudflare, обходить защиту мы не стали.
import "server-only";
import { PublicKey, type Connection, type ParsedTransactionWithMeta } from "@solana/web3.js";

export interface SniperReport {
  wallets: number; // сколько кошельков купили в первых блоках
  boughtPct: number; // сколько они купили, % эмиссии
  holdPct: number; // сколько у них осталось сейчас
  sold: number; // сколько из них уже всё продали
  slots: number; // окно в слотах после создания
  buyers?: { wallet: string; leftPct: number }[]; // для «операторов» и памяти кошельков; из ответа API убирается
  early?: EarlyBuys; // сырьё для блока «первые покупатели» (scan-first-buyers.ts); из ответа API убирается
}

// Первые покупки по порядку: кто, когда, сколько (% эмиссии, без округления). Solana: разобранные транзакции и
// подписи, которые ещё не разобрали (их дочитывает scan-first-buyers, чтобы не замедлять снайперов). EVM: всё готово.
export interface EarlyBuy {
  wallet: string;
  pct: number;
  at?: number; // время покупки, мс
  sig?: string; // транзакция первой покупки
  account?: string; // Solana: токен-аккаунт покупателя (по нему ищем, куда ушли токены)
  block?: number; // EVM: блок первой покупки
}
export interface EarlyBuys {
  birthAt?: number; // время запуска, мс
  buys: EarlyBuy[]; // по порядку, по одной записи на покупку
  pending?: { sig: string; at?: number }[]; // Solana: ранние подписи, ещё не разобранные
  sources?: string[]; // EVM: кривая и пул, откуда идут покупки (перевод туда значит продажу)
  fromBlock?: number; // EVM: с какого блока искать исходящие переводы
  window: string; // какое окно покрыто, словами для интерфейса
}

const WINDOW_SLOTS = 2;
const MAX_PAGES = 10; // до 10 000 подписей назад; у более активных токенов до создания не доходим
const MAX_TXS = 40;
const MAX_WALLETS = 20;
const FIRST_TXS = 30; // сколько первых сделок смотрим для «первых покупателей»
const CACHE_MS = 30 * 60_000;

const g = globalThis as unknown as { __crawlhiveSnipers?: Map<string, { at: number; r: SniperReport | null }> };
const cache = () => (g.__crawlhiveSnipers ??= new Map());

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

// Изменение баланса этого минта по владельцам в одной транзакции.
export function deltas(tx: ParsedTransactionWithMeta, mint: string) {
  const out = new Map<string, number>();
  const add = (owner: string | undefined, raw: string | undefined, sign: number) => {
    if (!owner || !raw) return;
    out.set(owner, (out.get(owner) ?? 0) + sign * Number(raw));
  };
  for (const b of tx.meta?.preTokenBalances ?? []) if (b.mint === mint) add(b.owner, b.uiTokenAmount.amount, -1);
  for (const b of tx.meta?.postTokenBalances ?? []) if (b.mint === mint) add(b.owner, b.uiTokenAmount.amount, 1);
  return out;
}

export async function traceSnipers(conn: Connection, mint: string, supplyRaw: number, creator?: string): Promise<SniperReport | null> {
  const hit = cache().get(mint);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.r;
  const r = await readSnipers(conn, mint, supplyRaw, creator);
  if (r) cache().set(mint, { at: Date.now(), r });
  if (cache().size > 3000) cache().clear();
  return r;
}

async function readSnipers(conn: Connection, mint: string, supplyRaw: number, creator?: string): Promise<SniperReport | null> {
  if (!supplyRaw) return null;
  const key = new PublicKey(mint);
  let before: string | undefined;
  let oldest: { signature: string; slot: number; err: unknown; blockTime?: number | null }[] = [];
  let prev: typeof oldest = []; // страница перед самой старой: если та короткая, ранние сделки лежат и здесь
  let reached = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const sigs = await conn.getSignaturesForAddress(key, { limit: 1000, before });
    if (!sigs.length) {
      reached = true;
      break;
    }
    prev = oldest;
    oldest = sigs;
    if (sigs.length < 1000) {
      reached = true;
      break;
    }
    before = sigs[sigs.length - 1].signature;
  }
  if (!reached || !oldest.length) return null; // история длиннее окна — не дошли до создания
  const birthSig = oldest[oldest.length - 1];
  const birth = birthSig.slot;
  // Успешные подписи от самой ранней: снайперы смотрят первые слоты, «первые покупатели» первые FIRST_TXS сделок.
  const ok = [...prev, ...oldest].filter((s) => !s.err).reverse();
  const early = ok
    .filter((s) => s.slot <= birth + WINDOW_SLOTS)
    .slice(0, MAX_TXS)
    .map((s) => s.signature);

  const txs = await pool(early, 4, (sig) => conn.getParsedTransaction(sig, { maxSupportedTransactionVersion: 0 }).catch(() => null));
  const bought = new Map<string, number>();
  for (const tx of txs) {
    if (!tx) continue;
    for (const [owner, d] of deltas(tx, mint)) {
      // Кривые и пулы — адреса программ (вне кривой ed25519), создатель считается отдельно.
      if (d <= 0 || owner === creator || !PublicKey.isOnCurve(new PublicKey(owner).toBytes())) continue;
      bought.set(owner, (bought.get(owner) ?? 0) + d);
    }
  }
  // Сырьё для «первых покупателей»: покупки из уже разобранных транзакций, остальные ранние подписи на потом.
  const at = new Map(ok.map((s) => [s.signature, s.blockTime ? s.blockTime * 1000 : undefined]));
  const parsed = new Set(early);
  const earlyBuys: EarlyBuys = {
    birthAt: birthSig.blockTime ? birthSig.blockTime * 1000 : undefined,
    buys: early.flatMap((sig, i) => (txs[i] ? buysIn(txs[i]!, mint, supplyRaw, creator).map((b) => ({ ...b, sig, at: at.get(sig) })) : [])),
    pending: ok.slice(0, FIRST_TXS).filter((s) => !parsed.has(s.signature)).map((s) => ({ sig: s.signature, at: at.get(s.signature) })),
    window: `first ${Math.min(ok.length, Math.max(FIRST_TXS, early.length))} transactions`,
  };
  const buyers = [...bought.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_WALLETS);
  if (!buyers.length) return { wallets: 0, boughtPct: 0, holdPct: 0, sold: 0, slots: WINDOW_SLOTS, buyers: [], early: earlyBuys };

  const left = await pool(buyers, 4, async ([owner]) => {
    const res = await conn.getParsedTokenAccountsByOwner(new PublicKey(owner), { mint: key }).catch(() => null);
    if (!res) return 0;
    return res.value.reduce((s, a) => s + Number((a.account.data as { parsed?: { info?: { tokenAmount?: { amount?: string } } } }).parsed?.info?.tokenAmount?.amount ?? 0), 0);
  });
  const pctOf = (raw: number) => Math.round((raw / supplyRaw) * 10000) / 100;
  return {
    wallets: bought.size,
    boughtPct: pctOf(buyers.reduce((s, [, d]) => s + d, 0)),
    holdPct: pctOf(left.reduce((s, x) => s + x, 0)),
    sold: left.filter((x) => x === 0).length,
    slots: WINDOW_SLOTS,
    buyers: buyers.map(([wallet], i) => ({ wallet, leftPct: pctOf(left[i]) })).sort((a, b) => b.leftPct - a.leftPct),
    early: earlyBuys,
  };
}

// Покупки в транзакции для «первых покупателей»: токены пришли кошельку, а у кривой или пула (адрес программы)
// убыло. Простой перевод между кошельками покупкой не считаем. Создателя пропускаем, как и у снайперов.
export function buysIn(tx: ParsedTransactionWithMeta, mint: string, supplyRaw: number, creator?: string): EarlyBuy[] {
  if (!supplyRaw) return [];
  const d = deltas(tx, mint);
  const onCurve = (o: string) => PublicKey.isOnCurve(new PublicKey(o).toBytes());
  // Транзакция выпуска (сумма изменений больше нуля: токены отчеканены) тоже считается, в ней кривая только получает.
  const minted = [...d.values()].reduce((a, v) => a + v, 0) > 0;
  if (!minted && ![...d].some(([o, v]) => v < 0 && !onCurve(o))) return [];
  const keys = tx.transaction.message.accountKeys;
  const accountOf = (owner: string) => {
    const b = (tx.meta?.postTokenBalances ?? []).find((x) => x.mint === mint && x.owner === owner);
    return b ? keys[b.accountIndex]?.pubkey.toBase58() : undefined;
  };
  return [...d]
    .filter(([o, v]) => v > 0 && o !== creator && onCurve(o))
    .map(([wallet, v]) => ({ wallet, pct: (v / supplyRaw) * 100, account: accountOf(wallet) }));
}
