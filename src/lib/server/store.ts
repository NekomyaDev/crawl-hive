// Хранилище сети. Демо-сеть (130 краулеров) симулируется в памяти; живые краулеры пользователей,
// их сигналы и балансы сохраняются на диск (persist.ts) и реально собирают данные (crawl/*).
import { checkPublicUrl } from "./safe-fetch";
import "server-only";
import type {
  Crawler,
  CrawlerStatus,
  Listing,
  Narrative,
  NetworkStats,
  Proposal,
  PublicCrawler,
  Signal,
  SignalKind,
  Source,
  SwarmLink,
  SwarmNode,
  Tier,
  Chain,
  WalletInfo,
} from "../types";
import { NARRATIVES, SOURCES, CHAINS } from "../types";
import { TIERS, DEMO_AIRDROP, EPOCH_REWARD, EPOCH_SEC, MARKET_FEE_BURN, PROPOSAL_MIN_BALANCE, CRAWLER_TERM_DAYS } from "../economy";
import { computeReputation } from "../reputation";
import { seedNetwork, mulberry32, crawlerId, pick, TICKERS, type Rng } from "./seed";
import { loadSnapshot, scheduleSave, type Snapshot } from "./persist";
import { normalizeSpec } from "../spec";
import { TEMPLATE_IDS } from "../templates";
import type { BotTake, CrawlerSpec, CrawlerRunState, SignalOutcome } from "../types";

interface State {
  crawlers: Map<string, Crawler>;
  balances: Map<string, number>;
  burnedBy: Map<string, number>;
  listings: Map<string, Listing>;
  proposals: Map<string, Proposal>;
  votes: Map<string, Map<string, { option: string; weight: number }>>; // proposal -> wallet -> голос
  narrativeLinks: [string, string][];
  signals: Signal[]; // последние сигналы демо-сети, новые в начале
  liveSignals: Signal[]; // сигналы живых краулеров (приватные), новые в начале
  seedIds: Set<string>; // id краулеров демо-сети — их не сохраняем
  usedSigs: Set<string>; // платёжные транзакции, уже использованные для спавна
  seedWallets?: Set<string>; // кошельки демо-сети
  meta: Record<string, string>;
  signalTimes: number[]; // метки времени сигналов за 24ч (для счётчика)
  lastTick: number;
  epochStart: number;
  totalBurned: number;
  rng: Rng;
  listeners: Set<(e: StreamEvent) => void>;
}

export type StreamEvent =
  | { type: "signal"; signal: Signal }
  | { type: "spawn"; crawler: PublicCrawler }
  | { type: "status"; id: string; status: CrawlerStatus }
  | { type: "trade"; listing: Listing; buyer: string };

export class ApiError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

// Демо-сеть (симулированные краулеры, лоты и голосования) нужна для показа. На проде её выключают
// DEMO_NETWORK=0, и на сайте остаются только настоящие краулеры пользователей.
export const demoNetwork = () => process.env.DEMO_NETWORK?.trim() !== "0";

export const termDays = () => {
  const n = Number(process.env.CRAWLER_TERM_DAYS);
  return n > 0 && n <= 365 ? n : CRAWLER_TERM_DAYS;
};
const termMs = () => termDays() * 86400_000;

export const isExpired = (c: Pick<Crawler, "expiresAt" | "live">, now = Date.now()) =>
  !!c.live && !!c.expiresAt && c.expiresAt <= now;

// Храним состояние на globalThis, чтобы горячая перезагрузка в dev его не сбрасывала.
const g = globalThis as unknown as { __crawlhive?: State };

function init(): State {
  const now = Date.now();
  const seed = demoNetwork()
    ? seedNetwork(now)
    : { crawlers: [], balances: new Map<string, number>(), burnedBy: new Map<string, number>(), listings: [], proposals: [], narrativeLinks: [] as [string, string][] };
  const saved = loadSnapshot();
  const crawlers = new Map(seed.crawlers.map((c) => [c.id, c]));
  // Живые краулеры с прошлого запуска. Время простоя сервера не считаем аптаймом.
  for (const c of saved.crawlers) {
    // Очередь краулера сохраняется: перезапуск сервера не повод для внеочередного (а у X — платного) прогона.
    if (c.run) c.run.nextRunAt = Math.max(now + 5_000, c.run.nextRunAt ?? 0);
    // Краулеры, созданные до введения срока, получают полный срок с момента обновления.
    if (c.live && !c.expiresAt) c.expiresAt = now + termMs();
    crawlers.set(c.id, c);
  }
  for (const [w, b] of Object.entries(saved.balances)) seed.balances.set(w, b);
  for (const [w, b] of Object.entries(saved.burnedBy)) seed.burnedBy.set(w, b);
  const totalBurned = [...crawlers.values()].reduce((s, c) => s + c.burned, 0);
  // Планировщик живых краулеров стартует вместе с хранилищем (динамический импорт — без циклов).
  // Grok Bot подписывается на сигналы раньше, чем планировщик успеет их найти.
  setTimeout(() => import("./grok-duty").then((m) => m.startGrokDuty()).catch((e) => console.error(e)), 500);
  setTimeout(() => import("./crawl/scheduler").then((m) => m.startScheduler()).catch((e) => console.error(e)), 1000);
  setTimeout(() => import("./telegram").then((m) => m.startTelegram()).catch((e) => console.error(e)), 1500);
  setTimeout(() => import("./radar").then((m) => m.startRadar()).catch((e) => console.error(e)), 2000);
  setTimeout(() => import("./proof").then((m) => m.startProof()).catch((e) => console.error(e)), 2500);
  setTimeout(() => import("./narrative-radar").then((m) => m.startNarrativeRadar()).catch((e) => console.error(e)), 3000);
  setTimeout(() => import("./x-bot").then((m) => m.startXBot()).catch((e) => console.error(e)), 5000);
  setTimeout(() => import("./wallet-watch").then((m) => m.startWalletWatch()).catch((e) => console.error(e)), 3500);

  return {
    crawlers,
    balances: seed.balances,
    burnedBy: seed.burnedBy,
    listings: new Map(seed.listings.map((l) => [l.id, l])),
    proposals: new Map(seed.proposals.map((p) => [p.id, p])),
    votes: new Map(),
    narrativeLinks: seed.narrativeLinks,
    signals: [],
    liveSignals: saved.signals,
    seedIds: new Set(seed.crawlers.map((c) => c.id)),
    seedWallets: new Set(seed.crawlers.map((c) => c.owner)),
    usedSigs: new Set(saved.usedSigs),
    meta: saved.meta,
    signalTimes: [],
    lastTick: now,
    epochStart: now,
    totalBurned,
    rng: mulberry32(now & 0xffffffff),
    listeners: new Set(),
  };
}

