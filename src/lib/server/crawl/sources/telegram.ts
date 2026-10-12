// Telegram: публичные каналы читаются через веб-превью t.me/s/<канал> (без бота и ключей).
// Новые сообщения определяются по номеру поста; первый проход берёт только последние 5.
import "server-only";
import type { LiveJob } from "../../store";
import { extract, finalize, type RawItem } from "../analyze";
import type { SourceResult } from "./types";

const decode = (s: string) =>
  s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

export async function fetchChannel(name: string): Promise<RawItem[]> {
  const res = await fetch(`https://t.me/s/${name}`, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; CrawlHive/1.0)" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`t.me/${name}: HTTP ${res.status}`);
  const html = await res.text();
  // Каждое сообщение — блок с data-post="channel/123"; текст и время внутри него.
  const blocks = html.split(/(?=<div class="tgme_widget_message_wrap)/);
  const out: RawItem[] = [];
  for (const b of blocks) {
    const post = b.match(/data-post="([^"]+\/(\d+))"/);
    if (!post) continue;
    const text = b.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const time = b.match(/datetime="([^"]+)"/);
    out.push({
      id: post[2],
      text: text ? decode(text[1]).trim() : "",
      url: `https://t.me/${post[1]}`,
      author: `t.me/${name}`,
      ts: time ? Date.parse(time[1]) : undefined,
    });
  }
  if (!out.length && !/tgme_channel_info/.test(html)) throw new Error(`t.me/${name} has no public preview`);
  return out.filter((m) => m.text);
}

export async function crawlTelegram(job: LiveJob): Promise<SourceResult> {
  const fresh: RawItem[] = [];
  const cursor: Record<string, string> = {};
  const errors: string[] = [];
  for (const t of job.targets) {
    const name = t.replace(/^t\.me\//, "");
    try {
      const msgs = await fetchChannel(name);
      const last = Number(job.cursor[`tg:${name}`] ?? 0);
      const newer = last ? msgs.filter((m) => Number(m.id) > last) : msgs.slice(-5);
      fresh.push(...newer);
      const max = Math.max(last, ...msgs.map((m) => Number(m.id)));
      if (max) cursor[`tg:${name}`] = String(max);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  if (errors.length === job.targets.length) throw new Error(errors.join("; "));
  const candidates = await extract(job, fresh, "public Telegram channels", "kol_call");
  const fin = await finalize(job, candidates);
  return { items: fresh.length, signals: fin.signals, cursor: { ...cursor, ...fin.cursor }, filtered: fin.filtered };
}
