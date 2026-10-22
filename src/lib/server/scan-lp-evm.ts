// LP в EVM-сетях по цепочке (crawler_lp): кто может вынуть ликвидность главного пула. На Robinhood Chain GoPlus
// держателей LP не знает, а «чистые» монеты там теряли ликвидность через минуты после скана, поэтому смотрим сами:
// v2 — держатели LP-токена (переводы пары), v3 — позиции пула (Mint) и владелец NFT позиции у NonfungiblePositionManager,
// v4 — позиции пула в PoolManager (ModifyLiquidity по id пула) и владелец NFT у PositionManager (salt = tokenId).
// Держатель: сожжено, локер (известный или контракт с датой лока), контракт лаунчпада без функции вывода, кошелёк
// создателя, просто кошелёк или непонятный контракт. Проверено на настоящих монетах 22.10: Pons (PonsV2) кладёт NFT
// позиции в свой локер 0x2674…4952 без функции вывода — это вечный лок; PB (лаунчер 0x632a…5d40) отдал NFT кошельку
// создателя; у Lovot и FOREVER создатель вынул всю ликвидность через NFT в своём кошельке.
import "server-only";
import { createPublicClient, http, parseAbi, parseAbiItem, toFunctionSelector, type Hex, type PublicClient } from "viem";
import { evmLogsRpc, evmOwnLogs } from "./scan-snipers-evm";

export interface LpControl {
  // кто держит самую крупную долю, которую можно вынуть
  who: "deployer" | "wallet" | "contract";
  address: string;
  pct: number; // % ликвидности главного пула, которую этот держатель может вынуть
  via?: string; // через что: "position NFT", "LP tokens", "holder contract"
}

export interface EvmLpResult {
  status: "burned" | "locked" | "partly" | "unlocked" | "unknown";
  lockedPct: number | null;
  unlockAt?: number;
  locker?: string;
  pool: string; // uniswap v2 / v3 / v4
  pullable?: LpControl;
  removedPct?: number; // сколько из добавленной ликвидности уже вынуто (v3/v4)
}

const ZERO = "0x0000000000000000000000000000000000000000";
const BURN = new Set([ZERO, "0x000000000000000000000000000000000000dead", "0xdead000000000000000000000000000000000000", "0xdead000000000000000042069420694206942069"]);
const V4_POOL_MANAGER: Record<string, string> = {
  base: "0x498581ff718922c3f8e6a244956af099b2652b2b",
  bsc: "0x28e2ea090877bf75740558f6bfb36a5ffee9e9df",
  robinhood: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
};
// Известные локеры: NFT или LP там нельзя забрать. Pons: owner() — владелец PonsV2, factory() — PonsV2,
// функций вывода нет (только lockPosition / lockTokenSupply), проверено по байткоду и монетам DACITY, OBELISK, KOLSHI.
const LOCKERS: Record<string, Record<string, string>> = {
  robinhood: { "0x267444d099b10fb5ed7c3cc7b7c767adca574952": "Pons locker" },
};
const MIN_PCT = 20; // меньшая доля в чужих руках — не повод ронять вердикт

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const V3_MINT = parseAbiItem("event Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)");
const V4_MODIFY = parseAbiItem("event ModifyLiquidity(bytes32 indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)");
const INCREASE = "0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f"; // IncreaseLiquidity(uint256 indexed tokenId,…)
const ABI = parseAbi([
  "function ownerOf(uint256) view returns (address)",
  "function positions(uint256) view returns (uint96, address, address, address, uint24, int24, int24, uint128, uint256, uint256, uint128, uint128)",
  "function totalSupply() view returns (uint256)",
  "function getReserves() view returns (uint112, uint112, uint32)",
  "function owner() view returns (address)",
  "function admin() view returns (address)",
  "function deployer() view returns (address)",
  "function lpOwner() view returns (address)",
  "function creator() view returns (address)",
  "function lockUntil() view returns (uint256)",
  "function unlockTime() view returns (uint256)",
  "function lockedUntil() view returns (uint256)",
  "function unlockDate() view returns (uint256)",
  "function lockBurned() view returns (bool)",
]);

