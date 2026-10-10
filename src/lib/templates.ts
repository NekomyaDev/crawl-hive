// Готовые краулеры для маркетплейса: проверенные цели и спецификации, которые можно купить в один клик.
// Покупка — обычный спавн с этими настройками по цене тира; после покупки краулер целиком твой и
// настраивается как любой другой. Все цели проверены на доступность (Telegram-каналы с веб-превью).
import type { Chain, CrawlerSpec, Narrative, Source, Tier } from "./types";

export interface CrawlerTemplate {
  id: string;
  name: string;
  tagline: string;
  description: string;
  perks: string[];
  source: Source;
  tier: Tier;
  chain: Chain;
  narratives: Narrative[];
  targets: string[];
  frequencyMin: number;
  spec: Partial<CrawlerSpec>;
  gradient: string; // фон шапки карточки, CSS
  emoji: string;
}

export const TEMPLATES: CrawlerTemplate[] = [
  {
    id: "fresh-pairs",
    name: "Fresh Pair Hunter",
    tagline: "New Solana tokens with real liquidity, minutes after they list",
    description:
      "Scans every new token profile on DexScreener and keeps only the ones that already have liquidity and trading. Each pick is scored against its price an hour later.",
    perks: ["Liquidity ≥ $10k, 1h volume ≥ $5k", "Pairs younger than 6 hours", "Flags copycat tickers"],
    source: "onchain",
    tier: "worker",
    chain: "solana",
    narratives: ["ai", "dogs", "cats"],
    targets: [],
    frequencyMin: 10,
    spec: {
      instructions: "",
      signalKinds: ["new_pair", "mention_spike"],
      minConfidence: 0.5,
      onchain: { feeds: ["profiles"], minLiquidityUsd: 10_000, minVolume1hUsd: 5_000, maxFdvUsd: 5_000_000, maxAgeHours: 6 },
      outcome: { horizonMin: 60, hitThresholdPct: 20 },
    },
    gradient: "linear-gradient(135deg,#ffb020 0%,#ff6a3d 100%)",
    emoji: "🥚",
  },
  {
    id: "boost-radar",
    name: "Boost Radar",
    tagline: "Tokens whose teams just paid for a DexScreener boost",
    description:
      "Someone paying to boost a token is a signal on its own. This crawler watches the boost feed and reports boosted tokens that pass a liquidity floor.",
    perks: ["Boosted tokens only", "Liquidity ≥ $20k", "Cheap: runs every 30 min"],
    source: "onchain",
    tier: "larva",
    chain: "solana",
    narratives: ["dogs", "celeb"],
    targets: [],
    frequencyMin: 30,
    spec: {
      signalKinds: ["new_pair", "mention_spike"],
      minConfidence: 0.5,
      onchain: { feeds: ["boosts"], minLiquidityUsd: 20_000, minVolume1hUsd: 2_000, maxFdvUsd: 0, maxAgeHours: 72 },
      outcome: { horizonMin: 120, hitThresholdPct: 25 },
    },
    gradient: "linear-gradient(135deg,#f472b6 0%,#c084fc 100%)",
    emoji: "🚀",
  },
  {
    id: "ai-agents",
    name: "AI Agent Scout",
    tagline: "AI-agent tokens on Solana before the timeline notices",
    description:
      "Searches DexScreener for AI and agent tokens, adds new profiles, and asks the AI to keep only projects that look like real agents rather than a ticker with 'AI' in it.",
    perks: ["Keyword search: ai, agent", "AI filter on project descriptions", "FDV under $10M"],
    source: "onchain",
    tier: "worker",
    chain: "solana",
    narratives: ["ai"],
    targets: [],
    frequencyMin: 15,
    spec: {
      instructions:
        "Only AI-agent projects: autonomous agents, agent frameworks, AI tooling with a product. Skip tokens that only use 'AI' in the name without any product, website or socials.",
      keywords: ["ai", "agent"],
      signalKinds: ["new_pair", "mention_spike"],
      minConfidence: 0.55,
      onchain: { feeds: ["search", "profiles"], minLiquidityUsd: 8_000, minVolume1hUsd: 2_000, maxFdvUsd: 10_000_000, maxAgeHours: 48 },
      outcome: { horizonMin: 120, hitThresholdPct: 20 },
    },
    gradient: "linear-gradient(135deg,#5eead4 0%,#60a5fa 100%)",
    emoji: "🤖",
  },
  {
    id: "pump-buzz",
    name: "Pump.fun Buzz",
    tagline: "What pump.fun and DexScreener Trending post on Telegram",
    description:
      "Reads the official pump.fun and DexScreener Trending channels and pulls out every token they push, with its contract address when it's there.",
    perks: ["t.me/pumpfun + t.me/DexScreenerTrending", "Contract addresses extracted", "Every 30 min"],
    source: "telegram",
    tier: "larva",
    chain: "solana",
    narratives: ["dogs", "cats", "celeb"],
    targets: ["t.me/pumpfun", "t.me/DexScreenerTrending"],
    frequencyMin: 30,
    spec: {
      instructions: "Report tokens these channels promote or list as trending. Skip general announcements, giveaways and app updates.",
      signalKinds: ["kol_call", "new_pair", "mention_spike"],
      minConfidence: 0.5,
      outcome: { horizonMin: 60, hitThresholdPct: 20 },
    },
    gradient: "linear-gradient(135deg,#b6f23a 0%,#22c55e 100%)",
    emoji: "💊",
  },
  {
    id: "whales-listings",
    name: "Whales & Listings",
    tagline: "Big transfers and exchange listings, filtered to what moves memecoins",
    description:
      "Watches Whale Alert, Binance announcements and Cointelegraph. The AI keeps only listings, delistings and large moves of tokens that trade on-chain.",
    perks: ["Whale Alert, Binance, Cointelegraph", "Listings and delistings first", "Every 10 min"],
    source: "telegram",
    tier: "worker",
    chain: "solana",
    narratives: ["rwa", "depin", "ai"],
    targets: ["t.me/whale_alert_io", "t.me/binance_announcements", "t.me/cointelegraph"],
    frequencyMin: 10,
    spec: {
      instructions:
        "Flag new exchange listings and delistings, and whale transfers of tokens other than BTC, ETH and stablecoins. Ignore market commentary, regulation news and opinion pieces.",
      excludeKeywords: ["USDT", "USDC"],
      signalKinds: ["kol_call", "mention_spike", "new_pair"],
      minConfidence: 0.55,
      outcome: { horizonMin: 240, hitThresholdPct: 10 },
    },
    gradient: "linear-gradient(135deg,#60a5fa 0%,#6366f1 100%)",
    emoji: "🐋",
  },
  {
    id: "kol-calls",
    name: "KOL Call Tracker",
    tagline: "Fresh contract-address calls on X, read by Grok",
    description:
      "Grok searches X for posts that drop a Solana contract address or a new pump.fun launch, and keeps the ones that read like a genuine first call rather than a paid shill.",
    perks: ["Grok x_search, last hours only", "Skips giveaways and paid promos", "Every 60 min (Worker)"],
    source: "x",
    tier: "worker",
    chain: "solana",
    narratives: ["ai", "dogs", "celeb"],
    targets: ["solana memecoin CA", "pump.fun new launch"],
    frequencyMin: 60,
    spec: {
      instructions:
        "Find posts that call a specific Solana token with its contract address. Prefer accounts with a history of early calls. Ignore giveaways, airdrop farming, paid promotions and reposts of old calls.",
      excludeKeywords: ["giveaway", "airdrop"],
      signalKinds: ["kol_call", "mention_spike"],
      minConfidence: 0.6,
      outcome: { horizonMin: 120, hitThresholdPct: 25 },
    },
    gradient: "linear-gradient(135deg,#e2e8f0 0%,#5eead4 100%)",
    emoji: "📣",
  },
  {
    id: "ecosystem-watch",
    name: "Ecosystem Watch",
    tagline: "Solana news and GitHub Trending, diffed for what's new",
    description:
      "Tracks solana.com/news and GitHub Trending and tells you what changed: launches, partnerships and repos taking off that could turn into narratives.",
    perks: ["solana.com/news + GitHub Trending", "Only real changes, not typos", "Every 2 hours"],
    source: "docs",
    tier: "larva",
    chain: "solana",
    narratives: ["ai", "depin"],
    targets: ["https://solana.com/news", "https://github.com/trending"],
    frequencyMin: 120,
    spec: {
      instructions: "Tell me about new launches, partnerships, token or airdrop news, and AI or crypto repos that appear on the list. Ignore style and layout changes.",
      signalKinds: ["doc_update"],
      minConfidence: 0.5,
    },
    gradient: "linear-gradient(135deg,#c084fc 0%,#f472b6 100%)",
    emoji: "🛰",
  },
  {
    id: "new-coins",
    name: "New Coins Lister",
    tagline: "Tokens that just made it onto CoinGecko",
    description:
      "Watches CoinGecko's new-cryptocurrencies page. Getting listed there is a milestone that often brings a wave of new buyers.",
    perks: ["coingecko.com/new-cryptocurrencies", "Solana and memecoins first", "Every 60 min"],
    source: "docs",
    tier: "larva",
    chain: "solana",
    narratives: ["dogs", "cats", "gaming"],
    targets: ["https://www.coingecko.com/en/new-cryptocurrencies"],
    frequencyMin: 60,
    spec: {
      instructions: "List newly added tokens, Solana and memecoins first. Mention the ticker and chain when visible.",
      signalKinds: ["doc_update"],
      minConfidence: 0.5,
    },
    gradient: "linear-gradient(135deg,#ffd27a 0%,#b6f23a 100%)",
    emoji: "🦎",
  },
];

export const TEMPLATE_IDS = new Set(TEMPLATES.map((t) => t.id));