function state(): State {
  if (!g.__crawlhive) g.__crawlhive = init();
  tick(g.__crawlhive);
  return g.__crawlhive;
}

// ---------- сохранение ----------

function snapshot(s: State): Snapshot {
  const user = [...s.crawlers.values()].filter((c) => !s.seedIds.has(c.id));
  const wallets = new Set(user.flatMap((c) => [c.owner, c.renter].filter(Boolean) as string[]));
  for (const w of s.balances.keys()) if (!s.seedWallets?.has(w)) wallets.add(w);
  const pick = (m: Map<string, number>) => Object.fromEntries([...wallets].filter((w) => m.has(w)).map((w) => [w, m.get(w)!]));
  return {
    version: 1,
    crawlers: user,
    signals: s.liveSignals.slice(0, 5000),
    usedSigs: [...s.usedSigs],
    balances: pick(s.balances),
    burnedBy: pick(s.burnedBy),
    meta: s.meta,
  };
}

function markDirty(s: State) {
  scheduleSave(() => snapshot(s));
}

export function metaValue(key: string, init: () => string): string {
  const s = state();
  if (!s.meta[key]) {
    s.meta[key] = init();
    markDirty(s);
  }
  return s.meta[key];
}

export function isSigUsed(sig: string) {
  return state().usedSigs.has(sig);
}

export function markSigUsed(sig: string) {
  const s = state();
  s.usedSigs.add(sig);
  markDirty(s);
}

function emit(s: State, e: StreamEvent) {
  for (const l of s.listeners) {
    try {
      l(e);
    } catch {
      // подписчик отвалился — его уберёт сам стрим
    }
  }
}

// ---------- симуляция ----------

const SIGNAL_TEXT: Record<Source, { kind: SignalKind; text: (t: string) => string }[]> = {
  x: [
    { kind: "mention_spike", text: (t) => `$${t} mentions up 4.2x in 15 min across tracked accounts` },
    { kind: "kol_call", text: (t) => `KOL with 180k followers just posted $${t} chart` },
  ],
  telegram: [
    { kind: "kol_call", text: (t) => `$${t} called in 3 alpha groups within 5 min` },
    { kind: "mention_spike", text: (t) => `$${t} chatter spike, 900 msgs/10 min` },
  ],
  onchain: [
    { kind: "new_pair", text: (t) => `New pool $${t}/SOL, LP 42 SOL, dev holds 3%` },
    { kind: "whale_buy", text: (t) => `Top-100 wallet bought $${t} for 120 SOL` },
  ],
  docs: [
    { kind: "doc_update", text: (t) => `$${t} team pushed a roadmap update to their docs` },
    { kind: "doc_update", text: (t) => `New repo trending: ${t.toLowerCase()}-agent, 400 stars/day` },
  ],
};

function poisson(rng: Rng, lambda: number): number {
  // Для маленьких lambda хватает простого алгоритма Кнута.
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L);
  return k - 1;
}

function tick(s: State) {
  const now = Date.now();
  const dt = Math.min(60, (now - s.lastTick) / 1000);
  if (dt < 0.25) return;
  s.lastTick = now;

  // Истекшая аренда возвращает краулер владельцу.
  for (const c of s.crawlers.values()) {
    if (c.status === "rented" && c.rentedUntil && c.rentedUntil < now) {
      c.status = "active";
      c.renter = undefined;
      c.rentedUntil = undefined;
      restoreOwnerConfig(c);
      emit(s, { type: "status", id: c.id, status: c.status });
    }
  }

  const working = [...s.crawlers.values()].filter((c) => c.status !== "paused");
  const weightSum = working.reduce((sum, c) => sum + c.reputation * TIERS[c.tier].rewardBoost, 0) || 1;
  const emission = (EPOCH_REWARD / EPOCH_SEC) * dt;

  for (const c of s.crawlers.values()) {
    c.stats.totalSec += dt;
    if (c.status === "paused") {
      c.reputation = computeReputation(c);
      continue;
    }
    if (c.live) {
      if (isExpired(c, now)) continue; // срок вышел: ни наград, ни аптайма, пока не продлят
      // Живой краулер: данные, сигналы и аптайм приходят от планировщика, здесь только награды.
      const reward = (emission * c.reputation * TIERS[c.tier].rewardBoost) / weightSum;
      c.stats.rewards += reward;
      const earner = c.renter ?? c.owner;
      s.balances.set(earner, (s.balances.get(earner) ?? 0) + reward);
      c.reputation = computeReputation(c);
      continue;
    }
    c.stats.uptimeSec += dt * (0.985 + s.rng() * 0.015);
    // Копим дробную часть: у медленного краулера за тик набегает меньше одной единицы.
    c.stats.items += ((c.targets.length * 40) / (c.frequencyMin * 60)) * dt * (0.6 + s.rng() * 0.8);

    const n = poisson(s.rng, 0.0035 * dt * TIERS[c.tier].rewardBoost);
    for (let i = 0; i < n; i++) {
      c.stats.signals++;
      if (s.rng() < c.skill) c.stats.hits++;
      const tpl = pick(s.rng, SIGNAL_TEXT[c.source]);
      const ticker = pick(s.rng, TICKERS);
      const sig: Signal = {
        id: `${now.toString(36)}-${c.id}-${i}`,
        crawlerId: c.id,
        crawlerName: c.name,
        source: c.source,
        kind: tpl.kind,
        ticker,
        text: tpl.text(ticker),
        ts: now,
        confidence: Math.min(0.99, c.skill * (0.8 + s.rng() * 0.4)),
      };
      s.signals.unshift(sig);
      s.signalTimes.push(now);
      emit(s, { type: "signal", signal: sig });
    }

    // Награды идут тому, кто сейчас управляет краулером: арендатору, если он сдан.
    const reward = (emission * c.reputation * TIERS[c.tier].rewardBoost) / weightSum;
    c.stats.rewards += reward;
    const earner = c.renter ?? c.owner;
    s.balances.set(earner, (s.balances.get(earner) ?? 0) + reward);
    c.reputation = computeReputation(c);
  }

  if (s.signals.length > 300) s.signals.length = 300;
  const dayAgo = now - 86400_000;
  while (s.signalTimes.length && s.signalTimes[0] < dayAgo) s.signalTimes.shift();
  if (now - s.epochStart > EPOCH_SEC * 1000) s.epochStart = now;
  if ([...s.crawlers.values()].some((c) => c.live)) markDirty(s);
}