// Функции, через которые контракт-держатель может отдать ликвидность наружу. Ищем их селекторы в байткоде:
// это эвристика, поэтому контракт без них считаем «без вывода» только если он не прокси и не умеет произвольных вызовов.
const REMOVE = [
  "removeLiquidity()", "removeLiquidity(uint256)", "removeLiquidity(uint128)", "withdrawLiquidity()", "withdrawLiquidity(address)", "withdrawLiquidity(uint256)",
  "withdrawLP()", "withdrawLp()", "withdrawLP(address)", "withdrawPosition(uint256)", "withdrawNFT(uint256)", "withdrawNft(uint256)", "unlockLiquidity()",
  "releaseLiquidity()", "release(uint256)", "unlock(uint256)", "emergencyWithdraw()", "emergencyWithdraw(uint256)", "withdraw(uint256)", "withdraw(address,uint256)",
  "withdraw(uint256,address)", "rescueERC721(address,uint256)", "recoverERC721(address,uint256)", "rescueToken(address,uint256)", "recoverToken(address,uint256)",
  "rescueTokens(address,uint256)", "recoverERC20(address,uint256)", "transferPosition(uint256,address)", "transferLock(uint256,address)", "migrate(uint256)",
].map((s) => toFunctionSelector(`function ${s}`).slice(2));
const ARBITRARY = ["execute(address,uint256,bytes)", "execute(address,bytes)", "call(address,uint256,bytes)", "exec(address,uint256,bytes)", "upgradeTo(address)", "upgradeToAndCall(address,bytes)"].map((s) =>
  toFunctionSelector(`function ${s}`).slice(2),
);
const LOCK_GETTERS = ["lockUntil", "unlockTime", "lockedUntil", "unlockDate"] as const;
const LOCK_SEL = LOCK_GETTERS.map((n) => toFunctionSelector(`function ${n}()`).slice(2));
const CONTROLLERS = ["owner", "admin", "deployer", "lpOwner", "creator"] as const;

const CACHE_MS = 10 * 60_000;
const g = globalThis as unknown as { __crawlhiveLpEvm?: Map<string, { at: number; r: EvmLpResult | null }> };
const cache = () => (g.__crawlhiveLpEvm ??= new Map());

export const evmLpSupported = (chain: string) => !!evmLogsRpc(chain);

// Окна логов: узел Robinhood отдаёт 10 млн блоков (около 11 дней) за запрос с фильтром по адресу, publicnode — несколько тысяч.
function windows(chain: string, head: bigint): [bigint, bigint][] {
  const [size, n] = chain === "robinhood" ? [9_999_999n, 1] : evmOwnLogs(chain) ? [9_999n, 3] : [4_000n, 2];
  const out: [bigint, bigint][] = [];
  for (let i = 0, to = head; i < n && to > 0n; i++, to -= size) out.push([to - size + 1n > 0n ? to - size + 1n : 0n, to]);
  return out.reverse();
}

// getLogs по окнам, с одним повтором при ошибке узла; неудача — null (данных нет, а не «пусто»).
async function logs<T>(fn: (from: bigint, to: bigint) => Promise<T[]>, w: [bigint, bigint][]): Promise<T[] | null> {
  const parts = await Promise.all(w.map(([a, b]) => fn(a, b).catch(() => fn(a, b)).catch(() => null)));
  if (parts.some((p) => p === null)) return null;
  return parts.flat() as T[];
}

export async function traceEvmLp(chain: string, token: string, pool: string): Promise<EvmLpResult | null> {
  const url = evmLogsRpc(chain);
  if (!url || !pool) return null;
  const key = `${chain}:${pool.toLowerCase()}`;
  const hit = cache().get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.r;
  const c = createPublicClient({ transport: http(url, { timeout: 8_000, retryCount: 1 }) }) as PublicClient;
  const r = await read(c, chain, token.toLowerCase() as Hex, pool.toLowerCase()).catch((e) => {
    console.warn("[scan] lp evm:", (e as Error).message);
    return null;
  });
  if (cache().size > 3000) cache().clear();
  cache().set(key, { at: Date.now(), r });
  return r;
}

interface Pos {
  holder: string; // кто может вынуть (владелец NFT или сам контракт-держатель)
  liq: bigint; // текущая ликвидность позиции (v2 — баланс LP-токена)
  via: string;
}

