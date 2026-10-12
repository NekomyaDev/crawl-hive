// Встроенный Grok Bot: владелец включает его переключателем под краулером. Бот не опрашивает ничего по
// расписанию — он просыпается только когда краулер нашёл сигнал. Ждёт 20 с, чтобы собрать пачку, сканирует
// токены (Instant Crawl без X, бесплатно) и одним дешёвым вызовом Grok пишет к каждому сигналу вывод:
// смотреть, следить или обходить. Нет сигналов — нет вызовов. Кончился бюджет Grok — вывод берётся из скана.
import "server-only";
import { extractJson, grok, grokEnabled } from "./crawl/grok";
import { runScan, type ScanResult } from "./scan";
import { annotateSignal, ApiError, getMeta, listCrawlers, onLiveSignal, setMeta } from "./store";
import type { BotTake, Signal } from "../types";

const KEY = "grokduty";
const BATCH_MS = 20_000;
const RUNS_PER_DAY = 40; // пробуждений на краулер в сутки
const SCANS_PER_RUN = 5;

interface Duty {
  wallet: string;
  since: number;
  runs: number;
  day: string;
  dayRuns: number;
  lastRunAt?: number;
}

function all(): Record<string, Duty> {
  try {
    return JSON.parse(getMeta(KEY) ?? "{}");
  } catch {
    return {};
  }
}
const save = (m: Record<string, Duty>) => setMeta(KEY, JSON.stringify(m));

export function dutyFor(wallet: string): Record<string, { since: number; runs: number; lastRunAt?: number }> {
  const out: Record<string, { since: number; runs: number; lastRunAt?: number }> = {};
  for (const [id, d] of Object.entries(all())) if (d.wallet === wallet) out[id] = { since: d.since, runs: d.runs, lastRunAt: d.lastRunAt };
  return out;
}

export const dutyCrawlerIds = () => Object.keys(all());

export function setDuty(wallet: string, crawlerId: string, on: boolean) {
  const own = listCrawlers({ owner: wallet }, wallet).find((c) => c.id === crawlerId);
  if (!own) throw new ApiError("Not your crawler", 403);
  if (!own.live) throw new ApiError("Only live crawlers can have a Grok Bot");
  const m = all();
  if (on) m[crawlerId] ??= { wallet, since: Date.now(), runs: 0, day: "", dayRuns: 0 };
  else delete m[crawlerId];
  save(m);
  return dutyFor(wallet);
}

// ---------- работа ----------

const g = globalThis as unknown as { __crawlhiveDuty?: { started: boolean; queue: Map<string, Signal[]>; timers: Map<string, NodeJS.Timeout> } };
const st = () => (g.__crawlhiveDuty ??= { started: false, queue: new Map(), timers: new Map() });

function fromScan(r: ScanResult | undefined): Omit<BotTake, "at" | "by"> {
  if (!r) return { take: "watch", note: "No token to check in this signal: read the source before acting." };
  const take = r.verdict === "CLEAN" || r.verdict === "OK" ? "look" : r.verdict === "DANGER" ? "avoid" : "watch";
  return { take, note: r.reason.slice(0, 160), verdict: r.verdict, score: r.score };
}

async function run(crawlerId: string, signals: Signal[]) {
  const m = all();
  const d = m[crawlerId];
  if (!d) return;
  const day = new Date().toISOString().slice(0, 10);
  if (d.day !== day) Object.assign(d, { day, dayRuns: 0 });
  if (d.dayRuns >= RUNS_PER_DAY) return;
  d.dayRuns++;
  d.runs++;
  d.lastRunAt = Date.now();
  save(m);

  // Сканы токенов: без X, поэтому Grok внутри не вызывается.
  const scans = new Map<string, ScanResult>();
  const tokens = [...new Map(signals.filter((s) => s.token?.address).map((s) => [s.token!.address, s.token!])).values()].slice(0, SCANS_PER_RUN);
  for (const t of tokens) {
    try {
      scans.set(t.address, await runScan(t.address, () => {}, t.chain === "robinhood" ? "robinhood" : undefined));
    } catch (e) {
      console.warn("[grok-duty] scan failed", t.address, (e as Error).message);
    }
  }

  let takes: Record<string, { take?: string; note?: string }> = {};
  let by: BotTake["by"] = "scan";
  if (grokEnabled()) {
    try {
      const brief = signals.map((s) => {
        const r = s.token?.address ? scans.get(s.token.address) : undefined;
        return {
          id: s.id,
          signal: `${s.ticker ? `$${s.ticker}: ` : ""}${s.text}`,
          confidence: s.confidence,
          scan: r ? { verdict: r.verdict, score: r.score, reason: r.reason, flags: r.factors.filter((f) => f.impact < 0).map((f) => f.label), fdv: r.market?.fdv, liquidity: r.market?.liquidityUsd, ageHours: r.market?.ageHours } : null,
        };
      });
      const { text } = await grok({
        system:
          "You are a Grok Bot on duty over a memecoin crawler. For each signal decide: look (worth opening now), watch (interesting but wait), avoid (risky). " +
          "Base it on the safety scan first, then the signal. Answer JSON only: {\"takes\":[{\"id\":\"...\",\"take\":\"look|watch|avoid\",\"note\":\"one plain sentence, max 22 words, concrete numbers when you have them\"}]}. Never promise profit.",
        user: JSON.stringify(brief),
        timeoutMs: 40_000,
      });
      const j = extractJson<{ takes?: { id?: string; take?: string; note?: string }[] }>(text);
      for (const t of j?.takes ?? []) if (t.id) takes[t.id] = t;
      by = "grok";
    } catch (e) {
      console.warn("[grok-duty] grok skipped:", (e as Error).message);
      takes = {};
    }
  }

  const { deliverBotTake } = await import("./telegram");
  for (const s of signals) {
    const r = s.token?.address ? scans.get(s.token.address) : undefined;
    const base = fromScan(r);
    const t = takes[s.id];
    const take = t && ["look", "watch", "avoid"].includes(String(t.take)) ? (t.take as BotTake["take"]) : base.take;
    const note = t?.note ? String(t.note).slice(0, 200) : base.note;
    const sig = annotateSignal(s.id, { ...base, take, note, by: t ? by : "scan", at: Date.now() });
    if (sig) deliverBotTake(sig);
  }
}

export function startGrokDuty() {
  const s = st();
  if (s.started) return;
  s.started = true;
  onLiveSignal((sig) => {
    if (!all()[sig.crawlerId]) return;
    const q = s.queue.get(sig.crawlerId) ?? [];
    q.push(sig);
    s.queue.set(sig.crawlerId, q);
    if (s.timers.has(sig.crawlerId)) return;
    // Ждём немного: краулер часто присылает несколько сигналов за один проход — разбираем их одним вызовом.
    s.timers.set(
      sig.crawlerId,
      setTimeout(() => {
        const batch = (s.queue.get(sig.crawlerId) ?? []).slice(0, 12);
        s.queue.delete(sig.crawlerId);
        s.timers.delete(sig.crawlerId);
        run(sig.crawlerId, batch).catch((e) => console.error("[grok-duty]", e));
      }, BATCH_MS),
    );
  });
  console.log("[crawlhive] grok duty listening for signals");
}
