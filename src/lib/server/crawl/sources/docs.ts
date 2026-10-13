// Docs: следим за изменениями страниц (документация, блоги, репозитории).
// Первый проход только запоминает страницу. Дальше — сигнал, если появились новые строки,
// подходящие под ключевые слова. С Grok изменения пересказываются по инструкциям владельца.
import "server-only";
import { createHash } from "node:crypto";
import type { LiveJob } from "../../store";
import { contractsIn, finalize, matchesKeywords, specBrief, tickersIn, type Candidate } from "../analyze";
import { grok, grokEnabled } from "../grok";
import type { SourceResult } from "./types";
import { fetchPublicText } from "../../safe-fetch";

const MAX_KEEP = 12_000; // столько текста страницы храним для сравнения

// Вырезаем <script> и <style> линейным проходом: ленивая регулярка на странице из тысяч
// незакрытых <script> работает квадратично и вешает сервер.
function stripBlocks(html: string, tag: string) {
  const lower = html.toLowerCase();
  let out = "";
  let i = 0;
  for (;;) {
    const open = lower.indexOf(`<${tag}`, i);
    if (open < 0) return out + html.slice(i);
    out += html.slice(i, open) + " ";
    const close = lower.indexOf(`</${tag}>`, open);
    if (close < 0) return out;
    i = close + tag.length + 3;
  }
}

function pageText(html: string) {
  return stripBlocks(stripBlocks(html, "script"), "style")
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
      // Только публичные адреса, проверка в самом соединении, тело не больше 1.5 МБ (safe-fetch.ts).
      const text = pageText(await fetchPublicText(url).catch((e) => Promise.reject(new Error(`${new URL(url).hostname}: ${(e as Error).message}`)))).slice(0, MAX_KEEP);
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
  return { items: job.targets.length - errors.length, signals: fin.signals, cursor: { ...cursor, ...fin.cursor }, filtered: fin.filtered };
}