// ---------- чтение ----------

// viewer — кошелёк, который смотрит. Спецификация и курсоры видны только владельцу и арендатору:
// инструкции краулера — это чужое преимущество.
export function toPublic(c: Crawler, viewer?: string): PublicCrawler {
  const { skill: _skill, spec, run, ownerConfig: _ownerConfig, ...rest } = c;
  const mine = !!viewer && (viewer === c.owner || viewer === c.renter);
  return {
    ...rest,
    spec: mine ? spec : undefined,
    // Текст ошибки обхода видит только владелец: по нему иначе можно было бы прощупывать чужие адреса.
    run: run ? { ...run, cursor: {}, lastError: mine ? run.lastError : run.lastError ? "crawl failed" : undefined } : undefined,
    stats: { ...c.stats, items: Math.floor(c.stats.items), rewards: Math.round(c.stats.rewards) },
  };
}

// Сигнал живого краулера в публичной ленте: видно, что он сработал, но не что именно нашёл.
function redact(sig: Signal, viewer?: string): Signal {
  if (!sig.live || (viewer && sig.owner === viewer)) return sig;
  return {
    id: sig.id,
    crawlerId: sig.crawlerId,
    crawlerName: sig.crawlerName,
    source: sig.source,
    kind: sig.kind,
    ticker: "",
    text: "Private signal: visible to the crawler's owner",
    ts: sig.ts,
    confidence: sig.confidence,
    live: true,
    redacted: true,
    jev: sig.jev,
    outcome: sig.outcome ? { status: sig.outcome.status, changePct: sig.outcome.changePct, peakPct: sig.outcome.peakPct } : undefined,
  };
}

export interface CrawlerFilter {
  owner?: string;
  narrative?: string;
  source?: string;
  chain?: string;
}

export function listCrawlers(f: CrawlerFilter = {}, viewer?: string): PublicCrawler[] {
  const s = state();
  return [...s.crawlers.values()]
    .filter((c) => !f.owner || c.owner === f.owner || c.renter === f.owner)
    .filter((c) => !f.narrative || c.narratives.includes(f.narrative as Narrative))
    .filter((c) => !f.source || c.source === f.source)
    .filter((c) => !f.chain || c.chain === f.chain)
    .map((c) => toPublic(c, viewer));
}

export function getCrawler(id: string, viewer?: string): PublicCrawler & { recentSignals: Signal[] } {
  const s = state();
  const c = s.crawlers.get(id);
  if (!c) throw new ApiError("Crawler not found", 404);
  const pool = c.live ? s.liveSignals : s.signals;
  return {
    ...toPublic(c, viewer),
    recentSignals: pool
      .filter((x) => x.crawlerId === id)
      .slice(0, 30)
      .map((x) => redact(x, viewer)),
  };
}

export function recentSignals(limit = 40, viewer?: string): Signal[] {
  const s = state();
  return [...s.signals.slice(0, limit), ...s.liveSignals.slice(0, limit)]
    .sort((a, b) => b.ts - a.ts)
    .slice(0, limit)
    .map((x) => redact(x, viewer));
}

// Личная лента: все сигналы, принадлежащие кошельку (его краулеры и арендованные на момент сигнала).
export function mySignals(wallet: string, f: { crawlerId?: string; status?: string; limit?: number } = {}) {
  const s = state();
  return s.liveSignals
    .filter((x) => x.owner === wallet)
    .filter((x) => !f.crawlerId || x.crawlerId === f.crawlerId)
    .filter((x) => !f.status || x.outcome?.status === f.status)
    .slice(0, Math.min(500, f.limit ?? 200));
}

export function networkStats(): NetworkStats {
  const s = state();
  const all = [...s.crawlers.values()];
  const active = all.filter((c) => c.status !== "paused" && !isExpired(c));
  const live = all.filter((c) => c.live);
  const itemsPerMin = active.reduce((sum, c) => sum + (c.targets.length * 40) / c.frequencyMin, 0);
  const owners = new Set(all.map((c) => c.owner));
  return {
    activeCrawlers: active.length,
    totalCrawlers: all.length,
    wallets: owners.size,
    itemsPerMin: Math.round(itemsPerMin),
    // Демо-сеть живёт минуты, поэтому к её счётчику добавляем базу из истории краулеров. Живые считаем как есть.
    signals24h: demoNetwork()
      ? s.signalTimes.length + Math.round(active.length * 0.0035 * 86400 * 0.15)
      : s.liveSignals.filter((x) => x.ts > Date.now() - 86400_000).length,
    totalBurned: s.totalBurned,
    epochReward: EPOCH_REWARD,
    epochEndsAt: s.epochStart + EPOCH_SEC * 1000,
    scored: live.reduce((n, c) => n + (c.stats.scored ?? 0), 0),
    hits: live.reduce((n, c) => n + c.stats.hits, 0),
    demo: demoNetwork(),
  };
}

// Track Record краулеров: исходы сигналов живых краулеров. Тикеры не раскрываем — сигналы приватные.
export function signalTrack() {
  const done = state().liveSignals.filter((x) => x.outcome && (x.outcome.status === "hit" || x.outcome.status === "miss"));
  const peaks = done.map((x) => x.outcome!.peakPct ?? x.outcome!.changePct ?? 0).sort((a, b) => a - b);
  return {
    scored: done.length,
    hits: done.filter((x) => x.outcome!.status === "hit").length,
    medianPeak: peaks.length ? peaks[Math.floor(peaks.length / 2)] : null,
    recent: done.slice(0, 15).map((x) => ({
      crawlerId: x.crawlerId,
      crawlerName: x.crawlerName,
      kind: x.kind,
      ts: x.ts,
      status: x.outcome!.status,
      peakPct: x.outcome!.peakPct ?? null,
      changePct: x.outcome!.changePct ?? null,
      jev: x.jev?.p ?? null,
    })),
  };
}

export function swarmGraph(): { nodes: SwarmNode[]; links: SwarmLink[] } {
  const s = state();
  const nodes: SwarmNode[] = [];
  const links: SwarmLink[] = [];
  const wallets = new Map<string, number[]>();
  for (const c of s.crawlers.values()) {
    nodes.push({
      id: c.id,
      kind: "crawler",
      label: c.name,
      source: c.source,
      chain: c.chain,
      narratives: c.narratives,
      reputation: c.reputation,
      status: c.status,
      tier: c.tier,
    });
    links.push({ source: c.owner, target: c.id, kind: "owns" });
    if (c.renter) links.push({ source: c.renter, target: c.id, kind: "rents" });
    for (const w of [c.owner, c.renter].filter(Boolean) as string[]) {
      if (!wallets.has(w)) wallets.set(w, []);
      wallets.get(w)!.push(c.reputation);
    }
  }
  for (const [addr, reps] of wallets) {
    nodes.push({
      id: addr,
      kind: "wallet",
      label: short(addr),
      reputation: Math.round(reps.reduce((a, b) => a + b, 0) / reps.length),
    });
  }
  for (const [a, b] of s.narrativeLinks) {
    if (s.crawlers.has(a) && s.crawlers.has(b)) links.push({ source: a, target: b, kind: "narrative" });
  }
  return { nodes, links };
}

