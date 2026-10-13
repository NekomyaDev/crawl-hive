// Track Record: проверяем сканер реальностью. Каждый вердикт (скан пользователя, проверка безопасности
// краулера, Launch Radar, агент через MCP) запоминается вместе с ценой и ликвидностью на момент скана.
// Следующие 24 часа цену замеряем каждые 10 минут. Итог честный и без подбора примеров: какая доля токенов
// с каждым вердиктом рухнула (−50% от цены скана) или потеряла ликвидность (руг) за сутки.
import "server-only";
import { getMeta, setMeta } from "./store";
import { bestPairs } from "./crawl/dexscreener";

const KEY = "track";
const MAX = 4000;
const WINDOW_MS = 24 * 3600_000;
const SAMPLE_MS = 10 * 60_000;
const DUMP_PCT = -50; // рухнул: минимум за сутки на 50% ниже цены скана
const RUG_LIQ = 0.2; // руг: ликвидность упала до 20% от исходной или пара исчезла

export type TrackVerdict = "CLEAN" | "OK" | "RISKY" | "DANGER" | "TOO_EARLY";

export interface TrackEntry {
  id: string; // адрес токена
  chain: string;
  symbol: string;
  verdict: TrackVerdict;
  score: number | null;
  src: "scan" | "crawler" | "radar" | "agent";
  at: number;
  price0: number;
  liq0: number;
  peakPct?: number;
  lowPct?: number;
  lastPct?: number;
  liqNow?: number;
  sampledAt?: number;
  missing?: number; // сколько замеров подряд пара не находилась
  done?: boolean;
  dumped?: boolean;
  rugged?: boolean;
}

function all(): TrackEntry[] {
  try {
    return JSON.parse(getMeta(KEY) ?? "[]");
  } catch {
    return [];
  }
}
const save = (l: TrackEntry[]) => setMeta(KEY, JSON.stringify(l.slice(0, MAX)));

// Один токен — одна запись за окно: повторные сканы того же токена не накручивают статистику.
export function trackVerdict(r: {
  id: string;
  chain: string;
  symbol: string;
  verdict: TrackVerdict;
  score: number | null;
  market?: { priceUsd?: number; liquidityUsd?: number };
}, src: TrackEntry["src"]) {
  const price0 = Number(r.market?.priceUsd);
  const liq0 = Number(r.market?.liquidityUsd);
  if (!(price0 > 0) || !(liq0 > 0) || !["solana", "robinhood"].includes(r.chain)) return;
  const list = all();
  const now = Date.now();
  const prev = list.findIndex((e) => e.id === r.id && now - e.at < WINDOW_MS);
  // Настоящий вердикт вытесняет «слишком рано»: судить сканер по TOO_EARLY нечестно в обе стороны.
  if (prev >= 0) {
    if (list[prev].verdict !== "TOO_EARLY" || r.verdict === "TOO_EARLY") return;
    list.splice(prev, 1);
  }
  list.unshift({ id: r.id, chain: r.chain, symbol: r.symbol, verdict: r.verdict, score: r.score, src, at: now, price0, liq0 });
  save(list);
}

// Замер цены открытых записей: пачками по 30 адресов на сеть.
export async function sampleTrack() {
  const list = all();
  const now = Date.now();
  const open = list.filter((e) => !e.done && now - (e.sampledAt ?? e.at) >= SAMPLE_MS - 30_000);
  if (!open.length) return 0;
  const byChain = new Map<string, TrackEntry[]>();
  for (const e of open) byChain.set(e.chain, [...(byChain.get(e.chain) ?? []), e]);
  for (const [chain, entries] of byChain) {
    let pairs: Awaited<ReturnType<typeof bestPairs>>;
    try {
      pairs = await bestPairs(chain, entries.map((e) => e.id));
    } catch (e) {
      console.warn("[track] dexscreener failed:", (e as Error).message);
      continue;
    }
    for (const e of entries) {
      const p = pairs.get(e.id);
      const price = Number(p?.priceUsd);
      e.sampledAt = now;
      if (!p || !(price > 0)) {
        // Пара пропала: три замера подряд (30 минут) — считаем, что ликвидность вытащили.
        e.missing = (e.missing ?? 0) + 1;
        if (e.missing >= 3) Object.assign(e, { rugged: true, dumped: true, lowPct: -100, lastPct: -100 });
      } else {
        e.missing = 0;
        const pct = Math.round(((price - e.price0) / e.price0) * 1000) / 10;
        e.peakPct = Math.max(e.peakPct ?? pct, pct);
        e.lowPct = Math.min(e.lowPct ?? pct, pct);
        e.lastPct = pct;
        e.liqNow = Math.round(p.liquidity?.usd ?? 0);
        if (e.lowPct <= DUMP_PCT) e.dumped = true;
        if (e.liqNow < e.liq0 * RUG_LIQ) e.rugged = e.dumped = true;
      }
      if (now - e.at >= WINDOW_MS || e.rugged) e.done = true;
    }
  }
  save(list);
  return open.length;
}

// ---------- для страницы ----------

export interface VerdictStats {
  verdict: TrackVerdict;
  tracked: number; // всего с этим вердиктом
  settled: number; // прошли сутки или руг — исход известен
  dumped: number; // рухнули на 50%+ или руг
  rugged: number;
  medianPeak: number | null;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export function trackStats() {
  const list = all();
  const verdicts: TrackVerdict[] = ["CLEAN", "OK", "RISKY", "DANGER", "TOO_EARLY"];
  const by = verdicts.map((v): VerdictStats => {
    const xs = list.filter((e) => e.verdict === v);
    const settled = xs.filter((e) => e.done);
    return {
      verdict: v,
      tracked: xs.length,
      settled: settled.length,
      dumped: settled.filter((e) => e.dumped).length,
      rugged: settled.filter((e) => e.rugged).length,
      medianPeak: median(settled.map((e) => e.peakPct ?? 0)),
    };
  });
  // «Мы предупреждали»: DANGER/RISKY, которые потом рухнули. «Пропустили»: CLEAN/OK, которые всё равно рухнули.
  const pub = (e: TrackEntry) => ({
    id: e.id,
    chain: e.chain,
    symbol: e.symbol,
    verdict: e.verdict,
    score: e.score,
    src: e.src,
    at: e.at,
    peakPct: e.peakPct ?? null,
    lowPct: e.lowPct ?? null,
    lastPct: e.lastPct ?? null,
    done: !!e.done,
    dumped: !!e.dumped,
    rugged: !!e.rugged,
  });
  const warned = list.filter((e) => (e.verdict === "DANGER" || e.verdict === "RISKY") && e.dumped).slice(0, 12).map(pub);
  const missed = list.filter((e) => (e.verdict === "CLEAN" || e.verdict === "OK") && e.dumped).slice(0, 12).map(pub);
  const recent = list.slice(0, 40).map(pub);
  return { since: list.length ? list[list.length - 1].at : null, total: list.length, by, warned, missed, recent, windowHours: 24, dumpPct: DUMP_PCT };
}

// Запись по токену для скана, сделанного в момент `at` (бот «через 24 часа» спрашивает, чем кончилось).
export function trackEntry(id: string, at: number) {
  return all().find((e) => e.id === id && Math.abs(e.at - at) < WINDOW_MS);
}
