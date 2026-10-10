// Общие типы домена CrawlHive. Используются и сервером (API), и клиентом.

export type Source = "x" | "telegram" | "onchain" | "docs";
export type Chain = "solana" | "base" | "ethereum";
export type Tier = "larva" | "worker" | "soldier" | "queen";
export type CrawlerStatus = "active" | "paused" | "rented";

export const NARRATIVES = [
  "ai",
  "dogs",
  "cats",
  "politifi",
  "gaming",
  "rwa",
  "depin",
  "celeb",
] as const;
export type Narrative = (typeof NARRATIVES)[number];

export const SOURCES: Source[] = ["x", "telegram", "onchain", "docs"];
export const CHAINS: Chain[] = ["solana", "base", "ethereum"];

export interface CrawlerStats {
  items: number; // собрано единиц данных (посты, транзакции, страницы)
  signals: number; // отправлено сигналов в сеть
  hits: number; // сигналы, которые подтвердились (токен вырос / новость подтвердилась)
  uptimeSec: number; // сколько секунд краулер реально работал
  totalSec: number; // сколько секунд прошло с момента спавна
  rewards: number; // заработано $CRAWL
}

export interface Crawler {
  id: string;
  name: string;
  owner: string; // адрес кошелька владельца
  renter?: string; // адрес арендатора, если сдан в аренду
  rentedUntil?: number;
  source: Source;
  chain: Chain;
  narratives: Narrative[];
  targets: string[]; // аккаунты, каналы, контракты, домены
  frequencyMin: number; // как часто проходит по целям
  tier: Tier;
  burned: number; // сколько $CRAWL сожжено при спавне
  // On-chain оплата спавна: SOL (фаза 1) или сжигание $CRAWL (фаза 2). Нет поля — спавн симулирован.
  payment?: { unit: "SOL" | "$CRAWL"; amount: number; tx: string };
  status: CrawlerStatus;
  createdAt: number;
  stats: CrawlerStats;
  reputation: number; // 0..1000, считается в reputation.ts
  skill: number; // скрытое «качество» краулера в симуляции, наружу не отдаётся
}

export type PublicCrawler = Omit<Crawler, "skill">;

export type SignalKind = "mention_spike" | "new_pair" | "whale_buy" | "kol_call" | "doc_update";

export interface Signal {
  id: string;
  crawlerId: string;
  crawlerName: string;
  source: Source;
  kind: SignalKind;
  ticker: string;
  text: string;
  ts: number;
  confidence: number; // 0..1
}

export interface Listing {
  id: string;
  crawlerId: string;
  seller: string;
  type: "sale" | "rent";
  price: number; // $CRAWL; для аренды — за день
  rentDays?: number;
  createdAt: number;
}

export interface ProposalOption {
  id: string;
  label: string;
  votes: number; // вес голосов в $CRAWL
}

export interface Proposal {
  id: string;
  title: string;
  description: string;
  kind: "priority" | "rewards" | "params";
  options: ProposalOption[];
  createdAt: number;
  endsAt: number;
  author: string;
}

export interface NetworkStats {
  activeCrawlers: number;
  totalCrawlers: number;
  wallets: number;
  itemsPerMin: number;
  signals24h: number;
  totalBurned: number;
  epochReward: number;
  epochEndsAt: number;
}

export interface SwarmNode {
  id: string;
  kind: "crawler" | "wallet";
  label: string;
  source?: Source;
  chain?: Chain;
  narratives?: Narrative[];
  reputation: number;
  status?: CrawlerStatus;
  tier?: Tier;
}

export interface SwarmLink {
  source: string;
  target: string;
  kind: "owns" | "rents" | "narrative";
}

export interface WalletInfo {
  address: string;
  balance: number;
  burned: number;
  crawlers: number;
  reputation: number; // средняя репутация краулеров кошелька
  onchain?: { tokens: number; sol: number }; // реальный баланс кошелька, если включён on-chain режим
}

export type PaymentMode = "simulated" | "sol" | "crawl";

export interface PublicConfig {
  payment: PaymentMode; // simulated — без сети; sol — оплата в SOL; crawl — сжигание $CRAWL
  cluster: string; // devnet | mainnet-beta | ...
  mint: string | null; // минт $CRAWL (только в режиме crawl)
  decimals: number;
  solRecipient: string | null; // куда уходит SOL в режиме sol
  solBurned: boolean; // true, если получатель — incinerator
  buyback: boolean; // true, если получатель — казна проекта (будущий байбек токена)
  prices: Record<Tier, number>; // цена спавна по тирам в текущей единице (SOL или $CRAWL)
  faucet: boolean; // на devnet можно получить тестовые средства
}