export type LeaderboardSort = "reputation" | "items" | "rewards" | "uptime" | "precision";

export function leaderboard(sort: LeaderboardSort = "reputation", limit = 50) {
  const s = state();
  const key = (c: Crawler) => {
    switch (sort) {
      case "items":
        return c.stats.items;
      case "rewards":
        return c.stats.rewards;
      case "uptime":
        return c.stats.uptimeSec / Math.max(1, c.stats.totalSec);
      case "precision":
        return (c.stats.hits + 2.5) / ((c.stats.scored ?? c.stats.signals) + 5);
      default:
        return c.reputation;
    }
  };
  return [...s.crawlers.values()]
    .sort((a, b) => key(b) - key(a))
    .slice(0, limit)
    .map((c) => toPublic(c));
}

export function walletInfo(address: string): WalletInfo {
  const s = state();
  ensureWallet(s, address);
  const mine = [...s.crawlers.values()].filter((c) => c.owner === address);
  return {
    address,
    balance: Math.round(s.balances.get(address) ?? 0),
    burned: s.burnedBy.get(address) ?? 0,
    crawlers: mine.length,
    reputation: mine.length ? Math.round(mine.reduce((a, c) => a + c.reputation, 0) / mine.length) : 0,
  };
}

export function topWallets(limit = 20): WalletInfo[] {
  const s = state();
  const owners = new Set([...s.crawlers.values()].map((c) => c.owner));
  return [...owners]
    .map((a) => walletInfo(a))
    .sort((a, b) => b.reputation * Math.log10(b.crawlers + 1) - a.reputation * Math.log10(a.crawlers + 1))
    .slice(0, limit);
}

// ---------- запись ----------

function ensureWallet(s: State, address: string) {
  if (!s.balances.has(address)) {
    // Стартовые credits раздаём только в демо: на проде их зарабатывают краулеры.
    s.balances.set(address, demoNetwork() ? DEMO_AIRDROP : 0);
    markDirty(s);
  }
}

function debit(s: State, address: string, amount: number) {
  ensureWallet(s, address);
  const bal = s.balances.get(address)!;
  if (bal < amount) throw new ApiError(`Not enough credits: need ${amount.toLocaleString()}, have ${Math.floor(bal).toLocaleString()}`);
  s.balances.set(address, bal - amount);
}

function burn(s: State, address: string, amount: number) {
  debit(s, address, amount);
  s.totalBurned += amount;
  s.burnedBy.set(address, (s.burnedBy.get(address) ?? 0) + amount);
}

export interface SpawnInput {
  name: string;
  source: Source;
  chain: Chain;
  narratives: Narrative[];
  targets: string[];
  frequencyMin: number;
  tier: Tier;
  spec?: Partial<CrawlerSpec>;
  template?: string;
}

