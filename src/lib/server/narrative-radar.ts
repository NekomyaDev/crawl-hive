// Narrative Radar: охотник за нарративами самой платформы, ничей краулер. Раз в час Grok ищет в X, что начало
// расходиться, каждая ссылка проверяется oEmbed, и находки видят все на /narratives с кнопкой «Launch this narrative».
// Нарратив живёт во времени: если следующая охота находит его снова, это новая отметка, а не дубль — отсюда стадии
// (new → rising → peak → fading). Раз в час для свежих нарративов смотрим на DexScreener, какие монеты появились на
// тикере после него и какой у лучшей был пик: так радар оценивает сам себя, как Track Record оценивает краулеров.
import "server-only";
import { getMeta, setMeta } from "./store";
import { grokEnabled } from "./crawl/grok";
import { searchPairs } from "./crawl/dexscreener";
import { CA_RE, SHILL_RE, huntNarratives, type Narrative } from "./crawl/sources/narratives";
import { narrativeFeeds } from "./crawl/sources/narrative-feeds";
import { recentLaunches } from "./launch";
import { postInfo } from "./narrative-media";

const KEY = "narrRadar";
const LAST_KEY = "narrRadarAt";
const MAX = 200;
const TICK_MS = 10 * 60_000;
const HOUR = 3600_000;
const MERGE_MS = 48 * HOUR; // тот же тикер в пределах двух суток — тот же нарратив
const FADE_MS = 4 * HOUR; // не видели 4 часа — затухает
const OUTCOME_MS = 72 * HOUR; // исход отслеживаем трое суток
const WIN_FDV = 100_000;
const everyMs = () => Math.max(1, Number(process.env.NARR_RADAR_HOURS ?? 3)) * HOUR;

const HEAT_RANK: Record<string, number> = { early: 1, rising: 2, hot: 3 };

export interface Sighting {
  at: number;
  heat: string;
  clones: number | null;
}
export interface Outcome {
  coins: number; // монет на тикере, появившихся после нарратива
  best?: { address: string; symbol: string; fdv: number };
  maxFdv: number; // лучший пик, который мы видели
  checkedAt: number;
}
export interface NarrativeEntry extends Narrative {
  id: string;
  at: number; // когда нашли впервые
  lastAt?: number; // когда видели последний раз
  sightings?: Sighting[];
  outcome?: Outcome;
  reach?: Reach;
  takenFdv?: number; // самая дорогая монета на тикере, появившаяся ДО нарратива
  media?: string[]; // картинки из постов (pbs.twimg.com)
}
export interface Reach {
  views: number;
  likes: number;
  reposts: number;
  replies: number;
  followers: number; // самый крупный автор среди постов
  firstPostAt: number; // когда вышел самый ранний из постов
  checkedAt: number;
}

const read = <T>(k: string, d: T): T => {
  try {
    return JSON.parse(getMeta(k) ?? "") as T;
  } catch {
    return d;
  }
};
// Записи до появления фильтров тоже проходят через них: самореклама, адрес контракта, тикер уже занят дорогой монетой.
const TAKEN_FDV = () => Number(process.env.NARR_TAKEN_FDV ?? 500_000);
const all = () => read<NarrativeEntry[]>(KEY, []).filter((n) => !SHILL_RE.test(`${n.title} ${n.why}`) && !CA_RE.test(`${n.title} ${n.why}`) && (n.takenFdv ?? 0) < TAKEN_FDV());
const save = (list: NarrativeEntry[]) => setMeta(KEY, JSON.stringify(list.slice(0, MAX)));

const g = globalThis as unknown as { __crawlhiveNarr?: { started: boolean; busy: boolean; outcomesAt: number } };
const st = () => (g.__crawlhiveNarr ??= { started: false, busy: false, outcomesAt: 0 });

