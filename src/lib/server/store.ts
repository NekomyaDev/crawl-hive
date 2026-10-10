// In-memory хранилище и симуляция сети. В проде это заменяется на Postgres
// (схема в db/schema.sql) и реальных воркеров, а интерфейс функций остаётся тем же.
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
import { TIERS, DEMO_AIRDROP, EPOCH_REWARD, EPOCH_SEC, MARKET_FEE_BURN, PROPOSAL_MIN_BALANCE } from "../economy";
import { computeReputation } from "../reputation";
import { seedNetwork, mulberry32, crawlerId, pick, TICKERS, type Rng } from "./seed";

interface State {
  crawlers: Map<string, Crawler>;
  balances: Map<string, number>;
  burnedBy: Map<string, number>;
  listings: Map<string, Listing>;
  proposals: Map<string, Proposal>;
  votes: Map<string, Map<string, { option: string; weight: number }>>; // proposal -> wallet -> голос
  narrativeLinks: [string, string][];
  signals: Signal[]; // последние сигналы, новые в начале
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

// Храним состояние на globalThis, чтобы горячая перезагрузка в dev его не сбрасывала.
const g = globalThis as unknown as { __crawlhive?: State };

function init(): State {
  const now = Date.now();
  const seed = seedNetwork(now);
  const totalBurned = seed.crawlers.reduce((s, c) => s + c.burned, 0);
  return {
    crawlers: new Map(seed.crawlers.map((c) => [c.id, c])),
    balances: seed.balances,
    burnedBy: seed.burnedBy,
    listings: new Map(seed.listings.map((l) => [l.id, l])),
    proposals: new Map(seed.proposals.map((p) => [p.id, p])),
    votes: new Map(),
    narrativeLinks: seed.narrativeLinks,
    signals: [],
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
}

// ---------- чтение ----------

export function toPublic(c: Crawler): PublicCrawler {
  const { skill: _skill, ...rest } = c;
  return { ...rest, stats: { ...c.stats, items: Math.floor(c.stats.items), rewards: Math.round(c.stats.rewards) } };
}

export interface CrawlerFilter {
  owner?: string;
  narrative?: string;
  source?: string;
  chain?: string;
}

export function listCrawlers(f: CrawlerFilter = {}): PublicCrawler[] {
  const s = state();
  return [...s.crawlers.values()]
    .filter((c) => !f.owner || c.owner === f.owner || c.renter === f.owner)
    .filter((c) => !f.narrative || c.narratives.includes(f.narrative as Narrative))
    .filter((c) => !f.source || c.source === f.source)
    .filter((c) => !f.chain || c.chain === f.chain)
    .map(toPublic);
}

export function getCrawler(id: string): PublicCrawler & { recentSignals: Signal[] } {
  const s = state();
  const c = s.crawlers.get(id);
  if (!c) throw new ApiError("Crawler not found", 404);
  return { ...toPublic(c), recentSignals: s.signals.filter((x) => x.crawlerId === id).slice(0, 20) };
}

export function recentSignals(limit = 40): Signal[] {
  return state().signals.slice(0, limit);
}

export function networkStats(): NetworkStats {
  const s = state();
  const all = [...s.crawlers.values()];
  const active = all.filter((c) => c.status !== "paused");
  const itemsPerMin = active.reduce((sum, c) => sum + (c.targets.length * 40) / c.frequencyMin, 0);
  const owners = new Set(all.map((c) => c.owner));
  return {
    activeCrawlers: active.length,
    totalCrawlers: all.length,
    wallets: owners.size,
    itemsPerMin: Math.round(itemsPerMin),
    // Сеть живёт в демо минуты, поэтому к реальному счётчику добавляем базу из истории краулеров.
    signals24h: s.signalTimes.length + Math.round(active.length * 0.0035 * 86400 * 0.15),
    totalBurned: s.totalBurned,
    epochReward: EPOCH_REWARD,
    epochEndsAt: s.epochStart + EPOCH_SEC * 1000,
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
        return (c.stats.hits + 2.5) / (c.stats.signals + 5);
      default:
        return c.reputation;
    }
  };
  return [...s.crawlers.values()]
    .sort((a, b) => key(b) - key(a))
    .slice(0, limit)
    .map(toPublic);
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
  if (!s.balances.has(address)) s.balances.set(address, DEMO_AIRDROP);
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
}

// Проверка параметров спавна. Возвращает нормализованный ввод; ничего не меняет в состоянии.
export function validateSpawn(input: SpawnInput): SpawnInput {
  const tier = TIERS[input?.tier];
  if (!tier) throw new ApiError("Unknown tier");
  if (!SOURCES.includes(input.source)) throw new ApiError("Unknown source");
  if (!CHAINS.includes(input.chain)) throw new ApiError("Unknown chain");
  const name = String(input.name ?? "").trim();
  if (name.length < 2 || name.length > 24) throw new ApiError("Name must be 2–24 characters");
  const narratives = (input.narratives ?? []).filter((n) => NARRATIVES.includes(n));
  if (!narratives.length || narratives.length > 3) throw new ApiError("Pick 1–3 narratives");
  const targets = (input.targets ?? []).map((t) => String(t).trim()).filter(Boolean);
  if (!targets.length) throw new ApiError("Add at least one target");
  if (targets.length > tier.maxTargets) throw new ApiError(`${tier.label} tier allows up to ${tier.maxTargets} targets`);
  const freq = Math.round(Number(input.frequencyMin));
  if (!(freq >= tier.minFrequency && freq <= 1440))
    throw new ApiError(`${tier.label} tier crawls at most every ${tier.minFrequency} min`);
  return { name, source: input.source, chain: input.chain, narratives, targets, frequencyMin: freq, tier: input.tier };
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
    status: "active",
    createdAt: Date.now(),
    stats: { items: 0, signals: 0, hits: 0, uptimeSec: 0, totalSec: 0, rewards: 0 },
    reputation: 0,
    // В симуляции качество зависит от тира и того, насколько узко нацелен краулер.
    skill: Math.min(0.92, 0.35 + Object.keys(TIERS).indexOf(v.tier) * 0.08 + s.rng() * 0.25),
  };
  c.reputation = computeReputation(c);
  s.crawlers.set(id, c);
  const peers = [...s.crawlers.values()].filter((p) => p.id !== id && p.narratives[0] === v.narratives[0]);
  if (peers.length) s.narrativeLinks.push([id, pick(s.rng, peers).id]);
  const pub = toPublic(c);
  emit(s, { type: "spawn", crawler: pub });
  return pub;
}

