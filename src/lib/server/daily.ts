// Сводка дня для контента: лучшие попадания и пойманные раги, цифры роя, нарратив дня, байбеки. Только агрегаты.
import "server-only";
import { getMeta } from "./store";
import { dayHighlights, replayFeed } from "./track";
import { narrativeFeed } from "./narrative-radar";
import { radarFeed } from "./radar";
import { buybackStats } from "./buyback";

export async function dailyDigest() {
  const now = Date.now();
  // Попадания закрываются через сутки после скана, поэтому «гем дня» ищем среди сканов за последние 48 часов.
  const hl = dayHighlights(now - 48 * 3600_000);
  const day = dayHighlights(now - 24 * 3600_000);
  let walletMemory = 0;
  try {
    walletMemory = Object.keys(JSON.parse(getMeta("walletMem") ?? "{}")).length;
  } catch {}
  const narr = narrativeFeed();
  const top = [...narr.items].sort((a, b) => b.score - a.score)[0];
  const radar = radarFeed();
  const bb = await buybackStats().catch(() => null);
  const replay = replayFeed().stats;
  return {
    at: now,
    gem: hl.gem,
    rug: hl.rug,
    verdicts24h: day.verdicts,
    bySource24h: day.bySource,
    walletMemory,
    narratives24h: narr.day.found,
    topNarrative: top ? { title: top.title, ticker: top.ticker, heat: top.heat, stage: top.stage, score: top.score, views: top.reach?.views ?? null, clones: top.clones, firstBy: top.firstBy, post: top.posts[0] ?? null, media: top.media?.[0] ?? null } : null,
    radar24h: radar.day,
    replay,
    burns: bb ? { count: bb.count, burned: Math.round(bb.burned), burnedPct: bb.burnedPct, solSpent: bb.solSpent, nextAt: bb.nextAt, planSol: bb.planSol, treasurySol: bb.treasurySol } : null,
  };
}

// ---------- ежедневный дайджест (Telegram /digest и GET /api/digest) ----------
// Что поймали за сутки (Rug Feed), как держится оценка v2 (Track Record), лучшие бумажные сделки сигнальных
// стратегий, топ нарративов и сжигания. Только агрегаты и публичные данные; кэш на 10 минут.

const DAY_MS = 24 * 3600_000;
const DIGEST_CACHE_MS = 10 * 60_000;
const TRACK_MIN_SETTLED = 30; // меньше закрытых записей: доли ещё шумные, блок Track Record не показываем

const rate = (a: number, n: number) => (n ? Math.round((a / n) * 1000) / 10 : null);

async function buildDigest() {
  const now = Date.now();
  const since = now - DAY_MS;

  // Rug Feed за сутки: счётчики из готовой статистики rugs.ts, примеры «мы предупреждали» из той же ленты.
  const { rugFeed } = await import("./rugs");
  const feed = rugFeed();
  const st = feed.stats.all["24h"];
  const examples = feed.items
    .filter((x) => x.warned && x.eventAt >= since)
    // сначала подтверждённые руги, потом самые крупные по стартовой ликвидности
    .sort((a, b) => (a.kind === b.kind ? b.liq0 - a.liq0 : a.kind === "rug" ? -1 : 1))
    .slice(0, 3)
    .map((x) => ({ id: x.id, chain: x.chain, symbol: x.symbol, verdict: x.verdict, score: x.score, kind: x.kind, lowPct: x.lowPct, liqPulledPct: x.liqPulledPct, hoursToRug: x.hoursToRug, path: `/scan/${x.id}` }));

  // Track Record: только вердикты v2 после переключения (trackStats().by), ложные руги не считаем.
  const { trackStats } = await import("./track");
  const t = trackStats();
  const sumOf = (vs: string[]) => {
    const xs = t.by.filter((b) => vs.includes(b.verdict));
    const settled = xs.reduce((a, b) => a + b.settled, 0);
    const rugs = xs.reduce((a, b) => a + b.rugged - b.suspectRugs, 0);
    return { settled, rugs, rugRate: rate(rugs, settled) };
  };
  const settled = t.by.reduce((a, b) => a + b.settled, 0);
  const track = settled >= TRACK_MIN_SETTLED ? { model: "v2" as const, since: t.switchAt, settled, cleanOk: sumOf(["CLEAN", "OK"]), danger: sumOf(["DANGER"]) } : null;

  // Бумажные сделки сигнальных стратегий, закрытые за сутки: топ-3 по чистому проценту.
  let signals: { closed: number; top: { strategy: string; label: string; token: string; chain: string; symbol: string; netPct: number; reason: string; exitAt: number; path: string }[] } | null = null;
  try {
    const [{ paperExport, STRATEGIES }, { SIGNAL_STRATEGIES }] = await Promise.all([import("./paper-engine"), import("./tg-signals")]);
    const ids = SIGNAL_STRATEGIES as readonly string[];
    const trades = paperExport(since).trades.filter((x) => ids.includes(x.strategy));
    signals = {
      closed: trades.length,
      top: [...trades]
        .sort((a, b) => b.net_pct - a.net_pct)
        .slice(0, 3)
        .map((x) => ({
          strategy: x.strategy,
          label: STRATEGIES.find((s) => s.id === x.strategy)?.label ?? x.strategy,
          token: x.token,
          chain: x.chain,
          symbol: x.symbol,
          netPct: Math.round(x.net_pct * 10) / 10,
          reason: x.reason,
          exitAt: x.exit_at,
          path: `/scan/${x.token}`,
        })),
    };
  } catch (e) {
    console.warn("[digest] paper", (e as Error).message);
  }

  const narr = narrativeFeed();
  const narratives = [...narr.items]
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((n) => ({ id: n.id, title: n.title, ticker: n.ticker, heat: n.heat, stage: n.stage, score: n.score, launched: n.launched }));

  // Сжигания: байбеки казны плюс сжигания пользователей (Pro, Brain); за сутки по обоим журналам.
  const bb = await buybackStats().catch(() => null);
  const { userBurnStats } = await import("./user-burns");
  const ub = userBurnStats();
  const bb24 = (bb?.items ?? []).filter((x) => x.at >= since && x.burned > 0);
  const ub24 = ub.items.filter((x) => x.at >= since);
  const burns = bb?.configured
    ? {
        total: Math.round(bb.burned + ub.total),
        buyback: Math.round(bb.burned),
        user: Math.round(ub.total),
        buybackPct: Math.round(bb.burnedPct * 100) / 100,
        last24h: { count: bb24.length + ub24.length, tokens: Math.round(bb24.reduce((a, x) => a + x.burned, 0) + ub24.reduce((a, x) => a + x.tokens, 0)) },
        nextAt: bb.paused ? null : bb.nextAt,
      }
    : null;

  return {
    at: now,
    date: new Date(now).toISOString().slice(0, 10),
    rugs: { total: st.total, rugs: st.rugs, dumps: st.dumps, warned: st.warned, warnedPct: st.warnedPct, medianHoursToRug: st.medianHoursToRug, examples },
    track,
    signals,
    narratives,
    burns,
  };
}
export type DigestData = Awaited<ReturnType<typeof buildDigest>>;

let digestCache: { at: number; v: DigestData } | null = null;
let digestInflight: Promise<DigestData> | null = null;
export async function digestData(): Promise<DigestData> {
  if (digestCache && Date.now() - digestCache.at < DIGEST_CACHE_MS) return digestCache.v;
  return (digestInflight ??= buildDigest()
    .then((v) => ((digestCache = { at: Date.now(), v }), v))
    .finally(() => (digestInflight = null)));
}
