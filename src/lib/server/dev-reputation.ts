// Страница репутации дева /dev/<адрес>: все монеты, которые мы знаем за этим кошельком-создателем, из всех наших
// хранилищ сразу. Память ролей (wallet_roles, роль dev), доказательства запуска (launches.deployer), история pump.fun
// из Helius (dev-profile.ts, свой кэш 6 ч и дневной потолок), исход из Track Record, сохранённые сканы, текущий
// рынок DexScreener только для монет, которых нет в профиле pump.fun. Новых сканов и RPC-запросов сверх этого нет.
// Ярлык считается по истории и описывает факты («3 of 4 coins rugged or dumped»), это не обвинение.
import "server-only";
import { bestPairs } from "./crawl/dexscreener";
import { devProfile, type DevProfile } from "./dev-profile";
import { operatorBrief } from "./brain";
import { launchesBy, memDb } from "./memory-db";
import { savedScan } from "./scan";
import { FACTORY_LABEL } from "./scan-evm-map";
import { walletEntries } from "./scan-operators";
import { ApiError } from "./store";
import { trackIndex, type TrackVerdict } from "./track";

const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_RE = /^0x[a-fA-F0-9]{40}$/;
const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const TTL = 10 * 60_000; // сборка дешёвая, но DexScreener и разбор журнала не на каждый заход
const ALIVE_LIQ = 1000; // как в dev-profile.ts: меньше $1k ликвидности — продать уже нечем
const MARKET_MAX = 40; // сколько монет вне pump.fun добираем рынком за одну сборку

export type DevOutcome = "rugged" | "dumped" | "survived" | "open" | "untracked";
export type DevBadge = "serial" | "mixed" | "clean" | "new";

export interface DevRepCoin {
  token: string;
  chain: string;
  symbol: string | null;
  name: string | null;
  at: number | null; // время выпуска, а если его нет, когда рой впервые увидел монету
  atKind: "launch" | "seen";
  launchpad: string | null;
  scanned: boolean; // есть сохранённый скан: можно вести на /scan/<id>
  verdict: TrackVerdict | null; // наш вердикт на момент скана
  score: number | null;
  outcome: DevOutcome;
  peakPct: number | null;
  migrated: boolean | null; // ушла с кривой pump.fun в настоящий пул (только для pump.fun)
  status: "alive" | "dead" | null; // по текущей ликвидности; null — рынок не смотрели
  liq: number | null;
  fdv: number | null;
}

export interface DevReputation {
  dev: string;
  chains: string[];
  badge: DevBadge;
  badgeLine: string;
  stats: {
    coins: number; // монет в таблице
    launchedPumpfun: number | null; // по кривым pump.fun, может быть больше, чем монет в таблице
    graded: number; // сколько из них оценил Track Record (закрытый исход)
    bad: number; // rugged или dumped 50%+
    rugRate: number | null; // bad / graded
    medianPeakPct: number | null;
    migrated: number;
    alive: number;
  };
  factoryCoins: number; // адрес — контракт лаунчпада: выпускал токены за других
  operator: { id: string; wallets: number; tokens: number; dumpRate: number | null; strong: boolean; scan: string | null } | null;
  pumpfunError: string | null;
  coins: DevRepCoin[];
  hidden: number; // строк таблицы скрыто по тарифу
  checkedAt: number;
}

const g = globalThis as unknown as { __crawlhiveDevRep?: Map<string, DevReputation> };
const cache = () => (g.__crawlhiveDevRep ??= new Map());
const key = (a: string) => (a.startsWith("0x") ? a.toLowerCase() : a);

function launchpadOf(chain: string, token: string, factory: string | null | undefined) {
  if (chain === "solana") return factory === PUMP_PROGRAM || token.endsWith("pump") ? "pump.fun" : factory ? "launchpad program" : null;
  return factory ? (FACTORY_LABEL[factory.toLowerCase()] ?? "launchpad contract") : null;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
};