async function read(c: PublicClient, chain: string, token: Hex, pool: string): Promise<EvmLpResult | null> {
  const head = await c.getBlockNumber();
  const w = windows(chain, head);
  const deployerP = tokenDeployer(c, token, w);
  let kind: "v2" | "v3" | "v4";
  let positions: Pos[] | null;
  let added = 0n;
  let removed = 0n;
  if (/^0x[0-9a-f]{64}$/.test(pool)) {
    kind = "v4";
    const pm = V4_POOL_MANAGER[chain];
    if (!pm) return null;
    const ev = await logs((a, b) => c.getLogs({ address: pm as Hex, event: V4_MODIFY, args: { id: pool as Hex }, fromBlock: a, toBlock: b }), w);
    if (!ev?.length) return null; // пул создан раньше окна или узел не ответил
    // Позиция v4 — (sender, тики, salt). У PositionManager salt = tokenId, владелец — ownerOf(tokenId).
    const net = new Map<string, { sender: string; salt: Hex; liq: bigint }>();
    for (const l of ev) {
      const d = l.args.liquidityDelta ?? 0n;
      if (d > 0n) added += d;
      else removed -= d;
      const k = `${l.args.sender}:${l.args.tickLower}:${l.args.tickUpper}:${l.args.salt}`;
      const p = net.get(k) ?? { sender: (l.args.sender ?? "").toLowerCase(), salt: l.args.salt as Hex, liq: 0n };
      p.liq += d;
      net.set(k, p);
    }
    const live = [...net.values()].filter((p) => p.liq > 0n).sort((a, b) => (b.liq > a.liq ? 1 : -1));
    positions = await Promise.all(
      live.slice(0, 6).map(async (p): Promise<Pos> => {
        const nft = await nftOwner(c, p.sender, BigInt(p.salt));
        return nft ? { holder: nft, liq: p.liq, via: "position NFT" } : { holder: p.sender, liq: p.liq, via: "holder contract" };
      }),
    );
    for (const p of live.slice(6)) positions.push({ holder: "", liq: p.liq, via: "" });
  } else {
    const isV2 = await c.readContract({ address: pool as Hex, abi: ABI, functionName: "getReserves" }).then(() => true, () => false);
    kind = isV2 ? "v2" : "v3";
    positions = isV2 ? await v2Holders(c, pool as Hex, w) : await v3Positions(c, pool as Hex, w, (a, r) => ((added += a), (removed += r)));
  }
  if (!positions) return null;
  const total = positions.reduce((s, p) => s + p.liq, 0n);
  const removedPct = kind !== "v2" && added > 0n ? Math.round(Number((removed * 1000n) / added)) / 10 : undefined;
  if (total === 0n) return { status: "unlocked", lockedPct: 0, pool: `uniswap ${kind}`, ...(removedPct !== undefined ? { removedPct } : {}) };

  const deployer = await deployerP;
  const holders = [...new Set(positions.map((p) => p.holder).filter(Boolean))];
  const cls = new Map(await Promise.all(holders.map(async (h) => [h, await classify(c, chain, h, deployer)] as const)));
  const pctOf = (v: bigint) => Number((v * 10_000n) / total) / 100;
  let locked = 0;
  let unlockAt: number | undefined;
  let locker: string | undefined;
  const pull = new Map<string, { who: LpControl["who"]; pct: number; via: string }>();
  for (const p of positions) {
    const k = cls.get(p.holder);
    const pc = pctOf(p.liq);
    if (!k) continue; // за пределами разобранных позиций — неизвестно
    if (k.kind === "burned" || k.kind === "locked") {
      locked += pc;
      if (k.unlockAt && (!unlockAt || k.unlockAt < unlockAt)) unlockAt = k.unlockAt;
      locker ??= k.label;
    } else if (k.kind === "pull") {
      const cur = pull.get(k.address) ?? { who: k.who, pct: 0, via: p.via };
      cur.pct += pc;
      pull.set(k.address, cur);
    }
  }
  const burnedAll = positions.every((p) => cls.get(p.holder)?.kind === "burned");
  const top = [...pull].sort((a, b) => b[1].pct - a[1].pct)[0];
  const pullPct = [...pull.values()].reduce((s, x) => s + x.pct, 0);
  const lockedPct = Math.round(locked * 10) / 10;
  const status: EvmLpResult["status"] = burnedAll ? "burned" : lockedPct >= 99 ? "locked" : pullPct >= MIN_PCT || lockedPct + pullPct >= 50 ? (lockedPct >= 50 ? "partly" : "unlocked") : "unknown";
  return {
    status,
    lockedPct: status === "unknown" ? null : lockedPct,
    pool: `uniswap ${kind}`,
    ...(unlockAt ? { unlockAt } : {}),
    ...(locker ? { locker } : {}),
    ...(top && top[1].pct >= MIN_PCT ? { pullable: { who: top[1].who, address: top[0], pct: Math.round(top[1].pct * 10) / 10, via: top[1].via } } : {}),
    ...(removedPct !== undefined ? { removedPct } : {}),
  };
}

// Владелец NFT позиции, если адрес — менеджер позиций (v3 NonfungiblePositionManager, v4 PositionManager).
async function nftOwner(c: PublicClient, manager: string, id: bigint): Promise<string | null> {
  const o = await c.readContract({ address: manager as Hex, abi: ABI, functionName: "ownerOf", args: [id] }).catch(() => null);
  return o ? o.toLowerCase() : null;
}

