// Gem Hunter: ежедневная игра держателей. Данные в api/hunt и gem-hunter.ts, здесь только метаданные.
import type { Metadata } from "next";
import { HuntView } from "@/components/hunt-view";

export const metadata: Metadata = {
  title: "Gem Hunter · CrawlHive",
  description: "A daily game for $CRAWLHIVE holders: scan coins with CrawlHive, CLEAN or OK finds above $25k market cap are scored 24 hours later. Most points of the day wins. Not financial advice.",
};

export default function HuntPage() {
  return <HuntView />;
}