// Ярлык по истории: правило простое и объяснимое, полностью видно в подсказке на странице.
export const BADGE_RULES =
  "New dev: 0 or 1 coin known. Serial rugger: 3 or more coins rugged or dumped 50%+ within 24h of our scan. Clean record: 2 or more coins known and none rugged or dumped. Mixed: everything else.";

function badgeOf(coins: number, bad: number, graded: number): { badge: DevBadge; line: string } {
  const of = (n: number) => `${n} coin${n === 1 ? "" : "s"}`;
  const gradedNote = graded === coins ? "" : ` (${graded} graded by our Track Record)`;
  if (coins <= 1) return { badge: "new", line: coins ? "1 coin known so far, not enough history to judge" : "No coins from this wallet in our memory yet" };
  if (bad >= 3) return { badge: "serial", line: `${bad} of ${of(coins)} rugged or dumped 50%+${gradedNote}` };
  if (bad === 0) return { badge: "clean", line: `None of ${of(coins)} rugged or dumped${gradedNote}` };
  return { badge: "mixed", line: `${bad} of ${of(coins)} rugged or dumped 50%+${gradedNote}` };
}

async function build(dev: string): Promise<DevReputation> {
  const d = memDb();
  const mem = walletEntries(dev);
  const rows = new Map<string, { token: string; chain: string; launchedAt: number | null; seenAt: number | null; factory: string | null }>();
  for (const x of mem) if (x.role === "dev") rows.set(key(x.token), { token: x.token, chain: x.chain, launchedAt: null, seenAt: null, factory: null });
  for (const l of d ? launchesBy(d, dev, "deployer") : []) {
    const r = rows.get(key(l.token));
    rows.set(key(l.token), { token: l.token, chain: l.chain, launchedAt: l.launchedAt, seenAt: l.seenAt, factory: l.factory ?? r?.factory ?? null });
  }
  const factoryCoins = new Set([...mem.filter((x) => x.role === "factory").map((x) => key(x.token)), ...(d ? launchesBy(d, dev, "factory").map((l) => key(l.token)) : [])]).size;

  // История pump.fun: только Solana; ошибку (потолок дня, нет ключа) показываем, страницу не роняем.
  let pump: DevProfile | null = null;
  let pumpfunError: string | null = null;
  if (SOL_RE.test(dev) && !factoryCoins) {
    try {
      pump = await devProfile(dev);
    } catch (e) {
      pumpfunError = (e as Error).message;
    }
  }
  const pumpBy = new Map((pump?.coins ?? []).map((c) => [c.mint, c]));
  for (const c of pump?.coins ?? []) if (!rows.has(c.mint)) rows.set(c.mint, { token: c.mint, chain: "solana", launchedAt: c.createdAt, seenAt: null, factory: PUMP_PROGRAM });

  // Рынок для монет вне профиля pump.fun: по сети, пачками DexScreener, с потолком на сборку.
  const need = [...rows.values()].filter((r) => !pumpBy.has(r.token)).slice(0, MARKET_MAX);
  const market = new Map<string, { liq: number | null; fdv: number | null; dexId: string | null; symbol: string | null; name: string | null }>();
  const byChain = new Map<string, string[]>();
  for (const r of need) byChain.set(r.chain, [...(byChain.get(r.chain) ?? []), r.token]);
  await Promise.all(
    [...byChain].map(async ([chain, list]) => {
      const pairs = await bestPairs(chain, list).catch(() => null);
      if (!pairs) return;
      for (const t of list) {
        const p = pairs.get(t) ?? pairs.get(t.toLowerCase());
        market.set(key(t), { liq: p?.liquidity?.usd ?? null, fdv: p?.fdv ?? p?.marketCap ?? null, dexId: p?.dexId ?? null, symbol: p?.baseToken.symbol ?? null, name: p?.baseToken.name ?? null });
      }
    }),
  );

  const track = trackIndex();
  const coins: DevRepCoin[] = [...rows.values()].map((r) => {
    const k = key(r.token);
    const e = track.get(k);
    const p = pumpBy.get(r.token);
    const mk = market.get(k);
    const saved = savedScan(r.token);
    const outcome: DevOutcome = !e ? "untracked" : e.anyRugged ? "rugged" : e.anyDumped ? "dumped" : e.done && Date.now() - e.at >= 24 * 3600_000 ? "survived" : "open";
    const launchpad = launchpadOf(r.chain, r.token, r.factory);
    const liq = p ? p.liq : (mk?.liq ?? null);
    const looked = !!p || market.has(k);
    const dexId = mk?.dexId ?? null;
    // Ушла ли с кривой: в профиле pump.fun «graduated» — да, «live» — ещё на кривой, мёртвые — неизвестно.
    const migrated = launchpad !== "pump.fun" ? null : p ? (p.status === "graduated" ? true : p.status === "live" ? false : null) : dexId ? dexId !== "pumpfun" : null;
    const launchAt = r.launchedAt ?? p?.createdAt ?? null;
    const seenAt = r.seenAt ?? e?.at ?? saved?.scannedAt ?? null;
    return {
      token: r.token,
      chain: r.chain,
      symbol: p?.symbol ?? mk?.symbol ?? e?.symbol ?? saved?.symbol ?? null,
      name: p?.name ?? mk?.name ?? e?.name ?? saved?.name ?? null,
      at: launchAt ?? seenAt,
      atKind: launchAt ? "launch" : "seen",
      launchpad,
      scanned: !!saved,
      verdict: e?.verdict ?? saved?.verdict ?? null,
      score: e?.score ?? saved?.score ?? null,
      outcome,
      peakPct: e?.peakPct ?? null,
      migrated,
      status: looked ? ((liq ?? 0) >= ALIVE_LIQ ? "alive" : "dead") : null,
      liq,
      fdv: p ? p.fdv : (mk?.fdv ?? null),
    };
  });
  coins.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));

  const graded = coins.filter((c) => c.outcome === "rugged" || c.outcome === "dumped" || c.outcome === "survived").length;
  const bad = coins.filter((c) => c.outcome === "rugged" || c.outcome === "dumped").length;
  const { badge, line } = badgeOf(coins.length, bad, graded);
  const op = operatorBrief(dev);
  const chains = [...new Set([...coins.map((c) => c.chain), ...mem.map((x) => x.chain)])];
  return {
    dev,
    chains,
    badge,
    badgeLine: line,
    stats: {
      coins: coins.length,
      launchedPumpfun: pump ? pump.launched : null,
      graded,
      bad,
      rugRate: graded ? Math.round((bad / graded) * 1000) / 1000 : null,
      medianPeakPct: median(coins.map((c) => c.peakPct).filter((x): x is number => typeof x === "number")),
      migrated: coins.filter((c) => c.migrated).length,
      alive: coins.filter((c) => c.status === "alive").length,
    },
    factoryCoins,
    // Бабл-карта оператора живёт на странице скана: ведём на самый свежий сохранённый скан монеты этого дева.
    operator: op ? { ...op, scan: coins.find((c) => c.scanned)?.token ?? null } : null,
    pumpfunError,
    coins,
    hidden: 0,
    checkedAt: Date.now(),
  };
}

// Полная репутация из кэша (10 мин). Обрезку таблицы по тарифу делает маршрут.
export async function devReputation(raw: string): Promise<DevReputation> {
  const a = (raw ?? "").trim();
  if (!SOL_RE.test(a) && !EVM_RE.test(a)) throw new ApiError("Pass a Solana or EVM (0x...) wallet address");
  const dev = key(a);
  const hit = cache().get(dev);
  if (hit && Date.now() - hit.checkedAt < TTL) return hit;
  const rep = await build(dev);
  if (cache().size > 2000) cache().clear();
  cache().set(dev, rep);
  return rep;
}