// v3: позиции из Mint пула. Владелец в событии — обычно менеджер позиций; tokenId берём из IncreaseLiquidity той же транзакции.
async function v3Positions(c: PublicClient, pool: Hex, w: [bigint, bigint][], tally: (added: bigint, removed: bigint) => void): Promise<Pos[] | null> {
  const ev = await logs((a, b) => c.getLogs({ address: pool, event: V3_MINT, fromBlock: a, toBlock: b }), w);
  if (!ev?.length) return null;
  const mints = [...ev].sort((a, b) => ((b.args.amount ?? 0n) > (a.args.amount ?? 0n) ? 1 : -1));
  let addedAll = 0n;
  for (const m of mints) addedAll += m.args.amount ?? 0n;
  const top = mints.slice(0, 6);
  const out: Pos[] = [];
  let live = 0n;
  let tracked = 0n;
  await Promise.all(
    top.map(async (m) => {
      const owner = (m.args.owner ?? "").toLowerCase();
      tracked += m.args.amount ?? 0n;
      const rc = await c.getTransactionReceipt({ hash: m.transactionHash }).catch(() => null);
      const inc = rc?.logs.find((l) => l.address.toLowerCase() === owner && l.topics[0] === INCREASE && l.logIndex > m.logIndex);
      if (inc?.topics[1]) {
        const id = BigInt(inc.topics[1]);
        const [holder, pos] = await Promise.all([nftOwner(c, owner, id), c.readContract({ address: owner as Hex, abi: ABI, functionName: "positions", args: [id] }).catch(() => null)]);
        const liq = pos ? pos[7] : 0n;
        // NFT сожжён (позицию закрыли до конца) — ownerOf падает, ликвидности нет.
        live += liq;
        if (liq > 0n) out.push({ holder: holder ?? "", liq, via: "position NFT" });
      } else {
        // Позиция открыта прямо контрактом (не через менеджер): держатель — он сам, остаток считаем неизвестным по сжиганиям.
        live += m.args.amount ?? 0n;
        out.push({ holder: owner, liq: m.args.amount ?? 0n, via: "holder contract" });
      }
    }),
  );
  // Мелкие позиции за пределами топ-6: ликвидность есть, держатель не разобран.
  if (addedAll > tracked) out.push({ holder: "", liq: addedAll - tracked, via: "" });
  tally(tracked, tracked > live ? tracked - live : 0n);
  return out;
}

// v2: держатели LP-токена по переводам пары за окно (выпуск LP должен попасть в окно, иначе балансы не сойдутся).
async function v2Holders(c: PublicClient, pair: Hex, w: [bigint, bigint][]): Promise<Pos[] | null> {
  const ev = await logs((a, b) => c.getLogs({ address: pair, event: TRANSFER, fromBlock: a, toBlock: b }), w);
  if (!ev?.length || !ev.some((l) => (l.args.from ?? "").toLowerCase() === ZERO)) return null;
  const bal = new Map<string, bigint>();
  for (const l of ev) {
    const f = (l.args.from ?? "").toLowerCase();
    const t = (l.args.to ?? "").toLowerCase();
    const v = l.args.value ?? 0n;
    if (f !== ZERO) bal.set(f, (bal.get(f) ?? 0n) - v);
    bal.set(t, (bal.get(t) ?? 0n) + v);
  }
  const supply = await c.readContract({ address: pair, abi: ABI, functionName: "totalSupply" }).catch(() => 0n);
  if (!supply) return null;
  // Сама пара держит LP только мгновенно при сжигании; MINIMUM_LIQUIDITY лежит на нулевом адресе и считается сожжённой.
  const top = [...bal].filter(([a, v]) => v > 0n && a !== pair.toLowerCase()).sort((a, b) => (b[1] > a[1] ? 1 : -1));
  const out: Pos[] = top.slice(0, 6).map(([a, v]) => ({ holder: a, liq: v, via: "LP tokens" }));
  const known = out.reduce((s, p) => s + p.liq, 0n);
  if (supply > known) out.push({ holder: "", liq: supply - known, via: "" });
  return out;
}

// Создатель токена — подписант первого перевода с нулевого адреса (как в карте операторов).
async function tokenDeployer(c: PublicClient, token: Hex, w: [bigint, bigint][]): Promise<string | undefined> {
  const ev = await logs((a, b) => c.getLogs({ address: token, event: TRANSFER, args: { from: ZERO }, fromBlock: a, toBlock: b }), w).catch(() => null);
  const first = ev?.[0];
  if (!first) return undefined;
  const tx = await c.getTransaction({ hash: first.transactionHash }).catch(() => null);
  return tx?.from.toLowerCase();
}

