// Снайперы в EVM-сетях (Robinhood Chain, BNB Chain, Base): кто купил токен в первые секунды после создания и сколько держит сейчас.
// Выпуск ищем назад от времени пары (DexScreener), до 6 часов: у лаунчпадов с кривой пара появляется при переезде в пул.
// Покупки — переводы токена от кривой лаунчпада или пула за 5 секунд с первой продажи; создатель (отправитель
// транзакции выпуска) не считается. Остатки — balanceOf. Узел Robinhood отдаёт логи за любое время. Для BNB и Base по умолчанию
// publicnode: логи он отдаёт только примерно за последние 8 800 блоков (BNB около часа, Base около пяти часов), поэтому
// без своего RPC (BSC_LOGS_RPC_URL, BASE_LOGS_RPC_URL) снайперы там считаются только у самых свежих токенов.
import "server-only";
import { createPublicClient, http, parseAbi, parseAbiItem, type Hex } from "viem";
import type { SniperReport } from "./scan-snipers";

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function totalSupply() view returns (uint256)"]);
const ZERO = "0x0000000000000000000000000000000000000000";
// Uniswap v4 держит все пулы в одном контракте PoolManager: у таких пар вместо адреса id пула, покупки идут от него.
const V4_POOL_MANAGER: Record<string, string> = {
  base: "0x498581ff718922c3f8e6a244956af099b2652b2b",
  bsc: "0x28e2ea090877bf75740558f6bfb36a5ffee9e9df",
  robinhood: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
};
// Сколько блоков узел отдаёт за один запрос логов и как далеко назад от пары ищем выпуск.
const LOG_CHUNK: Record<string, bigint> = { robinhood: 99_999n };
const MINT_BACK_SEC = 6 * 3600;
const WINDOW_SEC = 5;
const MAX_WALLETS = 20;
const CACHE_MS = 30 * 60_000;

const RPC: Record<string, () => string | undefined> = {
  robinhood: () => process.env.ROBINHOOD_RPC_URL?.trim() || "https://rpc.mainnet.chain.robinhood.com",
  bsc: () => process.env.BSC_LOGS_RPC_URL?.trim() || "https://bsc-rpc.publicnode.com",
  base: () => process.env.BASE_LOGS_RPC_URL?.trim() || "https://base-rpc.publicnode.com",
};
export const evmSnipersSupported = (chain: string) => !!RPC[chain]?.();
// Узел с логами для сети (тот же, что у снайперов): им пользуется и бабл-карта EVM.
export const evmLogsRpc = (chain: string) => RPC[chain]?.();
export const evmOwnLogs = (chain: string) => !OWN_LOGS[chain] || !!process.env[OWN_LOGS[chain]]?.trim();
// До какого возраста токена хватает глубины логов узла: свой RPC — трое суток, publicnode — с запасом от предела.
const OWN_LOGS: Record<string, string> = { bsc: "BSC_LOGS_RPC_URL", base: "BASE_LOGS_RPC_URL" };
const PUBLIC_MAX_AGE_H: Record<string, number> = { bsc: 0.9, base: 4.5 };
export const evmSnipersMaxAgeH = (chain: string) =>
  OWN_LOGS[chain] && !process.env[OWN_LOGS[chain]]?.trim() ? (PUBLIC_MAX_AGE_H[chain] ?? 72) : 72;

const g = globalThis as unknown as { __crawlhiveEvmSnipers?: Map<string, { at: number; r: SniperReport | null }> };
const cache = () => (g.__crawlhiveEvmSnipers ??= new Map());

export async function traceEvmSnipers(chain: string, token: string, pairCreatedAt?: number, pairAddress?: string): Promise<SniperReport | null> {
  const url = RPC[chain]?.();
  if (!url || !pairCreatedAt) return null;
  const key = `${chain}:${token.toLowerCase()}`;
  const hit = cache().get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.r;
  const p = pairAddress?.toLowerCase();
  const r = await read(url, token as Hex, pairCreatedAt, p && !/^0x[0-9a-f]{40}$/.test(p) ? V4_POOL_MANAGER[chain] : p, LOG_CHUNK[chain] ?? 5_000n);
  if (r) cache().set(key, { at: Date.now(), r });
  if (cache().size > 3000) cache().clear();
  return r;
}

