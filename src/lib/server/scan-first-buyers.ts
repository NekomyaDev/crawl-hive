// Первые покупатели (crawler_first_buyers): первые 20 кошельков, купивших токен, через сколько секунд после запуска,
// сколько купили (% эмиссии) и что сделали потом: держат, докупили, продали часть, продали всё или вывели на другой
// кошелёк. Покупатели, отправившие токены на один и тот же кошелёк, склеиваются в группу.
// Сырьё берём у снайперов (scan-snipers*.ts): ранние транзакции уже прочитаны, здесь только дочитываем остаток
// первых сделок, остатки и исходящие переводы. Solana ходит через общий ограничитель RPC (rpc-limit.ts) и тратит на
// исходящие переводы не больше TRACE_WALLETS кошельков по TRACE_TXS транзакций. Чего не видно, помечаем unknown.
import "server-only";
import { PublicKey, type Connection } from "@solana/web3.js";
import { createPublicClient, http, parseAbi, parseAbiItem, type Hex } from "viem";
import { buysIn, deltas, type EarlyBuy, type SniperReport } from "./scan-snipers";
import { evmLogsRpc, evmOwnLogs } from "./scan-snipers-evm";

export type BuyerStatus = "holding" | "added" | "sold_part" | "sold_all" | "moved" | "unknown";
export interface FirstBuyer {
  wallet: string;
  afterSec?: number; // через сколько секунд после запуска купил
  boughtPct: number; // сколько купил в окне, % эмиссии
  leftPct?: number; // сколько держит сейчас; нет, если остаток прочитать не вышло
  status: BuyerStatus;
  to?: string; // куда вывел токены (крупнейший получатель-кошелёк)
  group?: number; // номер группы: несколько покупателей вывели на один кошелёк
}
export interface FirstBuyersReport {
  buyers: FirstBuyer[];
  groups: { to: string; wallets: number }[]; // группа: кошелёк-получатель и сколько первых покупателей на него вывели
  window: string; // какое окно запуска покрыто
  partial?: boolean; // исходящие переводы прочитаны не для всех (лимит запросов или глубина логов узла)
}

const MAX_BUYERS = 20;
const TRACE_WALLETS = 10; // Solana: у скольких покупателей ищем, куда ушли токены
const TRACE_TXS = 4; // Solana: сколько транзакций токен-аккаунта разбираем на кошелёк
const EVM_MAX_CHUNKS = 8;
const CACHE_MS = 10 * 60_000;
const BURN = new Set(["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead", "0xdead000000000000000042069420694206942069", "1nc1nerator11111111111111111111111111111111"]);

const g = globalThis as unknown as { __crawlhiveFirstBuyers?: Map<string, { at: number; r: FirstBuyersReport | null }> };
const cache = () => (g.__crawlhiveFirstBuyers ??= new Map());

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

export async function traceFirstBuyers(chain: string, token: string, snipers: SniperReport, opts: { conn?: Connection; supplyRaw?: number; creator?: string }): Promise<FirstBuyersReport | null> {
  const early = snipers.early;
  if (!early) return null;
  const key = `${chain}:${chain === "solana" ? token : token.toLowerCase()}`;
  const hit = cache().get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.r;
  const r = chain === "solana" ? (opts.conn && opts.supplyRaw ? await solana(opts.conn, token, snipers, opts.supplyRaw, opts.creator) : null) : await evm(chain, token, snipers);
  if (cache().size > 3000) cache().clear();
  cache().set(key, { at: Date.now(), r });
  return r;
}

// Покупки по порядку -> первые MAX_BUYERS кошельков с суммой покупок в окне.
function firstWallets(buys: EarlyBuy[]) {
  const by = new Map<string, EarlyBuy & { total: number }>();
  for (const b of buys) {
    const cur = by.get(b.wallet);
    if (cur) cur.total += b.pct;
    else if (by.size < MAX_BUYERS) by.set(b.wallet, { ...b, total: b.pct });
  }
  return [...by.values()];
}

// Итог по кошельку: что видно по остатку и исходящим переводам. Без данных о переводах падение остатка не трактуем.
function statusOf(bought: number, left: number | undefined, out: { sold: number; moved: number } | undefined): BuyerStatus {
  if (left === undefined) return "unknown";
  if (left > bought * 1.02) return "added";
  if (left >= bought * 0.98) return "holding";
  if (!out || out.sold + out.moved <= 0) return "unknown";
  if (out.moved > out.sold) return "moved";
  return left <= bought * 0.005 ? "sold_all" : "sold_part";
}