type Cls =
  | { kind: "burned"; label?: string; unlockAt?: undefined }
  | { kind: "locked"; label: string; unlockAt?: number }
  | { kind: "pull"; who: LpControl["who"]; address: string }
  | { kind: "unknown" };

const isEoaCode = (code: string | undefined) => !code || code === "0x" || code.startsWith("0xef0100"); // 7702: кошелёк с делегированием

// Экспорт для проверочных скриптов: класс держателя по адресу.
export const lpHolderClass = (chain: string, a: string, deployer?: string) => {
  const url = evmLogsRpc(chain);
  return url ? classify(createPublicClient({ transport: http(url, { timeout: 8_000 }) }) as PublicClient, chain, a.toLowerCase(), deployer?.toLowerCase()) : Promise.resolve({ kind: "unknown" } as Cls);
};

async function classify(c: PublicClient, chain: string, a: string, deployer: string | undefined): Promise<Cls> {
  if (!a) return { kind: "unknown" };
  if (BURN.has(a)) return { kind: "burned", label: "burned" };
  const known = LOCKERS[chain]?.[a];
  if (known) return { kind: "locked", label: known };
  const code = await c.getCode({ address: a as Hex }).catch(() => null);
  if (code === null) return { kind: "unknown" };
  if (isEoaCode(code)) return { kind: "pull", who: a === deployer ? "deployer" : "wallet", address: a };
  return contractHolder(c, a as Hex, code!, deployer);
}

function selectors(code: string): Set<string> {
  const s = new Set<string>();
  const b = code.slice(2);
  for (let i = 0; i < b.length; i += 2) {
    const op = parseInt(b.slice(i, i + 2), 16);
    if (op === 0x63) {
      s.add(b.slice(i + 2, i + 10));
      i += 8;
    } else if (op >= 0x60 && op <= 0x7f) i += (op - 0x5f) * 2;
  }
  return s;
}

// Контракт-держатель: лок с датой (lockUntil и подобные), функция вывода под кошельком-хозяином, или вывода нет вовсе.
async function contractHolder(c: PublicClient, a: Hex, code: string, deployer: string | undefined): Promise<Cls> {
  // Минимальный прокси (EIP-1167) — смотрим реализацию; прокси EIP-1967 можно обновить — судить по коду нельзя.
  const clone = code.match(/^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d/i);
  if (clone) code = (await c.getCode({ address: `0x${clone[1]}` as Hex }).catch(() => null)) ?? "0x";
  const impl = await c.getStorageAt({ address: a, slot: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" }).catch(() => undefined);
  if (impl && BigInt(impl) !== 0n) return { kind: "unknown" };
  const sel = selectors(code);
  if (sel.size < 4) return { kind: "unknown" };
  const canRemove = REMOVE.some((s) => sel.has(s));
  if (!canRemove && !ARBITRARY.some((s) => sel.has(s))) return { kind: "locked", label: "launchpad contract (no withdraw function)" };
  // Лок с датой: пока не истёк — залочено, сожжённый лок — навсегда.
  const burned = sel.has(toFunctionSelector("function lockBurned()").slice(2)) ? await c.readContract({ address: a, abi: ABI, functionName: "lockBurned" }).catch(() => false) : false;
  if (burned) return { kind: "locked", label: "lock contract (lock burned)" };
  for (let i = 0; i < LOCK_GETTERS.length; i++) {
    if (!sel.has(LOCK_SEL[i])) continue;
    const until = await c.readContract({ address: a, abi: ABI, functionName: LOCK_GETTERS[i] }).catch(() => null);
    if (until === null) continue;
    const ms = Number(until) * (Number(until) > 1e12 ? 1 : 1000);
    if (ms > Date.now()) return { kind: "locked", label: "lock contract", unlockAt: ms };
  }
  if (!canRemove) return { kind: "unknown" }; // произвольные вызовы без явного вывода — не берёмся судить
  // Кто управляет выводом: первый кошелёк среди owner/admin/deployer/lpOwner/creator.
  for (const fn of CONTROLLERS) {
    if (!sel.has(toFunctionSelector(`function ${fn}()`).slice(2))) continue;
    const o = (await c.readContract({ address: a, abi: ABI, functionName: fn }).catch(() => null))?.toLowerCase();
    if (!o || BURN.has(o)) continue;
    const oc = await c.getCode({ address: o as Hex }).catch(() => null);
    if (oc !== null && isEoaCode(oc)) return { kind: "pull", who: o === deployer ? "deployer" : "wallet", address: o };
  }
  return { kind: "unknown" };
}