function brief(list: NarrativeEntry[]) {
  const live = list.filter((n) => Date.now() - (n.lastAt ?? n.at) < 12 * HOUR).slice(0, 15);
  return [
    "You hunt for the whole CrawlHive platform, not for one owner. Chain focus: solana.",
    "Prefer narratives that a fresh memecoin on pump.fun could form around: something people will want a ticker for.",
    live.length ? `Already tracking: ${live.map((n) => `${n.title} ($${n.ticker})`).join("; ")}. If one of these is still spreading, report it again with the same ticker and its current heat.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function hunt() {
  const before = all();
  // Пустой «уже видели»: повторная находка нужна, это отметка в жизни нарратива.
  const feeds = await narrativeFeeds().catch(() => []);
  const { found } = await huntNarratives({ brief: brief(before), targets: [], chain: "solana", seen: {}, feeds });
  const now = Date.now();
  const list = [...before];
  let added = 0;
  let again = 0;
  found.forEach((n, i) => {
    const sight: Sighting = { at: now, heat: n.heat, clones: n.clones };
    const prev = list.find((e) => e.ticker === n.ticker && now - (e.lastAt ?? e.at) < MERGE_MS);
    if (prev) {
      again++;
      prev.sightings = [...(prev.sightings ?? [{ at: prev.at, heat: prev.heat, clones: prev.clones }]), sight].slice(-48);
      prev.lastAt = now;
      prev.heat = n.heat;
      prev.conf = n.conf;
      prev.clones = n.clones;
      prev.posts = [...new Set([...prev.posts, ...n.posts])].slice(0, 6);
      if (n.refs?.length) prev.refs = [...(prev.refs ?? []), ...n.refs.filter((r) => !prev.refs?.some((x) => x.url === r.url))].slice(0, 6);
      return;
    }
    added++;
    list.unshift({ ...n, id: `${now.toString(36)}-${i}`, at: now, lastAt: now, sightings: [sight] });
  });
  // Свежие и повторно найденные — обновляем охват и картинки.
  for (const n of list.filter((e) => e.lastAt === now)) await enrich(n);
  save(list);
  console.log(`[narratives] radar: ${added} new, ${again} seen again`);
}

// Охват и картинки по проверенным постам (fxtwitter, без X API): суммы просмотров, лайков, репостов.
async function enrich(n: NarrativeEntry) {
  const infos = (await Promise.all(n.posts.slice(0, 4).map((u) => postInfo(u).catch(() => null)))).filter((x): x is NonNullable<typeof x> => !!x);
  if (!infos.length) return;
  const sum = (k: "views" | "likes" | "reposts" | "replies") => infos.reduce((a, i) => a + i[k], 0);
  n.reach = {
    views: sum("views"),
    likes: sum("likes"),
    reposts: sum("reposts"),
    replies: sum("replies"),
    followers: Math.max(...infos.map((i) => i.followers)),
    firstPostAt: Math.min(...infos.map((i) => i.createdAt || Date.now())),
    checkedAt: Date.now(),
  };
  const media = [...new Set(infos.flatMap((i) => i.images))].slice(0, 4);
  if (media.length) n.media = media;
}

// Исход: монеты на тикере после нарратива (Solana, тот же символ) и лучший пик FDV, который мы застали.
async function refreshOutcomes() {
  const list = all();
  const now = Date.now();
  const due = list.filter((n) => now - n.at < OUTCOME_MS && (!n.outcome || !n.reach || n.takenFdv === undefined || now - n.outcome.checkedAt > 55 * 60_000)).slice(0, 40);
  for (const n of due) {
    if (now - n.at < 24 * HOUR) await enrich(n).catch(() => {});
    try {
      // Один запрос: монеты на тикере до нарратива (занят ли тикер) и после (что он породил).
      const same = (await searchPairs(n.ticker)).filter((p) => p.baseToken.symbol.toUpperCase().replace(/^\$/, "") === n.ticker);
      const pairs = same.filter((p) => p.chainId === "solana" && (p.pairCreatedAt ?? 0) >= n.at - HOUR);
      const before = same.filter((p) => (p.pairCreatedAt ?? 0) < n.at - HOUR);
      n.takenFdv = Math.max(0, ...before.map((p) => p.fdv ?? p.marketCap ?? 0));
      const byToken = new Map<string, { symbol: string; fdv: number }>();
      for (const p of pairs) {
        const fdv = p.fdv ?? p.marketCap ?? 0;
        const cur = byToken.get(p.baseToken.address);
        if (!cur || fdv > cur.fdv) byToken.set(p.baseToken.address, { symbol: p.baseToken.symbol, fdv });
      }
      const top = [...byToken.entries()].sort((a, b) => b[1].fdv - a[1].fdv)[0];
      const prevMax = n.outcome?.maxFdv ?? 0;
      n.outcome = {
        coins: byToken.size,
        best: top ? { address: top[0], symbol: top[1].symbol, fdv: Math.round(top[1].fdv) } : n.outcome?.best,
        maxFdv: Math.max(prevMax, Math.round(top?.[1].fdv ?? 0)),
        checkedAt: now,
      };
    } catch (e) {
      console.warn("[narratives] outcome", n.ticker, (e as Error).message);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  if (due.length) save(list);
}

async function tick(force = false) {
  const s = st();
  if (s.busy) return;
  s.busy = true;
  try {
    const last = Number(getMeta(LAST_KEY) ?? 0);
    if (grokEnabled() && (force || Date.now() - last >= everyMs())) {
      setMeta(LAST_KEY, String(Date.now()));
      await hunt().catch((e) => console.warn("[narratives] radar", (e as Error).message));
    }
    if (Date.now() - s.outcomesAt > 30 * 60_000) {
      s.outcomesAt = Date.now();
      await refreshOutcomes();
    }
  } finally {
    s.busy = false;
  }
}

// Стадия по отметкам: давно не видели — затухает; горячий сейчас — пик; горячее или больше клонов, чем
// в первый раз, — растёт; иначе новый.
function stageOf(n: NarrativeEntry, now: number): "new" | "rising" | "peak" | "fading" {
  const s = n.sightings ?? [{ at: n.at, heat: n.heat, clones: n.clones }];
  if (now - (n.lastAt ?? n.at) > FADE_MS) return "fading";
  if (n.heat === "hot") return "peak";
  const first = s[0];
  const lastS = s[s.length - 1];
  if (s.length > 1 && ((HEAT_RANK[lastS.heat] ?? 1) > (HEAT_RANK[first.heat] ?? 1) || (lastS.clones ?? 0) > (first.clones ?? 0))) return "rising";
  return "new";
}

// Narrative Score 0–100: горячесть, охват, скорость распространения, свободный тикер, стадия. Одно число,
// по которому видно, что сейчас самое живое; составные части показываем рядом.
function scoreOf(n: NarrativeEntry, stage: string, now: number) {
  const r = n.reach;
  const heat = ((HEAT_RANK[n.heat] ?? 1) / 3) * 30;
  const reach = r ? Math.min(25, (Math.log10(1 + r.views) / 6) * 25) : 0; // 1M просмотров — максимум
  const hours = r ? Math.max(0.5, (now - r.firstPostAt) / HOUR) : 0;
  const speedV = r ? r.views / hours : 0;
  const speed = Math.min(20, (Math.log10(1 + speedV) / 5) * 20); // 100k просмотров в час — максимум
  const fresh = n.clones === 0 ? 15 : n.clones !== null && n.clones <= 2 ? 8 : 0;
  const life = stage === "peak" ? 10 : stage === "rising" ? 8 : stage === "new" ? 5 : 0;
  // Подтверждение на других площадках (Reddit, новости, HN, лаунчпады): +5 за каждую, до +10.
  const cross = Math.min(10, new Set((n.refs ?? []).map((r) => r.platform)).size * 5);
  return { score: Math.min(100, Math.round(heat + reach + speed + fresh + life + cross)), speed: Math.round(speedV) };
}

const handleOf = (u?: string) => u?.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status/)?.[1];

// Монеты с Launch Radar на тикерах нарративов (созданные не раньше чем за час до находки) — из хранилища радара.
function radarHits() {
  try {
    const list = JSON.parse(getMeta("radar") ?? "[]") as { id: string; chain: string; symbol: string; verdict: string; score: number | null; ageH: number | null; at: number }[];
    return list.filter((e) => e.chain === "solana").map((e) => ({ ...e, ticker: e.symbol.toUpperCase().replace(/^\$/, "").replace(/[^A-Z0-9]/g, ""), born: e.at - (e.ageH ?? 0) * HOUR }));
  } catch {
    return [];
  }
}

// Публичная лента: нарративы со стадией, исходом и тем, кто заметил первым, плюс оценка самого радара.
export function narrativeFeed() {
  const now = Date.now();
  const list = all();
  const launches = recentLaunches(200).launches;
  const hits = radarHits();
  const items = list.slice(0, 60).map((n) => {
    const r = hits.find((e) => e.ticker === n.ticker && e.born >= n.at - HOUR);
    const l = launches.find((x) => x.symbol.toUpperCase() === n.ticker && x.at >= n.at);
    const stage = stageOf(n, now);
    const sc = scoreOf(n, stage, now);
    return {
      ...n,
      score: sc.score,
      speed: sc.speed,
      stage,
      seen: n.sightings?.length ?? 1,
      firstBy: handleOf(n.posts[0]) ?? null,
      onRadar: r ? { id: r.id, symbol: r.symbol, verdict: r.verdict, score: r.score } : null,
      launched: l ? { mint: l.mint, symbol: l.symbol, verdict: l.verdict ?? null, score: l.score ?? null } : null,
    };
  });
  const day = list.filter((n) => now - n.at < 24 * HOUR);
  // Оценка: нарративы старше суток, у которых исход уже проверяли.
  const graded = list.filter((n) => now - n.at >= 24 * HOUR && n.outcome);
  const wins = graded.filter((n) => (n.outcome?.maxFdv ?? 0) >= WIN_FDV);
  const last = Number(getMeta(LAST_KEY) ?? 0) || null;
  return {
    items,
    enabled: grokEnabled() && process.env.NARR_RADAR_OFF !== "1",
    lastAt: last,
    nextAt: last ? last + everyMs() : null,
    everyH: everyMs() / HOUR,
    day: { found: day.length, hot: day.filter((n) => n.heat === "hot").length, fresh: day.filter((n) => n.clones === 0).length },
    record: { graded: graded.length, wins: wins.length, winFdv: WIN_FDV },
  };
}

export const narrativeById = (id: string) => all().find((n) => n.id === id) ?? null;

export function startNarrativeRadar() {
  const s = st();
  if (s.started) return;
  s.started = true;
  if (process.env.NARR_RADAR_OFF === "1" || process.env.CRAWL_DISABLED === "1") return;
  setTimeout(() => tick().catch(() => {}), 60_000);
  setInterval(() => tick().catch(() => {}), TICK_MS);
  console.log("[crawlhive] narrative radar started");
}