async function read(url: string, token: Hex, pairCreatedAt: number, pair: string | undefined, chunk: bigint): Promise<SniperReport | null> {
  const c = createPublicClient({ transport: http(url, { timeout: 12_000 }) });
  const head = await c.getBlock();
  const past = await c.getBlock({ blockNumber: head.number - 10_000n });
  const blockSec = Number(head.timestamp - past.timestamp) / 10_000;
  // Узлы BNB и Base (publicnode) отвергают запрос, если окно заходит дальше последнего блока.
  const upTo = (b: bigint) => (b > head.number ? head.number : b);
  // Время пары у DexScreener — не всегда запуск: у лаунчпадов с кривой (Pons) это переезд в пул, иногда через десятки
  // минут торгов. Поэтому выпуск (первый Transfer с нулевого адреса) ищем назад от пары, до MINT_BACK_SEC.
  const pairBlock = head.number - BigInt(Math.ceil((Number(head.timestamp) - pairCreatedAt / 1000) / blockSec));
  const stop = pairBlock - BigInt(Math.ceil(MINT_BACK_SEC / blockSec));
  let mint: { block: bigint; to: Hex; tx: Hex } | null = null;
  for (let b = upTo(pairBlock + BigInt(Math.ceil(120 / blockSec))); b > stop && !mint; b -= chunk) {
    const logs = await c.getLogs({ address: token, event: TRANSFER, args: { from: ZERO }, fromBlock: b - chunk + 1n, toBlock: b }).catch(() => null);
    if (!logs) break; // узел не отдаёт логи так глубоко
    const first = logs[0];
    if (first) mint = { block: first.blockNumber, to: first.args.to as Hex, tx: first.transactionHash };
  }
  if (!mint) return null;
  const creator = (await c.getTransaction({ hash: mint.tx })).from.toLowerCase();
  const window = BigInt(Math.ceil(WINDOW_SEC / blockSec));
  const span = BigInt(Math.ceil(900 / blockSec));
  // Откуда идут покупки. Выпуск на контракт (кривая лаунчпада) — продаёт он, а после переезда и пул. Выпуск на кошелёк
  // дева — дев раздаёт и заливает ликвидность сам, покупки идут из пула: тогда считаем только пул.
  const mintTo = mint.to.toLowerCase();
  const curve = ((await c.getCode({ address: mint.to }).catch(() => undefined)) ?? "0x") !== "0x";
  const sources = new Set<string>([...(curve ? [mintTo] : []), ...(pair ? [pair] : [])]);
  if (!sources.size) sources.add(mintTo);
  const skip = (t: string) => !t || t === creator || t === ZERO || sources.has(t);
  // Отсчёт окна — с первой продажи постороннему адресу, а не с выпуска.
  const early = await c.getLogs({ address: token, event: TRANSFER, fromBlock: mint.block, toBlock: upTo(mint.block + span) }).catch(() => []);
  const firstSale = early.find((l) => sources.has((l.args.from ?? "").toLowerCase()) && !skip((l.args.to ?? "").toLowerCase()));
  if (!firstSale) return null;
  const start = firstSale.blockNumber;
  const logs = await c.getLogs({ address: token, event: TRANSFER, fromBlock: start, toBlock: upTo(start + window) });
  const bought = new Map<string, bigint>();
  for (const l of logs) {
    const f = (l.args.from ?? "").toLowerCase();
    const t = (l.args.to ?? "").toLowerCase();
    if (!sources.has(f) || skip(t)) continue;
    bought.set(t, (bought.get(t) ?? 0n) + (l.args.value ?? 0n));
  }
  const supply = await c.readContract({ address: token, abi: ERC20, functionName: "totalSupply" });
  if (!supply) return null;
  const buyers = [...bought.entries()].sort((a, b) => (b[1] > a[1] ? 1 : -1)).slice(0, MAX_WALLETS);
  // Кошельки-контракты (роутеры, агрегаторы) не снайперы: отсекаем адреса с кодом.
  const codes = await Promise.all(buyers.map(([w]) => c.getCode({ address: w as Hex }).catch(() => undefined)));
  const eoa = buyers.filter((_, i) => !codes[i] || codes[i] === "0x");
  const left = await Promise.all(eoa.map(([w]) => c.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [w as Hex] }).catch(() => 0n)));
  const pct = (x: bigint) => Number((x * 1_000_000n) / supply) / 10_000; // доля в процентах, два знака
  return {
    wallets: eoa.length,
    boughtPct: pct(eoa.reduce((s, [, v]) => s + v, 0n)),
    holdPct: pct(left.reduce((s, x) => s + x, 0n)),
    sold: left.filter((x) => x === 0n).length,
    slots: WINDOW_SEC,
    buyers: eoa.map(([wallet], i) => ({ wallet, leftPct: pct(left[i]) })),
  };
}
