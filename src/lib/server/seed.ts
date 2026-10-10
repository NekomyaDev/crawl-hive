// Генератор моковой сети. Детерминированный (seed), чтобы демо выглядело одинаково
// после каждого перезапуска сервера.
import { NARRATIVES, CHAINS, SOURCES } from "../types";
import type { Crawler, Listing, Narrative, Proposal, Source, Tier } from "../types";
import { TIERS, TIER_ORDER, DEMO_AIRDROP } from "../economy";
import { computeReputation } from "../reputation";

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;

export const pick = <T,>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function fakeAddress(rng: Rng): string {
  let s = "";
  for (let i = 0; i < 44; i++) s += B58[Math.floor(rng() * B58.length)];
  return s;
}

export function crawlerId(rng: Rng): string {
  const hex = "0123456789ABCDEF";
  let s = "";
  for (let i = 0; i < 4; i++) s += hex[Math.floor(rng() * 16)];
  return `CRWL-${s}`;
}

// Вымышленные тикеры: в демо не хотим «сигналов» по реальным монетам.
export const TICKERS = [
  "HIVE", "LARVA", "GIGABUG", "MOTH", "ANTZ", "WASP", "SKITTER", "NECTAR", "DRONE",
  "QUEENB", "CHITIN", "STINGR", "HUSKY", "PURRR", "BORKO", "MEOWTH", "CLAWD", "BOTFREN",
  "DEPINU", "VOTEDOG", "RWAGMI", "PIXL", "LOOTR", "SENTRY",
];

const NAME_A = ["Night", "Iron", "Ghost", "Neon", "Feral", "Silent", "Rapid", "Deep", "Hollow", "Acid", "Turbo", "Lunar"];
const NAME_B = ["Mantis", "Weevil", "Hornet", "Beetle", "Cicada", "Locust", "Spider", "Tick", "Wasp", "Moth", "Ant", "Scarab"];

export function crawlerName(rng: Rng): string {
  return `${pick(rng, NAME_A)} ${pick(rng, NAME_B)}`;
}

const TARGETS: Record<Source, string[]> = {
  x: ["@kolwhale", "@degenalpha", "@soltrends", "@memeradar", "@cryptobeetle", "@ansem_fan", "@onchainmoth", "@aiagents_daily"],
  telegram: ["t.me/solcalls", "t.me/memebrew", "t.me/alphahive", "t.me/pumpwatch", "t.me/degenlab"],
  onchain: ["pump.fun/new", "raydium:new_pools", "jupiter:volume", "base:aerodrome", "uniswap:v4_pools", "whale_wallets:top100"],
  docs: ["docs.solana.com", "github.com/trending", "medium:launches", "mirror.xyz", "gitbook:whitepapers"],
};

