// Планировщик живых краулеров. Каждые 15 секунд берёт краулеров, которым пора на обход,
// запускает сборщик их источника (не больше 3 одновременно) и проверяет исходы старых сигналов.
import "server-only";
import { claimRun, dueCrawlers, dueOutcomes, recordRun, resolveOutcome, type LiveJob } from "../store";
import { bestPairs, priceOf } from "./dexscreener";
import { crawlX } from "./sources/x";
import { crawlTelegram } from "./sources/telegram";
import { crawlOnchain } from "./sources/onchain";
import { crawlDocs } from "./sources/docs";
import type { SourceResult } from "./sources/types";

const TICK_MS = 15_000;
const MAX_PARALLEL = 3;
const JOB_TIMEOUT_MS = 240_000;
// X через Grok стоит денег за каждый найденный пост, поэтому обходим не чаще раза в N минут,
// даже если тир разрешает чаще.
const xMinInterval = () => Number(process.env.X_MIN_INTERVAL_MIN ?? 30);

const g = globalThis as unknown as { __crawlhiveScheduler?: { timer: ReturnType<typeof setInterval>; running: Set<string> } };

const SOURCES: Record<LiveJob["source"], (job: LiveJob) => Promise<SourceResult>> = {
  x: crawlX,
  telegram: crawlTelegram,
  onchain: crawlOnchain,
  docs: crawlDocs,
};

async function runJob(job: LiveJob, running: Set<string>) {
  running.add(job.id);
  const started = Date.now();
  const lastOk = Number(job.cursor.lastOkAt ?? started);
  try {
    const result = await Promise.race([
      SOURCES[job.source](job),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("Crawl timed out")), JOB_TIMEOUT_MS)),
    ]);
    // В аптайм идёт время с прошлого успешного прохода, но не больше двух интервалов.
    const creditSec = Math.min((started - lastOk) / 1000, job.frequencyMin * 120) || job.frequencyMin * 60;
    recordRun(job.id, {
      ok: true,
      items: result.items,
      signals: result.signals,
      cursor: { ...result.cursor, lastOkAt: String(started) },
      creditSec,
    });
  } catch (e) {
    recordRun(job.id, { ok: false, items: 0, signals: [], error: (e as Error).message.slice(0, 300), creditSec: 0 });
  } finally {
    running.delete(job.id);
  }
}

// Проверка исходов: цена токена через horizonMin минут после сигнала.
async function checkOutcomes() {
  const due = dueOutcomes();
  const byChain = new Map<string, typeof due>();
  for (const d of due) byChain.set(d.token.chain, [...(byChain.get(d.token.chain) ?? []), d]);
  for (const [chain, list] of byChain) {
    try {
      const pairs = await bestPairs(chain, [...new Set(list.map((d) => d.token.address))]);
      for (const d of list) resolveOutcome(d.id, priceOf(pairs.get(d.token.address)) ?? null);
    } catch {
      // DexScreener недоступен — попробуем на следующем тике
    }
  }
}

async function tick(running: Set<string>) {
  try {
    await checkOutcomes();
  } catch (e) {
    console.error("outcomes", e);
  }
  const free = MAX_PARALLEL - running.size;
  if (free <= 0) return;
  const jobs = dueCrawlers().filter((j) => !running.has(j.id)).slice(0, free);
  for (const job of jobs) {
    claimRun(job.id, job.source === "x" ? xMinInterval() : 0);
    void runJob(job, running);
  }
}

export function startScheduler() {
  if (g.__crawlhiveScheduler || process.env.CRAWL_DISABLED === "1") return;
  const running = new Set<string>();
  const timer = setInterval(() => void tick(running), TICK_MS);
  g.__crawlhiveScheduler = { timer, running };
  void tick(running);
  console.log("[crawlhive] crawler scheduler started");
}