// Группы: покупатели, которые вывели токены на один кошелёк (или на другого первого покупателя).
function grouped(list: FirstBuyer[]): { buyers: FirstBuyer[]; groups: FirstBuyersReport["groups"] } {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  for (const b of list) if (b.to) parent.set(find(b.wallet), find(b.to));
  const members = new Map<string, string[]>();
  for (const b of list) {
    const r = find(b.wallet);
    members.set(r, [...(members.get(r) ?? []), b.wallet]);
  }
  const groups: FirstBuyersReport["groups"] = [];
  const num = new Map<string, number>();
  for (const [root, ws] of members) {
    if (ws.length < 2) continue;
    num.set(root, groups.length + 1);
    groups.push({ to: root, wallets: ws.length });
  }
  return { buyers: list.map((b) => (num.has(find(b.wallet)) ? { ...b, group: num.get(find(b.wallet)) } : b)), groups };
}

const afterSec = (at: number | undefined, birthAt: number | undefined) => (at && birthAt ? Math.max(0, Math.round((at - birthAt) / 1000)) : undefined);

// ---------- Solana ----------
async function solana(conn: Connection, mint: string, s: SniperReport, supplyRaw: number, creator?: string): Promise<FirstBuyersReport | null> {
  const early = s.early!;
  // Ранние подписи, которые снайперы не разбирали (вне первых слотов): дочитываем, по 4 одновременно.
  const pend = early.pending ?? [];
  const txs = await pool(pend, 4, (p) => conn.getParsedTransaction(p.sig, { maxSupportedTransactionVersion: 0 }).catch(() => null));
  const order = new Map<string, number>();
  [...early.buys.map((b) => b.sig ?? ""), ...pend.map((p) => p.sig)].forEach((sig, i) => order.has(sig) || order.set(sig, i));
  const more = pend.flatMap((p, i) => (txs[i] ? buysIn(txs[i]!, mint, supplyRaw, creator).map((b) => ({ ...b, sig: p.sig, at: p.at })) : []));
  // По времени, внутри одного времени по порядку подписей.
  const buys = [...early.buys, ...more].sort((a, b) => (a.at ?? 0) - (b.at ?? 0) || (order.get(a.sig ?? "") ?? 0) - (order.get(b.sig ?? "") ?? 0));
  const first = firstWallets(buys);
  if (!first.length) return null;

  // Остатки: у снайперов они уже есть, остальным читаем токен-аккаунты.
  const known = new Map((s.buyers ?? []).map((b) => [b.wallet, b.leftPct]));
  const key = new PublicKey(mint);
  const left = await pool(first, 4, async (b) => {
    if (known.has(b.wallet)) return known.get(b.wallet);
    const res = await conn.getParsedTokenAccountsByOwner(new PublicKey(b.wallet), { mint: key }).catch(() => null);
    if (!res) return undefined;
    const raw = res.value.reduce((x, a) => x + Number((a.account.data as { parsed?: { info?: { tokenAmount?: { amount?: string } } } }).parsed?.info?.tokenAmount?.amount ?? 0), 0);
    return (raw / supplyRaw) * 100;
  });

  // Куда ушли токены: у крупнейших покупателей с уменьшившимся остатком разбираем первые транзакции после покупки.
  // Получатель-программа (кривая, пул) значит продажу, получатель-кошелёк значит вывод.
  const drop = first.map((b, i) => ({ b, i })).filter(({ b, i }) => left[i] !== undefined && left[i]! < b.total * 0.98 && b.account);
  const traced = drop.sort((x, y) => y.b.total - x.b.total).slice(0, TRACE_WALLETS);
  const outs = new Map<number, { sold: number; moved: number; to?: string }>();
  await pool(traced, 2, async ({ b, i }) => {
    const sigs = await conn.getSignaturesForAddress(new PublicKey(b.account!), { limit: 20 }).catch(() => null);
    if (!sigs) return;
    const list = sigs.filter((x) => !x.err && x.signature !== b.sig).reverse().slice(0, TRACE_TXS);
    const out = { sold: 0, moved: 0, to: undefined as string | undefined };
    const dest = new Map<string, number>();
    for (const x of list) {
      const tx = await conn.getParsedTransaction(x.signature, { maxSupportedTransactionVersion: 0 }).catch(() => null);
      if (!tx) continue;
      const d = deltas(tx, mint);
      const mine = d.get(b.wallet) ?? 0;
      if (mine >= 0) continue;
      const got = [...d].filter(([o, v]) => v > 0 && o !== b.wallet && !BURN.has(o));
      const amount = (-mine / supplyRaw) * 100;
      if (got.some(([o]) => !PublicKey.isOnCurve(new PublicKey(o).toBytes()))) out.sold += amount;
      else if (got.length) {
        out.moved += amount;
        const [to] = got.sort((p, q) => q[1] - p[1])[0];
        dest.set(to, (dest.get(to) ?? 0) + amount);
      }
    }
    out.to = [...dest].sort((p, q) => q[1] - p[1])[0]?.[0];
    outs.set(i, out);
  });

  const list: FirstBuyer[] = first.map((b, i) => {
    const o = outs.get(i);
    const status = statusOf(b.total, left[i], o);
    return {
      wallet: b.wallet,
      afterSec: afterSec(b.at, early.birthAt),
      boughtPct: Math.round(b.total * 100) / 100,
      ...(left[i] !== undefined ? { leftPct: Math.round(left[i]! * 100) / 100 } : {}),
      status,
      ...(status === "moved" && o?.to ? { to: o.to } : {}),
    };
  });
  return { ...grouped(list), window: early.window, ...(drop.length > traced.length ? { partial: true } : {}) };
}

