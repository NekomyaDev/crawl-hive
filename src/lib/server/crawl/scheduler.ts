// Планировщик живых краулеров. Каждые 15 секунд берёт краулеров, которым пора на обход,
// запускает сборщик их источника (не больше 3 одновременно) и проверяет исходы старых сигналов.
import "server-only";
import { claimRun, dueCrawlers, dueOutcomes, pendingOutcomes, recordRun, resolveOutcome, sampleOutcome, type LiveJob } from "../store";
import { bestPairs, priceOf } from "./dexscreener";
import { crawlX } from "./sources/x";
import { crawlTelegram } from "./sources/telegram";
import { crawlOnchain } from "./sources/onchain";
import { crawlDocs } from "./sources/docs";
import type { SourceResult } from "./sources/types";
import { X_MIN_INTERVAL_MIN } from "../../economy";

const TICK_MS = 15_000;
const MAX_PARALLEL = 3;
const JOB_TIMEOUT_MS = 240_000;
// X через Grok стоит денег за каждый прогон, поэтому обходим не чаще интервала тира (economy.ts),
// даже если частота краулера выше. X_MIN_INTERVAL_MIN поднимает нижнюю планку для всех тиров.
const xMinInterval = (tier: LiveJob["tier"]) => Math.max(X_MIN_INTERVAL_MIN[tier], Number(process.env.X_MIN_INTERVAL_MIN ?? 0));

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
      filtered: result.filtered,
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

// Пик и просадка за окно: раз в 5 минут смотрим текущую цену всех сигналов, которые ещё ждут оценки.
const SAMPLE_MS = 5 * 60_000;
let lastSample = 0;
async function sampleOutcomes() {
  if (Date.now() - lastSample < SAMPLE_MS) return;
  lastSample = Date.now();
  const byChain = new Map<string, { id: string; address: string }[]>();
  for (const p of pendingOutcomes()) byChain.set(p.token.chain, [...(byChain.get(p.token.chain) ?? []), { id: p.id, address: p.token.address }]);
  for (const [chain, list] of byChain) {
    try {
      const pairs = await bestPairs(chain, [...new Set(list.map((x) => x.address))]);
      for (const x of list) {
        const price = priceOf(pairs.get(x.address));
        if (price) sampleOutcome(x.id, price);
      }
    } catch {
      // DexScreener недоступен — следующий замер через 5 минут
    }
  }
}

async function tick(running: Set<string>) {
  try {
    await sampleOutcomes();
    await checkOutcomes();
  } catch (e) {
    console.error("outcomes", e);
  }
  const free = MAX_PARALLEL - running.size;
  if (free <= 0) return;
  const jobs = dueCrawlers().filter((j) => !running.has(j.id)).slice(0, free);
  for (const job of jobs) {
    claimRun(job.id, job.source === "x" ? xMinInterval(job.tier) : 0);
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
