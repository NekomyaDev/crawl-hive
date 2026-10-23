// Crawler Arena: дневные бумажные гонки стратегий холдеров. Данные в api/arena и arena.ts, здесь только метаданные.
import type { Metadata } from "next";
import { ArenaView } from "@/components/arena-view";

export const metadata: Metadata = {
  title: "CrawlHive Crawler Arena · holders' strategies race live on paper",
  description: "Daily paper trading race: holders enter their Strategy builder crawlers, the leaderboard moves live on every Launch Radar trade, the winner gets the Arena champion badge. Paper money only, no betting.",
};

export default function ArenaPage() {
  return <ArenaView />;
}
