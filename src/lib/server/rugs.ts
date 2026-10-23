// Rug Feed: монеты из Track Record, которые зарутали или рухнули, свежие сверху. Только чтение журнала
// (trackEntries), сам замер и правила руга живут в track.ts. Рядом считаем, какую долю из них сканер
// пометил заранее (DANGER, RISKY или TOO_EARLY в момент скана), и сколько обычно проходит от скана до руга.
import "server-only";
import { trackEntries, type TrackEntry } from "./track";

const DAY = 24 * 3600_000;
const WINDOWS = { "24h": DAY, "7d": 7 * DAY, all: Infinity } as const;
export type RugWindow = keyof typeof WINDOWS;
const CHAINS = ["solana", "robinhood", "bsc", "base"] as const;
const MIN_LIQ0 = 1000; // пыль с ликвидностью меньше $1k на старте в ленту не берём: там «руг» ничего не значит
const MAX_ITEMS = 500;
const CACHE_MS = 60_000;

const warnedVerdict = (v: string) => v === "DANGER" || v === "RISKY" || v === "TOO_EARLY";

export interface RugItem {
  id: string;
  chain: string;
  symbol: string;
  name: string | null;
  verdict: string; // публичный вердикт на момент скана
  score: number | null;
  model: "v1" | "v2"; // какая оценка дала вердикт
  src: string;
  at: number; // скан
  eventAt: number; // когда руг подтвердился; для слива без руга время неизвестно, берём время скана
  hoursToRug: number | null; // только для ругов: от скана до подтверждения
  kind: "rug" | "dump";
  rugBy: "liq" | "gone" | null;
  lowPct: number | null; // насколько упала цена (минимум от цены скана)
  liqPulledPct: number | null; // сколько ликвидности ушло от исходной
  liq0: number;
  liqNow: number | null;
  peakPct: number | null; // пик до руга (только если был выше цены скана)
  warned: boolean;
}

function toItem(e: TrackEntry): RugItem {
  const rugged = !!e.rugged;
  // Запись с ругом больше не замеряется: последний замер и есть момент, когда руг подтвердился.
  const eventAt = rugged ? (e.sampledAt ?? e.at) : e.at;
  const gone = e.rugBy === "gone";
  const liqPulled = gone ? 100 : e.liqNow != null && e.liq0 > 0 ? Math.max(0, Math.round((1 - e.liqNow / e.liq0) * 100)) : null;
  return {
    id: e.id,
    chain: e.chain,
    symbol: e.symbol,
    name: e.name ?? null,
    verdict: e.verdict,
    score: e.score,
    model: e.pv ? "v2" : "v1",
    src: e.src,
    at: e.at,
    eventAt,
    hoursToRug: rugged && e.sampledAt ? Math.round(((e.sampledAt - e.at) / 3600_000) * 10) / 10 : null,
    kind: rugged ? "rug" : "dump",
    rugBy: e.rugBy ?? null,
    lowPct: gone ? -100 : (e.lowPct ?? null),
    liqPulledPct: liqPulled,
    liq0: Math.round(e.liq0),
    liqNow: gone ? 0 : (e.liqNow ?? null),
    peakPct: e.peakPct != null && e.peakPct > 0 ? e.peakPct : null,
    warned: warnedVerdict(e.verdict),
  };
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

function statsOf(xs: RugItem[]) {
  const warned = xs.filter((x) => x.warned).length;
  const rugs = xs.filter((x) => x.kind === "rug");
  return {
    total: xs.length,
    rugs: rugs.length,
    dumps: xs.length - rugs.length,
    warned,
    missed: xs.length - warned,
    warnedPct: xs.length ? Math.round((warned / xs.length) * 100) : null,
    medianHoursToRug: median(rugs.flatMap((x) => (x.hoursToRug != null ? [x.hoursToRug] : []))),
  };
}
export type RugStats = ReturnType<typeof statsOf>;

function build() {
  const now = Date.now();
  // Ложные руги (после «руга» токен жив, recheck alive) не показываем. Один токен: одна строка, самая свежая.
  const seen = new Set<string>();
  const items: RugItem[] = [];
  for (const e of trackEntries()) {
    if (!(e.rugged || e.dumped) || e.recheck === "alive" || e.liq0 < MIN_LIQ0 || seen.has(e.id)) continue;
    seen.add(e.id);
    items.push(toItem(e));
  }
  items.sort((a, b) => b.eventAt - a.eventAt);
  // Статистика по каждой сети и каждому окну по полному списку, а не по обрезанной ленте.
  const stats: Record<string, Record<RugWindow, RugStats>> = {};
  for (const chain of ["all", ...CHAINS]) {
    const xs = chain === "all" ? items : items.filter((x) => x.chain === chain);
    stats[chain] = Object.fromEntries(
      (Object.keys(WINDOWS) as RugWindow[]).map((w) => [w, statsOf(xs.filter((x) => now - x.eventAt < WINDOWS[w]))]),
    ) as Record<RugWindow, RugStats>;
  }
  return { updatedAt: now, chains: CHAINS, stats, items: items.slice(0, MAX_ITEMS), minLiq0: MIN_LIQ0 };
}

// Кэш на минуту: журнал на тысячи записей не разбираем на каждый запрос ленты.
let cache: { at: number; data: ReturnType<typeof build> } | null = null;
export function rugFeed() {
  if (!cache || Date.now() - cache.at >= CACHE_MS) cache = { at: Date.now(), data: build() };
  return cache.data;
}
