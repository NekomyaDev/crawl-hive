// Paper Trading: живой бумажный движок стратегий. Данные в api/paper и paper-engine.ts, здесь только метаданные.
import type { Metadata } from "next";
import { PaperView } from "@/components/paper-view";

export const metadata: Metadata = {
  title: "CrawlHive Paper Trading · the swarm trades its own signals",
  description: "Live paper trading on Launch Radar calls: several strategies with stops, take profits and trailing exits, fees and slippage included. Paper money only, not financial advice.",
};

export default function PaperPage() {
  return <PaperView />;
}
