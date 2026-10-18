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
