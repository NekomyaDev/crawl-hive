// Охота за нарративами (режим X-краулера с типом сигнала narrative): Grok ищет в X то, что начало расходиться
// в последние часы и вокруг чего может появиться мемкоин. Каждая ссылка на пост проверяется публичным oEmbed X:
// выдуманные (404) отбрасываются, у настоящих подставляется реальный автор. Нарратив без единого настоящего поста
// не попадает в сигналы. Плюс счётчик клонов: сколько монет с таким тикером уже появилось на DexScreener за сутки.
import "server-only";
import type { LiveJob, LiveSignalInput } from "../../store";
import { grok } from "../grok";
import { specBrief } from "../analyze";
import type { SourceResult } from "./types";
import { feedBrief, type FeedItem } from "./narrative-feeds";
import { postInfo } from "../../narrative-media";

const DEDUP_MS = 12 * 3600_000;
// Адрес контракта (Solana base58 32–44 знака или EVM 0x…40) в тексте — признак рекламы монеты, а не органики.
export const CA_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b|\b0x[a-fA-F0-9]{40}\b/;
// Тикер уже занят монетой дороже этого — нарратив опоздал (или это вообще чужая монета).
const TAKEN_FDV = () => Number(process.env.NARR_TAKEN_FDV ?? 500_000);
export const SHILL_RE = /\b(launchpad|airdrop|presale|whitelist|stealth launch|fair launch|CA:|contract address)\b/i;
const HEAT_CONF: Record<string, number> = { early: 0.55, rising: 0.7, hot: 0.85 };

const RULES = `Reply with JSON only, no prose:
{"narratives":[{"title":"max 6 words","why":"one sentence: what is happening and why people care","ticker":"2-10 letters A-Z/0-9, no $","heat":"early|rising|hot","kind":"meme|ai|animal|tech|culture|crypto|other","posts":["x.com/<user>/status/<id> links you actually found"],"refs":["labels like R3, N1 from the other-platform list that are about the same thing, if any"]}]}
Up to 6 narratives. heat: early = a few posts, rising = spreading fast, hot = everywhere.
Skip tragedies, deaths, disasters, wars, politics, hate, sexual content, anything about minors.
Skip anything that is an existing coin with a real market (big established tickers like BONK, WIF, PEPE), a token, launchpad or project promoting itself (shills, launch announcements, airdrops, "CA:" posts): the narrative must be organic internet culture. No price predictions. Never invent links.`;

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

// Монеты на этом тикере по DexScreener: сколько появилось за сутки на сети краулера (свежий нарратив и выжатый
// выглядят по-разному) и самая дорогая монета с таким тикером на любой сети (если дороже порога — тикер занят).
async function tickerMarket(chain: string, ticker: string): Promise<{ clones: number | null; taken: number }> {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(ticker)}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return { clones: null, taken: 0 };
    const pairs = ((await r.json()) as { pairs?: { chainId?: string; pairCreatedAt?: number; fdv?: number; marketCap?: number; baseToken?: { address?: string; symbol?: string } }[] }).pairs ?? [];
    const same = pairs.filter((p) => p.baseToken?.symbol?.toUpperCase().replace(/^\$/, "") === ticker);
    const day = Date.now() - 86_400_000;
    const tokens = new Set(same.filter((p) => p.chainId === chain && (p.pairCreatedAt ?? 0) > day).map((p) => p.baseToken!.address));
    return { clones: tokens.size, taken: Math.max(0, ...same.map((p) => p.fdv ?? p.marketCap ?? 0)) };
  } catch {
    return { clones: null, taken: 0 };
  }
}

export interface Narrative {
  title: string;
  why: string;
  ticker: string;
  heat: string;
  kind: string;
  conf: number;
  posts: string[];
  clones: number | null;
  refs?: { platform: string; title: string; url: string; where: string }[]; // подтверждения с других площадок
}