// Цели приводим к виду, который понимает сборщик конкретного источника.
export function normalizeTargets(source: Source, raw: string[]): string[] {
  const out: string[] = [];
  for (const r of raw.map((t) => String(t).trim()).filter(Boolean)) {
    let t = r;
    if (source === "x") {
      const h = t.replace(/^https?:\/\/(x|twitter)\.com\//i, "@").split(/[/?]/)[0];
      if (/^@[A-Za-z0-9_]{1,15}$/.test(h)) t = h;
      else if (t.startsWith("@")) throw new ApiError(`Not a valid X handle: ${r}`);
      else t = t.slice(0, 80); // поисковый запрос
    } else if (source === "telegram") {
      const name = t.replace(/^https?:\/\//i, "").replace(/^t\.me\/(s\/)?/i, "").replace(/^@/, "").split(/[/?]/)[0];
      if (!/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(name)) throw new ApiError(`Not a public Telegram channel: ${r}`);
      t = `t.me/${name}`;
    } else if (source === "docs") {
      const url = /^https?:\/\//i.test(t) ? t : `https://${t}`;
      try {
        const u = checkPublicUrl(url); // только http(s), порты 80/443, не частные адреса
        if (!u.hostname.includes(".")) throw new Error();
        t = u.toString();
      } catch {
        throw new ApiError(`Not a valid URL: ${r}`);
      }
    } else {
      t = t.slice(0, 90); // on-chain: адрес токена/пары или ключевое слово
    }
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

// Проверка параметров спавна. Возвращает нормализованный ввод; ничего не меняет в состоянии.
export function validateSpawn(input: SpawnInput): SpawnInput {
  const tier = TIERS[input?.tier];
  if (!tier) throw new ApiError("Unknown tier");
  if (!SOURCES.includes(input.source)) throw new ApiError("Unknown source");
  if (!CHAINS.includes(input.chain)) throw new ApiError("Unknown chain");
  const name = String(input.name ?? "").trim();
  if (name.length < 2 || name.length > 24) throw new ApiError("Name must be 2-24 characters");
  const narratives = (input.narratives ?? []).filter((n) => NARRATIVES.includes(n));
  if (!narratives.length || narratives.length > 3) throw new ApiError("Pick 1-3 narratives");
  const targets = normalizeTargets(input.source, input.targets ?? []);
  // On-chain может работать только по лентам DexScreener, остальным нужны цели.
  if (!targets.length && input.source !== "onchain") throw new ApiError("Add at least one target");
  if (targets.length > tier.maxTargets) throw new ApiError(`${tier.label} tier allows up to ${tier.maxTargets} targets`);
  const freq = Math.round(Number(input.frequencyMin));
  if (!(freq >= tier.minFrequency && freq <= 1440))
    throw new ApiError(`${tier.label} tier crawls at most every ${tier.minFrequency} min`);
  let spec: CrawlerSpec;
  try {
    spec = normalizeSpec(input.spec, input.source);
  } catch (e) {
    throw new ApiError((e as Error).message);
  }
  const template = input.template && TEMPLATE_IDS.has(input.template) ? input.template : undefined;
  return { name, source: input.source, chain: input.chain, narratives, targets, frequencyMin: freq, tier: input.tier, spec, template };
}

// Симулированный спавн: списываем из внутреннего баланса. Используется, когда минт не настроен.
export function spawnCrawler(wallet: string, input: SpawnInput): PublicCrawler {
  const s = state();
  const v = validateSpawn(input);
  burn(s, wallet, TIERS[v.tier].burn);
  return createCrawler(s, wallet, v);
}

// On-chain спавн: оплата уже проверена по транзакции, внутренний баланс не трогаем.
// burnedTokens > 0 только при реальном сжигании токена проекта; оплата в SOL в счётчик сожжённых токенов не идёт.
export function spawnCrawlerPaid(
  wallet: string,
  input: SpawnInput,
  payment: NonNullable<Crawler["payment"]>,
  burnedTokens: number,
): PublicCrawler {
  const s = state();
  const v = validateSpawn(input);
  s.totalBurned += burnedTokens;
  s.burnedBy.set(wallet, (s.burnedBy.get(wallet) ?? 0) + burnedTokens);
  return createCrawler(s, wallet, v, payment);
}

function createCrawler(s: State, wallet: string, v: SpawnInput, payment?: Crawler["payment"]): PublicCrawler {
  const tier = TIERS[v.tier];
  let id = crawlerId(s.rng);
  while (s.crawlers.has(id)) id = crawlerId(s.rng);
  const c: Crawler = {
    id,
    name: v.name,
    owner: wallet,
    source: v.source,
    chain: v.chain,
    narratives: v.narratives,
    targets: v.targets,
    frequencyMin: v.frequencyMin,
    tier: v.tier,
    // Ставка в репутации считается от эквивалента тира, чем бы ни платили.
    burned: tier.burn,
    payment,
    template: v.template,
    expiresAt: Date.now() + termMs(),
    status: "active",
    createdAt: Date.now(),
    stats: { items: 0, signals: 0, hits: 0, uptimeSec: 0, totalSec: 0, rewards: 0 },
    reputation: 0,
    skill: 0,
    // Краулеры пользователей живые: их обходит планировщик (crawl/scheduler.ts).
    live: true,
    spec: v.spec ? normalizeSpec(v.spec, v.source) : normalizeSpec(undefined, v.source),
    run: { nextRunAt: Date.now() + 3_000, runs: 0, failedRuns: 0, cursor: {} },
  };
  c.stats.scored = 0;
  c.reputation = computeReputation(c);
  s.crawlers.set(id, c);
  markDirty(s);
  const peers = [...s.crawlers.values()].filter((p) => p.id !== id && p.narratives[0] === v.narratives[0]);
  if (peers.length) s.narrativeLinks.push([id, pick(s.rng, peers).id]);
  emit(s, { type: "spawn", crawler: toPublic(c) });
  return toPublic(c, wallet);
}

// Владелец, которому можно продлить краулер: проверка до создания платёжного намерения.
export function renewableCrawler(wallet: string, id: string): { tier: Tier; name: string } {
  const c = state().crawlers.get(id);
  if (!c || !c.live) throw new ApiError("Crawler not found", 404);
  if (c.owner !== wallet) throw new ApiError("Only the owner can renew a crawler", 403);
  return { tier: c.tier, name: c.name };
}

// Оплата продления проверена: добавляем срок к оставшемуся (или к сегодняшнему дню, если уже истёк).
export function renewCrawler(wallet: string, id: string, payment: { unit: string; amount: number; tx: string }): PublicCrawler {
  const s = state();
  const c = s.crawlers.get(id);
  if (!c || !c.live) throw new ApiError("Crawler not found", 404);
  if (c.owner !== wallet) throw new ApiError("Only the owner can renew a crawler", 403);
  const now = Date.now();
  const wasExpired = isExpired(c, now);
  c.expiresAt = Math.max(now, c.expiresAt ?? now) + termMs();
  c.renewals = [...(c.renewals ?? []), { ...payment, at: now }];
  if (wasExpired && c.run) c.run.nextRunAt = now + 3_000;
  markDirty(s);
  return toPublic(c, wallet);
}

// Продление без on-chain оплаты (режим simulated): списываем credits по цене тира.
export function renewCrawlerWithCredits(wallet: string, id: string): PublicCrawler {
  const s = state();
  const { tier } = renewableCrawler(wallet, id);
  burn(s, wallet, TIERS[tier].burn);
  return renewCrawler(wallet, id, { unit: "credits", amount: TIERS[tier].burn, tx: "" });
}

export function setCrawlerStatus(wallet: string, id: string, status: "active" | "paused"): PublicCrawler {
  const s = state();
  const c = s.crawlers.get(id);
  if (!c) throw new ApiError("Crawler not found", 404);
  if (c.owner !== wallet) throw new ApiError("Not your crawler", 403);
  if (c.status === "rented") throw new ApiError("Crawler is rented out until the lease ends");
  c.status = status;
  if (status === "active" && c.run) c.run.nextRunAt = Date.now() + 2_000;
  markDirty(s);
  emit(s, { type: "status", id, status });
  return toPublic(c);
}

// Владелец или арендатор правит цели, частоту и спецификацию. Новые настройки вступают в силу со следующего прохода.
function restoreOwnerConfig(c: Crawler) {
  if (!c.ownerConfig) return;
  c.targets = c.ownerConfig.targets;
  c.frequencyMin = c.ownerConfig.frequencyMin;
  if (c.ownerConfig.spec) c.spec = c.ownerConfig.spec;
  c.ownerConfig = undefined;
}

export function updateCrawlerConfig(
  wallet: string,
  id: string,
  patch: { targets?: string[]; frequencyMin?: number; spec?: Partial<CrawlerSpec> },
): PublicCrawler {
  const s = state();
  const c = s.crawlers.get(id);
  if (!c) throw new ApiError("Crawler not found", 404);
  if (c.owner !== wallet && c.renter !== wallet) throw new ApiError("Not your crawler", 403);
  // Арендатор настраивает краулер под себя, но после аренды владелец получает свои настройки обратно.
  if (c.renter === wallet && c.owner !== wallet && !c.ownerConfig)
    c.ownerConfig = { targets: [...c.targets], frequencyMin: c.frequencyMin, spec: c.spec ? structuredClone(c.spec) : undefined };
  const tier = TIERS[c.tier];
  if (patch.targets) {
    const clean = normalizeTargets(c.source, patch.targets);
    if ((!clean.length && c.source !== "onchain") || clean.length > tier.maxTargets)
      throw new ApiError(`1-${tier.maxTargets} targets for ${tier.label}`);
    c.targets = clean;
  }
  if (patch.frequencyMin !== undefined) {
    const freq = Math.round(Number(patch.frequencyMin));
    if (!(freq >= tier.minFrequency && freq <= 1440)) throw new ApiError(`Frequency must be ${tier.minFrequency}-1440 min`);
    c.frequencyMin = freq;
  }
  if (patch.spec) {
    try {
      c.spec = normalizeSpec({ ...c.spec, ...patch.spec }, c.source);
    } catch (e) {
      throw new ApiError((e as Error).message);
    }
  }
  if (c.run && c.live) c.run.nextRunAt = Math.min(c.run.nextRunAt, Date.now() + 5_000);
  markDirty(s);
  return toPublic(c, wallet);
}

export function listListings() {
  const s = state();
  return [...s.listings.values()]
    .map((l) => ({ ...l, crawler: s.crawlers.has(l.crawlerId) ? toPublic(s.crawlers.get(l.crawlerId)!) : null }))
    .filter((l) => l.crawler)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function createListing(
  wallet: string,
  input: { crawlerId: string; type: "sale" | "rent"; price: number; rentDays?: number },
): Listing {
  const s = state();
  const c = s.crawlers.get(input.crawlerId);
  if (!c) throw new ApiError("Crawler not found", 404);
  if (c.owner !== wallet) throw new ApiError("Not your crawler", 403);
  if (c.status === "rented") throw new ApiError("Crawler is currently rented");
  if ([...s.listings.values()].some((l) => l.crawlerId === c.id)) throw new ApiError("Already listed");
  const price = Math.round(Number(input.price));
  if (!(price > 0 && price < 1e9)) throw new ApiError("Bad price");
  if (input.type !== "sale" && input.type !== "rent") throw new ApiError("Bad listing type");
  const days = input.type === "rent" ? Math.round(Number(input.rentDays)) : undefined;
  if (input.type === "rent" && !(days && days >= 1 && days <= 30)) throw new ApiError("Rent 1-30 days");
  const l: Listing = {
    id: `L-${c.id.slice(5)}-${Date.now().toString(36)}`,
    crawlerId: c.id,
    seller: wallet,
    type: input.type,
    price,
    rentDays: days,
    createdAt: Date.now(),
  };
  s.listings.set(l.id, l);
  return l;
}

export function cancelListing(wallet: string, listingId: string) {
  const s = state();
  const l = s.listings.get(listingId);
  if (!l) throw new ApiError("Listing not found", 404);
  if (l.seller !== wallet) throw new ApiError("Not your listing", 403);
  s.listings.delete(listingId);
}

export function buyListing(wallet: string, listingId: string) {
  const s = state();
  const l = s.listings.get(listingId);
  if (!l) throw new ApiError("Listing not found", 404);
  if (l.seller === wallet) throw new ApiError("You can't buy your own listing");
  const c = s.crawlers.get(l.crawlerId);
  if (!c) throw new ApiError("Crawler no longer exists", 410);

  const total = l.type === "rent" ? l.price * (l.rentDays ?? 1) : l.price;
  const fee = Math.round(total * MARKET_FEE_BURN);
  debit(s, wallet, total);
  s.balances.set(l.seller, (s.balances.get(l.seller) ?? 0) + total - fee);
  s.totalBurned += fee;

  if (l.type === "sale") {
    c.owner = wallet;
    c.renter = undefined;
    c.rentedUntil = undefined;
    restoreOwnerConfig(c);
    if (c.status === "rented") c.status = "active";
  } else {
    c.renter = wallet;
    c.rentedUntil = Date.now() + (l.rentDays ?? 1) * 86400_000;
    c.status = "rented";
  }
  s.listings.delete(listingId);
  markDirty(s);
  emit(s, { type: "trade", listing: l, buyer: wallet });
  return { crawler: toPublic(c), paid: total, burnedFee: fee };
}

export function listProposals(wallet?: string) {
  const s = state();
  return [...s.proposals.values()]
    .sort((a, b) => a.endsAt - b.endsAt)
    .map((p) => ({ ...p, myVote: wallet ? s.votes.get(p.id)?.get(wallet)?.option ?? null : null }));
}

export function vote(wallet: string, proposalId: string, optionId: string) {
  const s = state();
  const p = s.proposals.get(proposalId);
  if (!p) throw new ApiError("Proposal not found", 404);
  if (p.endsAt < Date.now()) throw new ApiError("Voting has ended");
  const opt = p.options.find((o) => o.id === optionId);
  if (!opt) throw new ApiError("Unknown option");
  ensureWallet(s, wallet);
  const weight = Math.floor(s.balances.get(wallet) ?? 0);
  if (weight <= 0) throw new ApiError("You need credits to vote");
  if (!s.votes.has(p.id)) s.votes.set(p.id, new Map());
  const byWallet = s.votes.get(p.id)!;
  // Переголосование: снимаем старый вес и ставим заново по текущему балансу.
  const prev = byWallet.get(wallet);
  if (prev) {
    const o = p.options.find((x) => x.id === prev.option);
    if (o) o.votes -= prev.weight;
  }
  opt.votes += weight;
  byWallet.set(wallet, { option: optionId, weight });
  return { ...p, myVote: optionId };
}

export function createProposal(
  wallet: string,
  input: { title: string; description: string; kind: Proposal["kind"]; options: string[]; days: number },
) {
  const s = state();
  ensureWallet(s, wallet);
  if ((s.balances.get(wallet) ?? 0) < PROPOSAL_MIN_BALANCE)
    throw new ApiError(`Need ${PROPOSAL_MIN_BALANCE.toLocaleString()} credits to create a proposal`);
  const title = String(input.title ?? "").trim();
  if (title.length < 6 || title.length > 90) throw new ApiError("Title must be 6-90 characters");
  const options = (input.options ?? []).map((o) => String(o).trim()).filter(Boolean);
  if (options.length < 2 || options.length > 6) throw new ApiError("2-6 options");
  if (!["priority", "rewards", "params"].includes(input.kind)) throw new ApiError("Bad kind");
  const days = Math.min(14, Math.max(1, Math.round(Number(input.days) || 3)));
  const id = `HIP-${s.proposals.size + 7}`;
  const p: Proposal = {
    id,
    title,
    description: String(input.description ?? "").slice(0, 600),
    kind: input.kind,
    options: options.map((label, i) => ({ id: `o${i}`, label, votes: 0 })),
    createdAt: Date.now(),
    endsAt: Date.now() + days * 86400_000,
    author: wallet,
  };
  s.proposals.set(id, p);
  return { ...p, myVote: null };
}

// ---------- real-time ----------

export function subscribe(fn: (e: StreamEvent) => void): () => void {
  const s = state();
  s.listeners.add(fn);
  return () => s.listeners.delete(fn);
}

// Стрим вызывает это по таймеру, чтобы симуляция шла, даже когда никто не дёргает API.
export function pulse() {
  state();
}

function short(a: string) {
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

// ---------- живые краулеры: API для планировщика ----------

export interface LiveJob {
  id: string;
  name: string;
  owner: string;
  renter?: string;
  source: Source;
  chain: Chain;
  narratives: Narrative[];
  targets: string[];
  frequencyMin: number;
  tier: Tier;
  spec: CrawlerSpec;
  cursor: Record<string, string>;
}

// Wallet tracker: все кошельки, за которыми следят живые on-chain краулеры с лентой «wallets» (цели = кошельки).
const isWalletWatcher = (c: { live?: boolean; status?: string; source: string; spec?: CrawlerSpec }) => !!c.live && c.status !== "paused" && c.source === "onchain" && !!c.spec?.onchain.feeds.includes("wallets");
export function watchedWallets(): Set<string> {
  const out = new Set<string>();
  const now = Date.now();
  for (const c of state().crawlers.values()) if (isWalletWatcher(c) && !isExpired(c, now) && c.chain === "solana") for (const t of c.targets) if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t.trim())) out.add(t.trim());
  return out;
}
// Пришла сделка кошелька: будим краулеры, которые за ним следят, — их обход начнётся сразу, а не по расписанию.
export function wakeWalletWatchers(wallet: string) {
  const now = Date.now();
  let n = 0;
  for (const c of state().crawlers.values())
    if (isWalletWatcher(c) && c.run && c.targets.some((t) => t.trim() === wallet)) {
      c.run.nextRunAt = Math.min(c.run.nextRunAt, now);
      n++;
    }
  return n;
}

// Краулеры, которым пора на обход. Возвращаем копии: сборщик не должен трогать состояние напрямую.
export function dueCrawlers(now = Date.now()): LiveJob[] {
  const s = state();
  return [...s.crawlers.values()]
    .filter((c) => c.live && c.status !== "paused" && !isExpired(c, now) && c.run && c.run.nextRunAt <= now)
    .sort((a, b) => a.run!.nextRunAt - b.run!.nextRunAt)
    .map((c) => ({
      id: c.id,
      name: c.name,
      owner: c.owner,
      renter: c.renter,
      source: c.source,
      chain: c.chain,
      narratives: [...c.narratives],
      targets: [...c.targets],
      frequencyMin: c.frequencyMin,
      tier: c.tier,
      spec: structuredClone(c.spec ?? normalizeSpec(undefined, c.source)),
      cursor: { ...(c.run?.cursor ?? {}) },
    }));
}

// Помечаем краулер «в работе», чтобы следующий тик планировщика не запустил его повторно.
export function claimRun(id: string, minIntervalMin: number) {
  const s = state();
  const c = s.crawlers.get(id);
  if (!c?.run) return;
  c.run.nextRunAt = Date.now() + Math.max(c.frequencyMin, minIntervalMin) * 60_000;
}

export type LiveSignalInput = Pick<Signal, "kind" | "ticker" | "text" | "confidence"> &
  Partial<Pick<Signal, "urls" | "token" | "safety" | "jev">> & { priceAtSignal?: number };

export interface RunResult {
  ok: boolean;
  items: number;
  error?: string;
  cursor?: Record<string, string>;
  signals: LiveSignalInput[];
  filtered?: number; // токены, которые отсеяла проверка безопасности
  // Сколько секунд работы засчитать в аптайм (интервал с прошлого успешного прохода)
  creditSec: number;
}

export function recordRun(id: string, r: RunResult) {
  const s = state();
  const c = s.crawlers.get(id);
  if (!c?.run) return;
  const now = Date.now();
  c.run.lastRunAt = now;
  c.run.runs++;
  c.run.lastItems = r.items;
  c.run.lastSignals = r.signals.length;
  c.run.lastError = r.ok ? undefined : r.error;
  c.run.lastFiltered = r.filtered;
  if (!r.ok) {
    c.run.failedRuns++;
    // Источник сбоит — не долбим его: каждый следующий обход откладывается вдвое дольше, до часа.
    c.run.failStreak = (c.run.failStreak ?? 0) + 1;
    const pause = Math.min(60, 2 ** c.run.failStreak) * 60_000;
    c.run.nextRunAt = Math.max(c.run.nextRunAt, now + pause);
  } else c.run.failStreak = 0;
  if (r.cursor) c.run.cursor = { ...c.run.cursor, ...r.cursor };
  c.stats.items += r.items;
  if (r.ok) c.stats.uptimeSec = Math.min(c.stats.totalSec, c.stats.uptimeSec + r.creditSec);

  const owner = c.renter ?? c.owner;
  r.signals.forEach((x, i) => {
    const horizon = (c.spec?.outcome.horizonMin ?? 60) * 60_000;
    const outcome: SignalOutcome =
      x.token && x.priceAtSignal
        ? { status: "pending", priceAtSignal: x.priceAtSignal, checkAt: now + horizon }
        : { status: "unscored" };
    const sig: Signal = {
      id: `${now.toString(36)}-${c.id}-${i}`,
      crawlerId: c.id,
      crawlerName: c.name,
      source: c.source,
      kind: x.kind,
      ticker: x.ticker,
      text: x.text,
      ts: now,
      confidence: x.confidence,
      live: true,
      owner,
      urls: x.urls,
      token: x.token,
      safety: x.safety,
      jev: x.jev,
      outcome,
    };
    c.stats.signals++;
    s.liveSignals.unshift(sig);
    s.signalTimes.push(now);
    emit(s, { type: "signal", signal: redact(sig) });
    for (const fn of liveSignalHooks) {
      try {
        fn(sig);
      } catch (e) {
        console.error("signal hook", e);
      }
    }
  });
  if (s.liveSignals.length > 20000) s.liveSignals.length = 20000;
  c.reputation = computeReputation(c);
  markDirty(s);
}

// Сколько собрано за спавны и продления (только проверенные on-chain платежи) — для счётчика казны.
export function paymentTotals() {
  let sol = 0;
  let eth = 0;
  let payments = 0;
  let tokens = 0;
  for (const c of state().crawlers.values()) {
    for (const p of [c.payment, ...(c.renewals ?? [])]) {
      if (!p || !p.tx) continue;
      payments++;
      if (p.unit === "SOL") sol += p.amount;
      else if (p.unit === "ETH") eth += p.amount;
      else tokens += p.amount;
    }
  }
  return { sol: Math.round(sol * 1e6) / 1e6, eth: Math.round(eth * 1e9) / 1e9, tokens, payments };
}

// Сколько живых краулеров запущено из каждого готового шаблона.
export function templateCounts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of state().crawlers.values()) if (c.live && c.template && !isExpired(c)) out[c.template] = (out[c.template] ?? 0) + 1;
  return out;
}

// Разбор встроенного Grok Bot дописывается в сигнал позже, когда бот его прочитал.
export function annotateSignal(id: string, bot: BotTake) {
  const s = state();
  const sig = s.liveSignals.find((x) => x.id === id);
  if (!sig) return null;
  sig.bot = bot;
  markDirty(s);
  return sig;
}

// Подписка на полные (не обрезанные) сигналы живых краулеров: доставка владельцу в Telegram.
// На globalThis, как и само состояние: разные маршруты могут получить свою копию модуля, а подписчики общие.
const hookHost = globalThis as unknown as { __crawlhiveSignalHooks?: Set<(sig: Signal) => void> };
const liveSignalHooks = (hookHost.__crawlhiveSignalHooks ??= new Set<(sig: Signal) => void>());
export function onLiveSignal(fn: (sig: Signal) => void) {
  liveSignalHooks.add(fn);
  return () => liveSignalHooks.delete(fn);
}

export function setMeta(key: string, value: string | undefined) {
  const s = state();
  if (value === undefined) delete s.meta[key];
  else s.meta[key] = value;
  markDirty(s);
}

export function getMeta(key: string): string | undefined {
  return state().meta[key];
}

// Проверенные исходы сигналов живых краулеров за окно [from, to) по времени проверки — для «Crawler of the day»
// (rewards.ts). Владелец — тот, кому принадлежал сигнал, иначе текущий хозяин краулера.
export function settledSignals(from: number, to: number) {
  const s = state();
  return s.liveSignals
    .filter((x) => x.outcome && (x.outcome.status === "hit" || x.outcome.status === "miss") && x.token)
    .map((x) => ({ x, at: x.outcome!.checkAt ?? x.ts }))
    .filter(({ at }) => at >= from && at < to)
    .map(({ x, at }) => {
      const c = s.crawlers.get(x.crawlerId);
      return {
        crawlerId: x.crawlerId,
        crawlerName: c?.name ?? x.crawlerName,
        owner: x.owner ?? c?.renter ?? c?.owner ?? "",
        status: x.outcome!.status as "hit" | "miss",
        peakPct: x.outcome!.peakPct ?? x.outcome!.changePct ?? 0,
        changePct: x.outcome!.changePct ?? 0,
        lowPct: x.outcome!.lowPct ?? x.outcome!.changePct ?? 0,
        at,
      };
    });
}

// Живые краулеры, у которых оплаченный срок кончается в ближайшие withinMs (и ещё не кончился).
export function expiringCrawlers(withinMs: number) {
  const now = Date.now();
  return [...state().crawlers.values()]
    .filter((c) => c.live && c.expiresAt && c.expiresAt > now && c.expiresAt - now <= withinMs)
    .map((c) => ({ id: c.id, name: c.name, owner: c.owner, expiresAt: c.expiresAt! }));
}

// Сигналы живых краулеров, созданные в окне [from, to): их отпечатки уходят в блокчейн (proof.ts).
export function liveSignalsBetween(from: number, to: number): Signal[] {
  return state().liveSignals.filter((x) => x.ts >= from && x.ts < to);
}

export function metaEntries(prefix: string): [string, string][] {
  return Object.entries(state().meta).filter(([k]) => k.startsWith(prefix));
}

// Сигналы, у которых наступило время проверить цену.
export function dueOutcomes(now = Date.now(), limit = 25) {
  return state()
    .liveSignals.filter((x) => x.outcome?.status === "pending" && (x.outcome.checkAt ?? 0) <= now && x.token)
    .slice(0, limit)
    .map((x) => ({ id: x.id, crawlerId: x.crawlerId, token: x.token!, priceAtSignal: x.outcome!.priceAtSignal! }));
}

// Сигналы, которые ещё в окне проверки: цену смотрим каждые 5 минут и запоминаем пик и просадку.
export function pendingOutcomes(limit = 300) {
  return state()
    .liveSignals.filter((x) => x.outcome?.status === "pending" && x.token && x.outcome.priceAtSignal)
    .slice(0, limit)
    .map((x) => ({ id: x.id, token: x.token! }));
}

export function sampleOutcome(signalId: string, price: number) {
  const s = state();
  const sig = s.liveSignals.find((x) => x.id === signalId);
  const o = sig?.outcome;
  if (!o || o.status !== "pending" || !o.priceAtSignal || !(price > 0)) return;
  const pct = Math.round(((price - o.priceAtSignal) / o.priceAtSignal) * 1000) / 10;
  o.peakPct = Math.max(o.peakPct ?? pct, pct);
  o.lowPct = Math.min(o.lowPct ?? pct, pct);
  markDirty(s);
}

export function resolveOutcome(signalId: string, priceAtCheck: number | null) {
  const s = state();
  const sig = s.liveSignals.find((x) => x.id === signalId);
  if (!sig?.outcome || sig.outcome.status !== "pending") return;
  const c = s.crawlers.get(sig.crawlerId);
  if (priceAtCheck === null) {
    // Пара исчезла или цену не получить — сигнал не засчитываем ни в плюс, ни в минус.
    sig.outcome = { ...sig.outcome, status: "unscored" };
  } else {
    const change = ((priceAtCheck - sig.outcome.priceAtSignal!) / sig.outcome.priceAtSignal!) * 100;
    const threshold = c?.spec?.outcome.hitThresholdPct ?? 20;
    // Мемкоин может дать цель за 20 минут и откатиться к концу окна: засчитываем лучший результат за окно.
    const peak = Math.max(change, sig.outcome.peakPct ?? -Infinity);
    const hit = peak >= threshold;
    const r1 = (n: number) => Math.round(n * 10) / 10;
    sig.outcome = {
      ...sig.outcome,
      status: hit ? "hit" : "miss",
      priceAtCheck,
      changePct: r1(change),
      peakPct: r1(peak),
      lowPct: r1(Math.min(change, sig.outcome.lowPct ?? Infinity)),
    };
    if (c) {
      c.stats.scored = (c.stats.scored ?? 0) + 1;
      if (hit) c.stats.hits++;
      c.reputation = computeReputation(c);
    }
  }
  markDirty(s);
}
