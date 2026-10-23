// Live Auto Trading: торговый кошелёк держателя торгует по сигналам лучших бумажных стратегий. Здесь только метаданные,
// всё остальное в components/live-view.tsx и /api/live.
import type { Metadata } from "next";
import { LiveView } from "@/components/live-view";

export const metadata: Metadata = {
  title: "Live Auto Trading · CrawlHive",
  description: "Beta for holders: a personal Solana trading wallet that follows the most consistent CrawlHive paper strategies with real Jupiter swaps. Fees are taken from profit only. Not financial advice.",
};

export default function LivePage() {
  return <LiveView />;
}
