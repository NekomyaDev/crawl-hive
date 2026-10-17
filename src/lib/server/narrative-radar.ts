// Narrative Radar: охотник за нарративами самой платформы, ничей краулер. Раз в несколько часов Grok ищет в X,
// что начало расходиться, каждая ссылка проверяется oEmbed, и находки видят все на /narratives с кнопкой
// «Launch this narrative». Если монету с таким тикером потом запустили через Clean Launch, это видно у нарратива.
import "server-only";
import { getMeta, setMeta } from "./store";
import { grokEnabled } from "./crawl/grok";
import { SHILL_RE, huntNarratives, type Narrative } from "./crawl/sources/narratives";
import { recentLaunches } from "./launch";

const KEY = "narrRadar";
const SEEN_KEY = "narrRadarSeen";
const LAST_KEY = "narrRadarAt";
const MAX = 120;
const TICK_MS = 10 * 60_000;
const everyMs = () => Math.max(1, Number(process.env.NARR_RADAR_HOURS ?? 3)) * 3600_000;

const BRIEF = [
  "You hunt for the whole CrawlHive platform, not for one owner. Chain focus: solana.",
  "Prefer narratives that a fresh memecoin on pump.fun could form around: something people will want a ticker for.",
].join("\n");

export interface NarrativeEntry extends Narrative {
  id: string;
  at: number;
}

const read = <T>(k: string, d: T): T => {
  try {
    return JSON.parse(getMeta(k) ?? "") as T;
  } catch {
    return d;
  }
};
// Записи до появления фильтра саморекламы тоже проходят через него.
const all = () => read<NarrativeEntry[]>(KEY, []).filter((n) => !SHILL_RE.test(`${n.title} ${n.why}`));

const g = globalThis as unknown as { __crawlhiveNarr?: { started: boolean; busy: boolean } };
const st = () => (g.__crawlhiveNarr ??= { started: false, busy: false });

async function tick(force = false) {
  const s = st();
  if (s.busy || !grokEnabled()) return;
  const last = Number(getMeta(LAST_KEY) ?? 0);
  if (!force && Date.now() - last < everyMs()) return;
  s.busy = true;
  setMeta(LAST_KEY, String(Date.now()));
  try {
    const { found, seen } = await huntNarratives({ brief: BRIEF, targets: [], chain: "solana", seen: read<Record<string, number>>(SEEN_KEY, {}) });
    const now = Date.now();
    const fresh: NarrativeEntry[] = found.map((n, i) => ({ ...n, id: `${now.toString(36)}-${i}`, at: now }));
    for (const n of found) seen[n.ticker] = now;
    setMeta(SEEN_KEY, JSON.stringify(seen));
    if (fresh.length) setMeta(KEY, JSON.stringify([...fresh, ...all()].slice(0, MAX)));
    console.log(`[narratives] radar found ${fresh.length}`);
  } catch (e) {
    console.warn("[narratives] radar", (e as Error).message);
  } finally {
    s.busy = false;
  }
}

// Публичная лента: нарративы за последние дни плюс монеты, запущенные на CrawlHive под их тикером.
export function narrativeFeed() {
  const now = Date.now();
  const list = all();
  const launches = recentLaunches(200).launches;
  const items = list.slice(0, 60).map((n) => {
    const l = launches.find((x) => x.symbol.toUpperCase() === n.ticker && x.at >= n.at);
    return { ...n, launched: l ? { mint: l.mint, symbol: l.symbol, verdict: l.verdict ?? null, score: l.score ?? null } : null };
  });
  const day = list.filter((n) => now - n.at < 24 * 3600_000);
  const last = Number(getMeta(LAST_KEY) ?? 0) || null;
  return {
    items,
    enabled: grokEnabled() && process.env.NARR_RADAR_OFF !== "1",
    lastAt: last,
    nextAt: last ? last + everyMs() : null,
    everyH: everyMs() / 3600_000,
    day: { found: day.length, hot: day.filter((n) => n.heat === "hot").length, fresh: day.filter((n) => n.clones === 0).length },
  };
}

export function startNarrativeRadar() {
  const s = st();
  if (s.started) return;
  s.started = true;
  if (process.env.NARR_RADAR_OFF === "1" || process.env.CRAWL_DISABLED === "1") return;
  setTimeout(() => tick().catch(() => {}), 60_000);
  setInterval(() => tick().catch(() => {}), TICK_MS);
  console.log("[crawlhive] narrative radar started");
}
