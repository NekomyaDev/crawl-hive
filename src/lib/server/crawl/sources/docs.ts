// Docs: следим за изменениями страниц (документация, блоги, репозитории).
// Первый проход только запоминает страницу. Дальше — сигнал, если появились новые строки,
// подходящие под ключевые слова. С Grok изменения пересказываются по инструкциям владельца.
import "server-only";
import { createHash } from "node:crypto";
import type { LiveJob } from "../../store";
import { contractsIn, finalize, matchesKeywords, specBrief, tickersIn, type Candidate } from "../analyze";
import { grok, grokEnabled } from "../grok";
import type { SourceResult } from "./types";

const MAX_KEEP = 12_000; // столько текста страницы храним для сравнения

function pageText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|li|h\d|tr|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 2)
    .join("\n");
}

export async function crawlDocs(job: LiveJob): Promise<SourceResult> {
  const cursor: Record<string, string> = {};
  const candidates: Candidate[] = [];
  const errors: string[] = [];
  for (const url of job.targets) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; CrawlHive/1.0)" }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      const text = pageText((await res.text()).slice(0, 2_000_000)).slice(0, MAX_KEEP);
      const hash = createHash("sha256").update(text).digest("hex").slice(0, 16);
      const prevHash = job.cursor[`doc:${url}`];
      cursor[`doc:${url}`] = hash;
      cursor[`doctext:${url}`] = text;
      if (!prevHash || prevHash === hash) continue;

      const before = new Set((job.cursor[`doctext:${url}`] ?? "").split("\n"));
      const added = text.split("\n").filter((l) => !before.has(l));
      const addedText = added.join("\n");
      if (!added.length || !matchesKeywords(addedText, job.spec.keywords, job.spec.excludeKeywords)) continue;

      let summary = `${new URL(url).hostname} changed: ${added.slice(0, 3).join(" · ").slice(0, 240)}`;
      let confidence = 0.55;
      if (grokEnabled()) {
        const r = await grok({
          system: "Summarize what changed on a web page in one sentence for a memecoin trader, and rate relevance 0-1. Reply as JSON: {\"summary\":\"...\",\"relevance\":0.0}",
          user: `${specBrief(job)}\n\nPage: ${url}\nNew lines:\n${addedText.slice(0, 4000)}`,
        });
        const m = r.text.match(/\{[\s\S]*\}/);
        if (m) {
          try {
            const j = JSON.parse(m[0]);
            if (j.summary) summary = String(j.summary).slice(0, 400);
            if (typeof j.relevance === "number") confidence = j.relevance;
          } catch {}
        }
      }
      candidates.push({
        kind: "doc_update",
        contract: contractsIn(addedText, job.chain)[0],
        ticker: tickersIn(addedText)[0],
        summary,
        confidence,
        urls: [url],
      });
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  if (errors.length === job.targets.length) throw new Error(errors.join("; "));
  const fin = await finalize(job, candidates);
  return { items: job.targets.length - errors.length, signals: fin.signals, cursor: { ...cursor, ...fin.cursor } };
}
