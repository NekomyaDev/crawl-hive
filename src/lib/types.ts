// Общие типы домена CrawlHive. Используются и сервером (API), и клиентом.

export type Source = "x" | "telegram" | "onchain" | "docs";
export type Chain = "solana" | "robinhood" | "base" | "ethereum";
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
export const CHAINS: Chain[] = ["solana", "robinhood", "base", "ethereum"];

export interface CrawlerStats {
  items: number; // собрано единиц данных (посты, транзакции, страницы)
  signals: number; // отправлено сигналов в сеть
  scored?: number; // сигналов, у которых уже известен исход (для живых краулеров; у симуляции = signals)
  hits: number; // сигналы, которые подтвердились (цена выросла сверх порога)
  uptimeSec: number; // сколько секунд краулер реально работал
  totalSec: number; // сколько секунд прошло с момента спавна
  rewards: number; // заработано credits
}

export interface Crawler {
  id: string;
  name: string;
  owner: string; // адрес кошелька владельца
  renter?: string; // адрес арендатора, если сдан в аренду
  rentedUntil?: number;
  ownerConfig?: { targets: string[]; frequencyMin: number; spec?: CrawlerSpec }; // настройки владельца до правок арендатора
  source: Source;
  chain: Chain;
  narratives: Narrative[];
  targets: string[]; // аккаунты, каналы, контракты, домены
  frequencyMin: number; // как часто проходит по целям
  tier: Tier;
  burned: number; // эквивалент тира в credits: вес «ставки» в репутации
  // On-chain оплата спавна: SOL (фаза 1) или сжигание токена проекта (фаза 2). Нет поля — спавн симулирован.
  payment?: { unit: string; amount: number; tx: string };
  // Оплаченный срок работы. После него планировщик краулер не обходит, пока владелец не продлит.
  expiresAt?: number;
  renewals?: { unit: string; amount: number; tx: string; at: number }[];
  template?: string; // id готового краулера из маркетплейса (lib/templates.ts), если куплен оттуда
  status: CrawlerStatus;
  createdAt: number;
  stats: CrawlerStats;
  reputation: number; // 0..1000, считается в reputation.ts
  skill: number; // скрытое «качество» краулера в симуляции, наружу не отдаётся
  // Живой краулер реально собирает данные (созданные пользователями). Демо-сеть — симуляция.
  live?: boolean;
  spec?: CrawlerSpec;
  run?: CrawlerRunState;
}

export type PublicCrawler = Omit<Crawler, "skill">;

export type SignalKind = "mention_spike" | "new_pair" | "whale_buy" | "kol_call" | "doc_update";
export const SIGNAL_KINDS: SignalKind[] = ["mention_spike", "new_pair", "whale_buy", "kol_call", "doc_update"];

// Спецификация краулера: что именно и как собирать. Задаётся при спавне, правится владельцем.
export interface CrawlerSpec {
  instructions: string; // свободный текст для ИИ-разбора: «только AI-агенты на Solana с FDV < $2M…»
  keywords: string[]; // что искать / что обязано встречаться
  excludeKeywords: string[]; // что отбрасывать
  signalKinds: SignalKind[]; // какие типы сигналов присылать
  minConfidence: number; // 0..1, ниже — не присылать
  // On-chain (DexScreener)
  onchain: {
    feeds: ("profiles" | "boosts" | "search")[]; // новые профили токенов, бусты, поиск по ключевым словам
    minLiquidityUsd: number;
    minVolume1hUsd: number;
    maxFdvUsd: number; // 0 — без ограничения
    maxAgeHours: number; // 0 — без ограничения
  };
  // X (Grok x_search)
  x: { imageUnderstanding: boolean };
  // Как оценивать сигнал: через сколько минут смотреть цену и какой рост считать попаданием
  outcome: { horizonMin: number; hitThresholdPct: number };
}