export function defaultTargets(rng: Rng, source: Source, n: number): string[] {
  const pool = [...TARGETS[source]];
  const out: string[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
}

export function suggestedTargets(source: Source): string[] {
  return TARGETS[source];
}

function weightedTier(rng: Rng): Tier {
  const r = rng();
  if (r < 0.45) return "larva";
  if (r < 0.78) return "worker";
  if (r < 0.95) return "soldier";
  return "queen";
}

export interface SeedState {
  crawlers: Crawler[];
  balances: Map<string, number>;
  burnedBy: Map<string, number>;
  listings: Listing[];
  proposals: Proposal[];
  narrativeLinks: [string, string][];
}

export function seedNetwork(now: number, seed = 1337): SeedState {
  const rng = mulberry32(seed);
  const wallets = Array.from({ length: 28 }, () => fakeAddress(rng));
  const balances = new Map<string, number>();
  const burnedBy = new Map<string, number>();
  wallets.forEach((w) => balances.set(w, Math.round(DEMO_AIRDROP * (0.2 + rng() * 3))));

  const crawlers: Crawler[] = [];
  const usedIds = new Set<string>();
  for (let i = 0; i < 130; i++) {
    let id = crawlerId(rng);
    while (usedIds.has(id)) id = crawlerId(rng);
    usedIds.add(id);

    // Несколько «китов» владеют большой долей краулеров, как в реальной сети.
    const owner = rng() < 0.35 ? wallets[Math.floor(rng() * 5)] : pick(rng, wallets);
    const tier = weightedTier(rng);
    const source = pick(rng, SOURCES);
    const primary = pick(rng, NARRATIVES);
    const narratives: Narrative[] = [primary];
    if (rng() < 0.4) {
      const second = pick(rng, NARRATIVES);
      if (second !== primary) narratives.push(second);
    }
    const ageSec = 3600 * (2 + rng() * 24 * 25);
    const uptimeRatio = 0.55 + rng() * 0.449;
    const skill = 0.2 + rng() * 0.6 + TIER_ORDER.indexOf(tier) * 0.04;
    const freq = Math.max(TIERS[tier].minFrequency, Math.round(TIERS[tier].minFrequency * (1 + rng() * 4)));
    const targets = defaultTargets(rng, source, Math.max(1, Math.ceil(TIERS[tier].maxTargets * (0.3 + rng() * 0.5))));
    const itemsPerSec = (targets.length * 40) / (freq * 60);
    const items = Math.round(itemsPerSec * ageSec * uptimeRatio);
    const signals = Math.round(items * (0.002 + rng() * 0.004));
    const hits = Math.round(signals * Math.min(0.95, skill));
    const burned = TIERS[tier].burn;
    burnedBy.set(owner, (burnedBy.get(owner) ?? 0) + burned);

    const c: Crawler = {
      id,
      name: crawlerName(rng),
      owner,
      source,
      chain: source === "onchain" ? pick(rng, CHAINS) : rng() < 0.75 ? "solana" : pick(rng, CHAINS),
      narratives,
      targets,
      frequencyMin: freq,
      tier,
      burned,
      status: rng() < 0.1 ? "paused" : "active",
      createdAt: now - ageSec * 1000,
      stats: {
        items,
        signals,
        hits,
        uptimeSec: ageSec * uptimeRatio,
        totalSec: ageSec,
        rewards: Math.round(signals * (8 + rng() * 30)),
      },
      reputation: 0,
      skill: Math.min(0.95, skill),
    };
    c.reputation = computeReputation(c);
    crawlers.push(c);
  }

  // Связи «общий нарратив»: краулеры, копающие одну тему, образуют кластеры на карте.
  const narrativeLinks: [string, string][] = [];
  for (const c of crawlers) {
    if (rng() < 0.6) {
      const peers = crawlers.filter((p) => p.id !== c.id && p.narratives[0] === c.narratives[0]);
      if (peers.length) narrativeLinks.push([c.id, pick(rng, peers).id]);
    }
  }

  // Часть краулеров уже выставлена на маркет.
  const listings: Listing[] = [];
  const forSale = crawlers.filter((c) => c.status === "active").filter(() => rng() < 0.16);
  for (const c of forSale) {
    const rent = rng() < 0.5;
    const base = TIERS[c.tier].burn * (0.6 + c.reputation / 600);
    listings.push({
      id: `L-${c.id.slice(5)}`,
      crawlerId: c.id,
      seller: c.owner,
      type: rent ? "rent" : "sale",
      price: Math.round(rent ? base / 40 : base * (1 + rng())),
      rentDays: rent ? pick(rng, [1, 3, 7, 14]) : undefined,
      createdAt: now - rng() * 3 * 86400_000,
    });
  }

  const day = 86400_000;
  const proposals: Proposal[] = [
    {
      id: "HIP-7",
      title: "Priority narrative for next epoch",
      description:
        "Crawlers working the winning narrative get a 1.3x reward boost for the next 7 days. Pick where the swarm should dig.",
      kind: "priority",
      options: [
        { id: "ai", label: "AI agents", votes: 1_840_000 },
        { id: "depin", label: "DePIN", votes: 620_000 },
        { id: "politifi", label: "PolitiFi", votes: 410_000 },
        { id: "gaming", label: "Gaming", votes: 280_000 },
      ],
      createdAt: now - 2 * day,
      endsAt: now + 2 * day + 3 * 3600_000,
      author: wallets[0],
    },
    {
      id: "HIP-8",
      title: "Add Farcaster as a crawl source",
      description:
        "Opens a fifth source type. Spawning a Farcaster crawler would cost the same as X. Requires new worker images.",
      kind: "priority",
      options: [
        { id: "yes", label: "Yes, add it", votes: 960_000 },
        { id: "no", label: "No, focus on current sources", votes: 1_120_000 },
      ],
      createdAt: now - day,
      endsAt: now + 4 * day,
      author: wallets[3],
    },
    {
      id: "HIP-9",
      title: "Raise quality weight in reputation to 50%",
      description:
        "Moves 10% of reputation weight from volume to signal quality. Spam crawlers lose rank, precise ones gain.",
      kind: "params",
      options: [
        { id: "yes", label: "Raise to 50%", votes: 2_310_000 },
        { id: "no", label: "Keep 40%", votes: 540_000 },
      ],
      createdAt: now - 3 * day,
      endsAt: now + 18 * 3600_000,
      author: wallets[1],
    },
    {
      id: "HIP-10",
      title: "Epoch reward split",
      description: "How the 50k-credit epoch emission is divided between crawler owners and the treasury.",
      kind: "rewards",
      options: [
        { id: "90-10", label: "90% crawlers / 10% treasury", votes: 1_450_000 },
        { id: "80-20", label: "80% / 20%", votes: 890_000 },
        { id: "100-0", label: "100% crawlers", votes: 1_020_000 },
      ],
      createdAt: now - 5 * day,
      endsAt: now + 6 * 3600_000,
      author: wallets[2],
    },
  ];

  return { crawlers, balances, burnedBy, listings, proposals, narrativeLinks };
}
