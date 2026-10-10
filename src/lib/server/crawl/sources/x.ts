// X: поиск через Grok (инструмент x_search). Цели — @аккаунты (фильтр allowed_x_handles)
// и поисковые запросы. Без XAI_API_KEY источник не работает — честно сообщаем об этом в журнале запуска.
import "server-only";
import type { LiveJob } from "../../store";
import { grok, grokEnabled } from "../grok";
import { finalize, parseCandidates, specBrief, SIGNAL_JSON_RULES } from "../analyze";
import type { SourceResult } from "./types";

export async function crawlX(job: LiveJob): Promise<SourceResult> {
  if (!grokEnabled()) throw new Error("X crawling needs XAI_API_KEY on the server");
  const handles = job.targets.filter((t) => t.startsWith("@")).map((t) => t.slice(1));
  const queries = job.targets.filter((t) => !t.startsWith("@"));
  const since = Number(job.cursor.lastSeenAt ?? Date.now() - 6 * 3600_000);
  const sinceIso = new Date(since).toISOString();

  const { text, citations } = await grok({
    system: `You are a crawler that searches X for memecoin trading signals.\n${SIGNAL_JSON_RULES}`,
    user: [
      specBrief(job),
      handles.length ? `Search only posts from these accounts: ${handles.map((h) => "@" + h).join(", ")}.` : "",
      queries.length || job.spec.keywords.length
        ? `Search for: ${[...queries, ...job.spec.keywords].join(" | ")}.`
        : "",
      `Only consider posts published after ${sinceIso}. Include the post URLs you used.`,
    ]
      .filter(Boolean)
      .join("\n"),
    xSearch: {
      allowedHandles: handles,
      fromDate: sinceIso.slice(0, 10),
      imageUnderstanding: job.spec.x.imageUnderstanding,
    },
  });
  const candidates = parseCandidates(text, citations);
  const { signals, cursor } = await finalize(job, candidates);
  return { items: citations.length, signals, cursor: { ...cursor, lastSeenAt: String(Date.now()) } };
}
