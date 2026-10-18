// Снайперы в EVM-сетях (Robinhood Chain, BNB Chain, Base): кто купил токен в первые секунды после создания и сколько держит сейчас.
// Блок рождения ищем по времени пары (DexScreener) и первому Transfer с нулевого адреса; покупки — переводы токена
// от адреса, получившего эмиссию (кривая лаунчпада или пул), за первые 5 секунд; создатель (отправитель транзакции
// выпуска) не считается. Остатки — balanceOf. Узел Robinhood отдаёт логи за любое время. Для BNB и Base по умолчанию
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
};
const WINDOW_SEC = 5;
const MAX_WALLETS = 20;
const CACHE_MS = 30 * 60_000;

const RPC: Record<string, () => string | undefined> = {
  robinhood: () => process.env.ROBINHOOD_RPC_URL?.trim() || "https://rpc.mainnet.chain.robinhood.com",
  bsc: () => process.env.BSC_LOGS_RPC_URL?.trim() || "https://bsc-rpc.publicnode.com",
  base: () => process.env.BASE_LOGS_RPC_URL?.trim() || "https://base-rpc.publicnode.com",
};
export const evmSnipersSupported = (chain: string) => !!RPC[chain]?.();
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
  const r = await read(url, token as Hex, pairCreatedAt, p && !/^0x[0-9a-f]{40}$/.test(p) ? V4_POOL_MANAGER[chain] : p);
  if (r) cache().set(key, { at: Date.now(), r });
  if (cache().size > 3000) cache().clear();
  return r;
}

async function read(url: string, token: Hex, pairCreatedAt: number, pair?: string): Promise<SniperReport | null> {
  const c = createPublicClient({ transport: http(url, { timeout: 12_000 }) });
  // Оценка блока по времени: средняя длина блока по последним 10 000 блокам. Токен часто выпускают за несколько минут
  // до создания пула, поэтому начинаем за 10 минут до пары и ищем выпуск в окне 15 минут.
  const head = await c.getBlock();
  const past = await c.getBlock({ blockNumber: head.number - 10_000n });
  const blockSec = Number(head.timestamp - past.timestamp) / 10_000;
  const back = BigInt(Math.ceil((Number(head.timestamp) - pairCreatedAt / 1000 + 600) / blockSec));
  let from = head.number - back;
  // Узлы BNB и Base (publicnode) отвергают запрос, если окно заходит дальше последнего блока.
  const upTo = (b: bigint) => (b > head.number ? head.number : b);
  const span = BigInt(Math.ceil(900 / blockSec));
  const chunk = 5_000n;
  let mint: { block: bigint; to: Hex; tx: Hex } | null = null;
  for (let b = from; b < from + span && b <= head.number && !mint; b += chunk) {
    const logs = await c.getLogs({ address: token, event: TRANSFER, args: { from: ZERO }, fromBlock: b, toBlock: upTo(b + chunk - 1n) });
    const first = logs[0];
    if (first) mint = { block: first.blockNumber, to: first.args.to as Hex, tx: first.transactionHash };
  }
  if (!mint) return null;
  const creator = (await c.getTransaction({ hash: mint.tx })).from.toLowerCase();
  const window = BigInt(Math.ceil(WINDOW_SEC / blockSec));
  // Торговля начинается не с выпуска, а когда эмиссия приходит в пул: у Pons выпуск идёт на служебный контракт,
  // и только через десятки секунд токены переводятся в пул Uniswap. Отсчёт — с пополнения пула, покупки — из пула.
  let start = mint.block;
  let source = mint.to.toLowerCase();
  if (pair) {
    const intoPool = await c.getLogs({ address: token, event: TRANSFER, args: { to: pair as Hex }, fromBlock: mint.block, toBlock: upTo(mint.block + span) });
    if (intoPool[0]) {
      start = intoPool[0].blockNumber;
      source = pair;
    }
  }
  const logs = await c.getLogs({ address: token, event: TRANSFER, fromBlock: start, toBlock: upTo(start + window) });
  const bought = new Map<string, bigint>();
  for (const l of logs) {
    const f = (l.args.from ?? "").toLowerCase();
    const t = (l.args.to ?? "").toLowerCase();
    if (f !== source || !t || t === creator || t === ZERO || t === source) continue;
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
