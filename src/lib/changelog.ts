// Короткий журнал выкаток для ленты «Shipped» на главной: дата и заголовок, новые сверху.
// Источник: строки «| Oct NN |» в README.md (заголовок = жирная часть). «0.2 SOL burn every 12 hours» не берём:
// плановых сжиганий больше нет, сжигания ручные.
export interface ChangelogItem {
  date: string;
  title: string;
  href?: string;
}

export const CHANGELOG: ChangelogItem[] = [
  { date: "Oct 22", title: "Auto Trading (paper) is public", href: "/paper" },
  { date: "Oct 22", title: "Risk score v2 is the public verdict, old score kept, v3 in testing", href: "/track" },
  { date: "Oct 22", title: "Operator watch for Whale, Robinhood snipers fixed", href: "/watchlist" },
  { date: "Oct 22", title: "Deployer, launchpad and pool creator separated, with evidence" },
  { date: "Oct 21", title: "Brain: unbounded memory, operators, risk", href: "/brain" },
  { date: "Oct 21", title: "CrawlHive Brain API", href: "/brain" },
  { date: "Oct 20", title: "Bot daily digest, honest LP on DLMM pools, Trust score (off until agreed)" },
  { date: "Oct 20", title: "Memory: token snapshots, cross-token wallets, Robinhood snipers fixed" },
  { date: "Oct 20", title: "X mentions bot, live as @crawlhivebot", href: "https://x.com/crawlhivebot" },
  { date: "Oct 20", title: "Holder perks", href: "/pricing" },
  { date: "Oct 20", title: "Share cards v2" },
  { date: "Oct 19", title: "Larpcheck second opinion and \"Why they disagree\"" },
  { date: "Oct 19", title: "Telegram alerts by topic and burn posts" },
  { date: "Oct 19", title: "Bubble map on every chain" },
  { date: "Oct 19", title: "Bubble map" },
  { date: "Oct 19", title: "Base, plus snipers on BNB and Base" },
  { date: "Oct 19", title: "Browser extension", href: "/extension" },
  { date: "Oct 19", title: "LP lock and unlock dates" },
  { date: "Oct 19", title: "Narrative Snipe Alerts", href: "/narratives" },
  { date: "Oct 19", title: "Operators, wallet memory, dev pages, Robinhood snipers" },
  { date: "Oct 18", title: "DEX fund closed" },
  { date: "Oct 18", title: "Wallet tracker", href: "/spawn" },
  { date: "Oct 18", title: "Clean Launch on BNB Chain", href: "/launch" },
  { date: "Oct 18", title: "Clean Launch on Robinhood Chain", href: "/launch" },
  { date: "Oct 17", title: "Gem & Rug Replay", href: "/replay" },
];