// Одна охота: Grok ищет в X, ссылки проверяются oEmbed, по каждому тикеру считаются клоны. Общая для
// краулеров пользователей и для Narrative Radar платформы. Возвращает и обновлённый словарь «уже видели».
export async function huntNarratives(opts: { brief: string; targets: string[]; chain: string; seen: Record<string, number>; feeds?: FeedItem[] }) {
  const since = Date.now() - 6 * 3600_000;
  const { text, citations } = await grok({
    system: `You are a CrawlHive crawler hunting X for narratives a memecoin could form around right now.\n${RULES}`,
    user: [
      opts.brief,
      opts.targets.length ? `Look around these topics first: ${opts.targets.join(" | ")}.` : "",
      `Search X for what started spreading after ${new Date(since).toISOString()}: new memes and catchphrases, viral animals, new AI models or products, funny tech or internet moments, crypto culture jokes. Prefer things rising now over things that peaked days ago.`,
      opts.feeds?.length
        ? `Other platforms right now (hints only: report one only if you also find it spreading on X, and put the matching labels in "refs"):\n${feedBrief(opts.feeds)}`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
    xSearch: { fromDate: new Date(since).toISOString().slice(0, 10) },
  });
  let parsed: { narratives?: { title?: string; why?: string; ticker?: string; heat?: string; kind?: string; posts?: unknown[]; refs?: unknown[] }[] } = {};
  try {
    parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    parsed = {};
  }
  const cited = new Set(citations.map(idOf).filter(Boolean));
  const seen = { ...opts.seen };
  const now = Date.now();
  for (const [k, t] of Object.entries(seen)) if (now - t > DEDUP_MS) delete seen[k];

  const found: Narrative[] = [];
  let dropped = 0;
  for (const n of (parsed.narratives ?? []).slice(0, 6)) {
    const ticker = tickerOf(n.ticker);
    const title = String(n.title ?? "").trim().slice(0, 60);
    if (!ticker || !title || seen[ticker]) continue;
    // Самореклама проектов и лаунчпадов — не нарратив, даже если Grok её пропустил.
    if (SHILL_RE.test(`${title} ${n.why ?? ""}`) || CA_RE.test(`${title} ${n.why ?? ""}`)) continue;
    const posts: string[] = [];
    for (const u of (Array.isArray(n.posts) ? n.posts : []).filter((x): x is string => typeof x === "string").slice(0, 3)) {
      const v = await verifyPost(u.startsWith("http") ? u : `https://${u}`);
      // Настоящий пост — берём; oEmbed молчит — оставляем, только если Grok сослался на него из поиска.
      const link = v ?? (v === undefined && cited.has(idOf(u)) ? (u.startsWith("http") ? u : `https://${u}`) : null);
      if (!link) continue;
      // Пост с адресом контракта — реклама монеты, такой не подтверждает органику.
      const info = await postInfo(link).catch(() => null);
      if (info && CA_RE.test(info.text)) continue;
      posts.push(link);
    }
    if (!posts.length) {
      dropped++;
      continue;
    }
    const heat = ["early", "rising", "hot"].includes(String(n.heat)) ? String(n.heat) : "early";
    const market = await tickerMarket(opts.chain, ticker);
    if (market.taken >= TAKEN_FDV()) {
      dropped++;
      continue;
    }
    const refs = (Array.isArray(n.refs) ? n.refs : [])
      .map((r) => opts.feeds?.find((f) => f.ref === String(r).trim().toUpperCase()))
      .filter((f): f is FeedItem => !!f)
      .slice(0, 4)
      .map(({ platform, title: t, url, where }) => ({ platform, title: t, url, where }));
    found.push({
      title,
      why: String(n.why ?? "").trim().slice(0, 220),
      ticker,
      heat,
      kind: String(n.kind ?? "other").slice(0, 12),
      conf: HEAT_CONF[heat],
      posts: [...new Set(posts)],
      clones: market.clones,
      ...(refs.length ? { refs } : {}),
    });
  }
  return { found, seen, dropped, items: citations.length };
}

export async function crawlNarratives(job: LiveJob): Promise<SourceResult> {
  const seen0: Record<string, number> = (() => {
    try {
      return JSON.parse(job.cursor.seenNarr ?? "{}");
    } catch {
      return {};
    }
  })();
  const { found, seen, dropped, items } = await huntNarratives({ brief: specBrief(job), targets: job.targets, chain: job.chain, seen: seen0 });
  const now = Date.now();
  const signals: LiveSignalInput[] = [];
  for (const n of found) {
    if (n.conf < job.spec.minConfidence) continue;
    const c = n.clones;
    const cloneNote = c === null ? "" : c === 0 ? " No coin with this ticker launched in the last 24h." : ` ${c} coin${c === 1 ? "" : "s"} with this ticker launched in the last 24h.`;
    seen[n.ticker] = now;
    signals.push({ kind: "narrative", ticker: n.ticker, text: `${n.title} (${n.heat}): ${n.why}${cloneNote}`, confidence: n.conf, urls: n.posts });
  }
  return { items, signals, cursor: { seenNarr: JSON.stringify(seen), lastSeenAt: String(now) }, filtered: dropped };
}
