// Ask CrawlHive: чат с ИИ по данным CrawlHive. Логика в ask-view.tsx, api/ask и ask.ts, здесь только метаданные.
import type { Metadata } from "next";
import { AskView } from "@/components/ask-view";

export const metadata: Metadata = {
  title: "Ask CrawlHive · AI answers from the swarm's data",
  description: "Ask about any memecoin, wallet or dev in plain words. Answers come only from CrawlHive scans, Brain memory, Track Record, Narrative Radar and Launch Radar. Not financial advice.",
};

export default function AskPage() {
  return <AskView />;
}
