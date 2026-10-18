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
}

const WINDOW_SLOTS = 2;
const MAX_PAGES = 10; // до 10 000 подписей назад; у более активных токенов до создания не доходим
const MAX_TXS = 40;
const MAX_WALLETS = 20;
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
function deltas(tx: ParsedTransactionWithMeta, mint: string) {
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
  let oldest: { signature: string; slot: number; err: unknown }[] = [];
  let reached = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const sigs = await conn.getSignaturesForAddress(key, { limit: 1000, before });
    if (!sigs.length) {
      reached = true;
      break;
    }
    oldest = sigs;
    if (sigs.length < 1000) {
      reached = true;
      break;
    }
    before = sigs[sigs.length - 1].signature;
  }
  if (!reached || !oldest.length) return null; // история длиннее окна — не дошли до создания
  const birth = oldest[oldest.length - 1].slot;
  const early = oldest
    .filter((s) => !s.err && s.slot <= birth + WINDOW_SLOTS)
    .slice(-MAX_TXS)
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
  const buyers = [...bought.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_WALLETS);
  if (!buyers.length) return { wallets: 0, boughtPct: 0, holdPct: 0, sold: 0, slots: WINDOW_SLOTS, buyers: [] };

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
  };
}