// Состояние живого краулера: когда запускался, что собрал, чем закончился последний проход.
export interface CrawlerRunState {
  lastRunAt?: number;
  nextRunAt: number;
  lastItems?: number;
  lastSignals?: number;
  lastError?: string;
  runs: number;
  failedRuns: number;
  failStreak?: number; // ошибок подряд: после каждой следующий обход откладывается дольше
  lastFiltered?: number; // сколько найденных токенов отсеяла проверка безопасности в последнем обходе
  cursor: Record<string, string>; // последние увиденные id постов / хеши страниц по каждой цели
}

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
  live?: boolean; // сигнал от живого краулера (приватный: полный текст видит только владелец/арендатор)
  redacted?: boolean; // в публичной ленте текст скрыт
  owner?: string; // кому принадлежит сигнал (владелец или арендатор на момент сигнала)
  urls?: string[]; // источники: посты, сообщения, страница пары
  token?: { chain: string; address: string; symbol?: string };
  outcome?: SignalOutcome;
  safety?: SignalSafety; // проверка токена сканером Instant Crawl до отправки сигнала
  bot?: BotTake; // разбор встроенного Grok Bot: смотреть, следить или обходить стороной
  jev?: SignalJev; // решение Jev: насколько находка стоит внимания
}

export interface SignalJev {
  p: number; // вероятность, что сигнал стоит внимания, 0..1
  ms: number; // сколько Jev думал
}

export interface SignalSafety {
  verdict: string; // CLEAN | OK | RISKY | TOO_EARLY (DANGER до владельца не доходит)
  score: number | null;
  reason: string;
  flags: string[];
}

export interface BotTake {
  take: "look" | "watch" | "avoid";
  note: string;
  verdict?: string; // вердикт Instant Crawl по токену сигнала
  score?: number | null;
  by: "grok" | "jev" | "scan"; // grok — разобрал Grok; jev — уверенно решил Jev; scan — вывод прямо из скана
  conf?: number; // уверенность Jev в выводе, 0..1
  at: number;
}

export interface SignalOutcome {
  status: "pending" | "hit" | "miss" | "unscored"; // unscored — у сигнала нет токена, цену не проверить
  priceAtSignal?: number;
  priceAtCheck?: number;
  changePct?: number;
  checkAt?: number; // когда проверять
  peakPct?: number; // лучший результат за окно (цену смотрим каждые 5 минут)
  lowPct?: number; // худшая просадка за окно
}

export interface Listing {
  id: string;
  crawlerId: string;
  seller: string;
  type: "sale" | "rent";
  price: number; // credits; для аренды — за день
  rentDays?: number;
  createdAt: number;
}

export interface ProposalOption {
  id: string;
  label: string;
  votes: number; // вес голосов в credits
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
  scored: number; // сигналов живых краулеров, сверенных с ценой
  hits: number;
  demo: boolean;
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
  bots?: number; // сколько Grok Bots стоят над краулером
  botLive?: boolean; // хоть один из них обращался за последние 10 минут
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
  onchain?: { tokens: number; sol: number; eth?: number }; // реальный баланс кошелька (eth — у кошельков EVM на Robinhood Chain)
}

export type PaymentMode = "simulated" | "sol" | "token";

export interface PublicConfig {
  payment: PaymentMode; // simulated — без сети; sol — оплата в SOL; token — сжигание токена проекта
  cluster: string; // devnet | mainnet-beta | ...
  mint: string | null; // минт токена проекта (только в режиме token)
  symbol: string | null; // тикер токена проекта (только в режиме token)
  decimals: number;
  solRecipient: string | null; // куда уходит SOL в режиме sol
  solBurned: boolean; // true, если получатель — incinerator
  buyback: boolean; // true, если получатель — казна проекта (будущий байбек токена)
  prices: Record<Tier, number>; // цена спавна по тирам в текущей единице (SOL или токен проекта)
  faucet: boolean; // на devnet можно получить тестовые средства
  termDays: number; // сколько дней работы даёт спавн или продление
  demoNetwork: boolean; // показывается ли симулированная демо-сеть рядом с живыми краулерами
  telegramBot: string | null; // username бота для доставки сигналов, если настроен
  eth: EthConfig | null; // оплата в ETH на Robinhood Chain кошельком EVM, если включена
}

// Оплата в ETH на Robinhood Chain: куда и сколько, плюс параметры сети для wallet_addEthereumChain.
export interface EthConfig {
  chainId: number;
  chainName: string;
  rpc: string;
  explorer: string;
  recipient: string;
  prices: Record<Tier, number>;
}