// ---------- EVM ----------
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function totalSupply() view returns (uint256)"]);
// Сколько блоков узел отдаёт за один запрос логов с фильтром по отправителю (как у снайперов и бабл-карты).
const CHUNK: Record<string, bigint> = { robinhood: 9_999_999n };

async function evm(chain: string, token: string, s: SniperReport): Promise<FirstBuyersReport | null> {
  const early = s.early!;
  const url = evmLogsRpc(chain);
  const first = firstWallets(early.buys);
  if (!url || !first.length) return null;
  const c = createPublicClient({ transport: http(url, { timeout: 12_000 }) });
  const supply = await c.readContract({ address: token as Hex, abi: ERC20, functionName: "totalSupply" }).catch(() => 0n);
  if (!supply) return null;
  const pct = (x: bigint) => Number((x * 100_000_000n) / supply) / 1_000_000;
  const left = await Promise.all(
    first.map((b) =>
      c
        .readContract({ address: token as Hex, abi: ERC20, functionName: "balanceOf", args: [b.wallet as Hex] })
        .then(pct)
        .catch(() => undefined),
    ),
  );

  // Исходящие переводы первых покупателей от первой покупки до текущего блока, кусками; глубже лимита не идём.
  const head = await c.getBlockNumber();
  const chunk = CHUNK[chain] ?? (evmOwnLogs(chain) ? 9_999n : 5_000n);
  const from = BigInt(early.fromBlock ?? Number(head));
  const wallets = first.map((b) => b.wallet as Hex);
  type Out = { from: string; to: string; value: bigint };
  const logs: Out[] = [];
  let covered = true;
  let b = from;
  for (let n = 0; b <= head; b += chunk, n++) {
    if (n >= EVM_MAX_CHUNKS) {
      covered = false;
      break;
    }
    const part = await c.getLogs({ address: token as Hex, event: TRANSFER, args: { from: wallets }, fromBlock: b, toBlock: b + chunk - 1n > head ? head : b + chunk - 1n }).catch(() => null);
    if (!part) {
      covered = false; // узел не отдал этот кусок: дальше не знаем
      break;
    }
    for (const l of part) logs.push({ from: (l.args.from ?? "").toLowerCase(), to: (l.args.to ?? "").toLowerCase(), value: l.args.value ?? 0n });
  }
  // Получатель-контракт (пул, кривая, роутер) значит продажу, кошелёк (в том числе с делегированием EIP-7702) значит вывод.
  const sources = new Set(early.sources ?? []);
  const dests = [...new Set(logs.map((l) => l.to).filter((t) => !sources.has(t) && !BURN.has(t)))].slice(0, 60);
  const codes = await Promise.all(dests.map((d) => c.getCode({ address: d as Hex }).catch(() => undefined)));
  const isWallet = new Map(dests.map((d, i) => [d, !codes[i] || codes[i] === "0x" || codes[i]!.startsWith("0xef0100")]));
  const outs = new Map<string, { sold: number; moved: number; dest: Map<string, number> }>();
  for (const l of logs) {
    if (l.to === l.from || BURN.has(l.to)) continue;
    const o = outs.get(l.from) ?? { sold: 0, moved: 0, dest: new Map() };
    const v = pct(l.value);
    if (sources.has(l.to) || isWallet.get(l.to) === false) o.sold += v;
    else if (isWallet.get(l.to)) {
      o.moved += v;
      o.dest.set(l.to, (o.dest.get(l.to) ?? 0) + v);
    }
    outs.set(l.from, o);
  }

  const list: FirstBuyer[] = first.map((b, i) => {
    const o = outs.get(b.wallet);
    // Перевод мог не попасть в прочитанные куски: без полного покрытия отсутствие переводов ничего не значит.
    const status = statusOf(b.total, left[i], o ?? (covered ? { sold: 0, moved: 0 } : undefined));
    const to = o ? [...o.dest].sort((p, q) => q[1] - p[1])[0]?.[0] : undefined;
    return {
      wallet: b.wallet,
      afterSec: afterSec(b.at, early.birthAt),
      boughtPct: Math.round(b.total * 100) / 100,
      ...(left[i] !== undefined ? { leftPct: Math.round(left[i]! * 100) / 100 } : {}),
      status,
      ...(status === "moved" && to ? { to } : {}),
    };
  });
  return { ...grouped(list), window: early.window, ...(covered ? {} : { partial: true }) };
}
