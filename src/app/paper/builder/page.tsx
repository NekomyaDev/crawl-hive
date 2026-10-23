// Strategy builder: личные бумажные стратегии холдеров. Данные в api/paper/mine и user-strategies.ts, здесь только метаданные.
import type { Metadata } from "next";
import { PaperBuilder } from "@/components/paper-builder";

export const metadata: Metadata = {
  title: "CrawlHive Strategy builder · your own paper strategy",
  description: "Build your own auto trading strategy on Launch Radar verdicts and watch it trade live with paper money. Paper money only, not financial advice.",
};

export default function PaperBuilderPage() {
  return <PaperBuilder />;
}