export function setCrawlerStatus(wallet: string, id: string, status: "active" | "paused"): PublicCrawler {
  const s = state();
  const c = s.crawlers.get(id);
  if (!c) throw new ApiError("Crawler not found", 404);
  if (c.owner !== wallet) throw new ApiError("Not your crawler", 403);
  if (c.status === "rented") throw new ApiError("Crawler is rented out until the lease ends");
  c.status = status;
  emit(s, { type: "status", id, status });
  return toPublic(c);
}

export function updateCrawlerTargets(wallet: string, id: string, targets: string[], frequencyMin: number): PublicCrawler {
  const s = state();
  const c = s.crawlers.get(id);
  if (!c) throw new ApiError("Crawler not found", 404);
  if (c.owner !== wallet && c.renter !== wallet) throw new ApiError("Not your crawler", 403);
  const tier = TIERS[c.tier];
  const clean = targets.map((t) => String(t).trim()).filter(Boolean);
  if (!clean.length || clean.length > tier.maxTargets) throw new ApiError(`1–${tier.maxTargets} targets for ${tier.label}`);
  const freq = Math.round(Number(frequencyMin));
  if (!(freq >= tier.minFrequency && freq <= 1440)) throw new ApiError(`Frequency must be ${tier.minFrequency}–1440 min`);
  c.targets = clean;
  c.frequencyMin = freq;
  return toPublic(c);
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
  if (input.type === "rent" && !(days && days >= 1 && days <= 30)) throw new ApiError("Rent 1–30 days");
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
    if (c.status === "rented") c.status = "active";
  } else {
    c.renter = wallet;
    c.rentedUntil = Date.now() + (l.rentDays ?? 1) * 86400_000;
    c.status = "rented";
  }
  s.listings.delete(listingId);
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
  if (title.length < 6 || title.length > 90) throw new ApiError("Title must be 6–90 characters");
  const options = (input.options ?? []).map((o) => String(o).trim()).filter(Boolean);
  if (options.length < 2 || options.length > 6) throw new ApiError("2–6 options");
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
