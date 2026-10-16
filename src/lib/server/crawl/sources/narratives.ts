// Охота за нарративами (режим X-краулера с типом сигнала narrative): Grok ищет в X то, что начало расходиться
// в последние часы и вокруг чего может появиться мемкоин. Каждая ссылка на пост проверяется публичным oEmbed X:
// выдуманные (404) отбрасываются, у настоящих подставляется реальный автор. Нарратив без единого настоящего поста
// не попадает в сигналы. Плюс счётчик клонов: сколько монет с таким тикером уже появилось на DexScreener за сутки.
// Перенесено из Narrative Hunter лаунчпада Gem Search (narratives.mjs).
import "server-only";
import type { LiveJob, LiveSignalInput } from "../../store";
import { grok } from "../grok";
import { specBrief } from "../analyze";
import type { SourceResult } from "./types";

const DEDUP_MS = 12 * 3600_000;
const HEAT_CONF: Record<string, number> = { early: 0.55, rising: 0.7, hot: 0.85 };

const RULES = `Reply with JSON only, no prose:
{"narratives":[{"title":"max 6 words","why":"one sentence: what is happening and why people care","ticker":"2-10 letters A-Z/0-9, no $","heat":"early|rising|hot","kind":"meme|ai|animal|tech|culture|crypto|other","posts":["x.com/<user>/status/<id> links you actually found"]}]}
Up to 6 narratives. heat: early = a few posts, rising = spreading fast, hot = everywhere.
Skip tragedies, deaths, disasters, wars, politics, hate, sexual content, anything about minors.
Skip anything that is an existing coin, token, launchpad or project promoting itself (shills, launch announcements, airdrops, "CA:" posts): the narrative must be organic internet culture. No price predictions. Never invent links.`;

const POST_RE = /(?:x|twitter)\.com\/(?:([A-Za-z0-9_]{1,15})\/|i\/(?:web\/)?)status(?:es)?\/(\d{5,25})/;
const idOf = (u: string) => POST_RE.exec(u)?.[2] ?? null;
const tickerOf = (s: unknown) => String(s ?? "").toUpperCase().replace(/^\$/, "").replace(/[^A-Z0-9]/g, "").slice(0, 10);

// 200 — пост есть (возвращаем ссылку с настоящим автором), 404 — выдуман (null), иначе oEmbed недоступен (undefined).
export async function verifyPost(url: string): Promise<string | null | undefined> {
  const id = idOf(url);
  if (!id) return null;
  const user = POST_RE.exec(url)?.[1] ?? "i";
  const res = await fetch(`https://publish.twitter.com/oembed?omit_script=1&url=${encodeURIComponent(`https://twitter.com/${user}/status/${id}`)}`, {
    redirect: "follow",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res) return undefined;
  if (res.status === 404) return null;
  if (!res.ok) return undefined;
  const author = String(((await res.json().catch(() => ({}))) as { author_url?: string }).author_url ?? "").match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})/)?.[1];
  return author ? `https://x.com/${author}/status/${id}` : undefined;
}

// Сколько монет с этим тикером появилось за сутки на сети краулера: свежий нарратив и выжатый выглядят по-разному.
async function clones(chain: string, ticker: string): Promise<number | null> {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(ticker)}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const pairs = ((await r.json()) as { pairs?: { chainId?: string; pairCreatedAt?: number; baseToken?: { address?: string; symbol?: string } }[] }).pairs ?? [];
    const day = Date.now() - 86_400_000;
    const tokens = new Set(pairs.filter((p) => p.chainId === chain && (p.pairCreatedAt ?? 0) > day && p.baseToken?.symbol?.toUpperCase() === ticker).map((p) => p.baseToken!.address));
    return tokens.size;
  } catch {
    return null;
  }
}

export async function crawlNarratives(job: LiveJob): Promise<SourceResult> {
  const since = Date.now() - 6 * 3600_000;
  const { text, citations } = await grok({
    system: `You are a CrawlHive crawler hunting X for narratives a memecoin could form around right now.\n${RULES}`,
    user: [
      specBrief(job),
      job.targets.length ? `Look around these topics first: ${job.targets.join(" | ")}.` : "",
      `Search X for what started spreading after ${new Date(since).toISOString()}: new memes and catchphrases, viral animals, new AI models or products, funny tech or internet moments, crypto culture jokes. Prefer things rising now over things that peaked days ago.`,
    ]
      .filter(Boolean)
      .join("\n"),
    xSearch: { fromDate: new Date(since).toISOString().slice(0, 10) },
  });
  let parsed: { narratives?: { title?: string; why?: string; ticker?: string; heat?: string; kind?: string; posts?: unknown[] }[] } = {};
  try {
    parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    parsed = {};
  }
  const cited = new Set(citations.map(idOf).filter(Boolean));
  const seen: Record<string, number> = (() => {
    try {
      return JSON.parse(job.cursor.seenNarr ?? "{}");
    } catch {
      return {};
    }
  })();
  const now = Date.now();
  for (const [k, t] of Object.entries(seen)) if (now - t > DEDUP_MS) delete seen[k];

  const signals: LiveSignalInput[] = [];
  let dropped = 0;
  for (const n of (parsed.narratives ?? []).slice(0, 6)) {
    const ticker = tickerOf(n.ticker);
    const title = String(n.title ?? "").trim().slice(0, 60);
    if (!ticker || !title || seen[ticker]) continue;
    const posts: string[] = [];
    for (const u of (Array.isArray(n.posts) ? n.posts : []).filter((x): x is string => typeof x === "string").slice(0, 3)) {
      const v = await verifyPost(u.startsWith("http") ? u : `https://${u}`);
      // Настоящий пост — берём; oEmbed молчит — оставляем, только если Grok сослался на него из поиска.
      if (v) posts.push(v);
      else if (v === undefined && cited.has(idOf(u))) posts.push(u.startsWith("http") ? u : `https://${u}`);
    }
    if (!posts.length) {
      dropped++;
      continue;
    }
    const conf = HEAT_CONF[String(n.heat)] ?? 0.55;
    if (conf < job.spec.minConfidence) continue;
    const c = await clones(job.chain, ticker);
    const heat = String(n.heat ?? "early");
    const cloneNote = c === null ? "" : c === 0 ? " No coin with this ticker launched in the last 24h." : ` ${c} coin${c === 1 ? "" : "s"} with this ticker launched in the last 24h.`;
    seen[ticker] = now;
    signals.push({
      kind: "narrative",
      ticker,
      text: `${title} (${heat}): ${String(n.why ?? "").trim().slice(0, 220)}${cloneNote}`,
      confidence: conf,
      urls: [...new Set(posts)],
    });
  }
  return { items: citations.length, signals, cursor: { seenNarr: JSON.stringify(seen), lastSeenAt: String(now) }, filtered: dropped };
}
