// Живые счётчики для главной: сколько токенов просканировано за сутки, сколько монет в Track Record,
// сколько ругов сканер пометил заранее. Только настоящие данные из Track Record, кэш на 60 секунд.
import { handle } from "@/lib/server/http";
import { trackEntries } from "@/lib/server/track";

interface HomeStats {
  scans24h: number; // уникальные токены с вердиктом за 24 часа (один токен = одна запись за окно)
  coinsTracked: number; // разные токены в Track Record
  rugsFlagged: number; // DANGER/RISKY, которые потом оказались ругом
  at: number;
}

const TTL_MS = 60_000;
const host = globalThis as unknown as { __crawlhiveHomeStats?: HomeStats };

function compute(): HomeStats {
  const now = Date.now();
  const list = trackEntries();
  const ids = new Set<string>();
  let scans24h = 0;
  let rugsFlagged = 0;
  for (const e of list) {
    ids.add(e.id);
    if (now - e.at < 24 * 3600_000) scans24h++;
    if (e.rugged && (e.verdict === "DANGER" || e.verdict === "RISKY")) rugsFlagged++;
  }
  return { scans24h, coinsTracked: ids.size, rugsFlagged, at: now };
}

export async function GET() {
  return handle(() => {
    const c = host.__crawlhiveHomeStats;
    if (c && Date.now() - c.at < TTL_MS) return c;
    return (host.__crawlhiveHomeStats = compute());
  });
}
