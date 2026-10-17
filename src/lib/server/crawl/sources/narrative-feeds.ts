// Подсказки для охоты за нарративами с других площадок: Reddit (RSS топа дня), новости (Google News, Cointelegraph),
// Hacker News (технологии и ИИ) и меты лаунчпадов (что бустят на DexScreener, кто стримит на pump.fun). Браузер и ключи
// не нужны. Каждый пункт получает метку (R1, N2, H3, L4): Grok отвечает метками, а ссылки мы подставляем сами —
// выдумать источник он не может. Сборка раз в час, с кэшем.
import "server-only";

export interface FeedItem {
  ref: string;
  platform: "reddit" | "news" | "hn" | "launchpad";
  title: string;
  url: string;
  where: string; // сабреддит, издание, площадка
}

const UA = "CrawlHive/1.0 (+https://crawlhive.xyz)";
const TTL = 55 * 60_000;
const SUBS = ["memes", "dankmemes", "interestingasfuck", "nextfuckinglevel", "aww", "technology", "CryptoCurrency", "solana"];

const g = globalThis as unknown as { __crawlhiveFeeds?: { at: number; items: FeedItem[] } };

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/<[^>]+>/g, "")
    .trim();

async function text(url: string) {
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.text();
}

async function reddit(): Promise<Omit<FeedItem, "ref">[]> {
  const out: Omit<FeedItem, "ref">[] = [];
  for (const sub of SUBS) {
    const xml = await text(`https://www.reddit.com/r/${sub}/top/.rss?t=day&limit=5`).catch(() => "");
    for (const e of xml.split("<entry>").slice(1, 5)) {
      const title = decode(e.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
      const url = e.match(/<link href="([^"]+)"/)?.[1] ?? "";
      if (title && url) out.push({ platform: "reddit", title: title.slice(0, 160), url, where: `r/${sub}` });
    }
  }
  return out;
}

async function rss(url: string, where: string, n: number): Promise<Omit<FeedItem, "ref">[]> {
  const xml = await text(url).catch(() => "");
  return xml
    .split("<item>")
    .slice(1, n + 1)
    .map((e) => ({ platform: "news" as const, title: decode(e.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "").slice(0, 160), url: decode(e.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? ""), where }))
    .filter((x) => x.title && x.url.startsWith("http"));
}

async function hn(): Promise<Omit<FeedItem, "ref">[]> {
  const ids = (await (await fetch("https://hacker-news.firebaseio.com/v0/topstories.json", { signal: AbortSignal.timeout(8000) })).json().catch(() => [])) as number[];
  const items = await Promise.all(
    ids.slice(0, 10).map((id) =>
      fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, { signal: AbortSignal.timeout(8000) })
        .then((r) => r.json() as Promise<{ title?: string; url?: string; id: number }>)
        .catch(() => null),
    ),
  );
  return items.filter((x): x is { title: string; url?: string; id: number } => !!x?.title).map((x) => ({ platform: "hn" as const, title: x.title.slice(0, 160), url: x.url ?? `https://news.ycombinator.com/item?id=${x.id}`, where: "Hacker News" }));
}

// Меты лаунчпадов: имена монет, которые сейчас стримят на pump.fun. Это не сигнал к покупке, а подсказка,
// какие темы сейчас «в моде» у создателей.
async function launchpads(): Promise<Omit<FeedItem, "ref">[]> {
  const r = await fetch("https://frontend-api-v3.pump.fun/coins/currently-live?limit=30&offset=0&includeNsfw=false", { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) }).catch(() => null);
  const coins = (r?.ok ? await r.json().catch(() => []) : []) as { name?: string; symbol?: string; mint?: string }[];
  return coins
    .filter((c) => c.name && c.mint)
    .slice(0, 20)
    .map((c) => ({ platform: "launchpad" as const, title: `${c.name} ($${c.symbol ?? "?"}) live on pump.fun`, url: `https://pump.fun/coin/${c.mint}`, where: "pump.fun live" }));
}

export async function narrativeFeeds(): Promise<FeedItem[]> {
  const c = g.__crawlhiveFeeds;
  if (c && Date.now() - c.at < TTL) return c.items;
  const [r, gn, ct, h, l] = await Promise.all([
    reddit().catch(() => []),
    rss("https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en", "Google News", 12).catch(() => []),
    rss("https://cointelegraph.com/rss", "Cointelegraph", 6).catch(() => []),
    hn().catch(() => []),
    launchpads().catch(() => []),
  ]);
  const prefix = { reddit: "R", news: "N", hn: "H", launchpad: "L" } as const;
  const count: Record<string, number> = {};
  const items = [...r, ...gn, ...ct, ...h, ...l].map((x) => ({ ...x, ref: `${prefix[x.platform]}${(count[x.platform] = (count[x.platform] ?? 0) + 1)}` }));
  g.__crawlhiveFeeds = { at: Date.now(), items };
  return items;
}

// Строки для промпта: «R3 [r/memes] заголовок».
export const feedBrief = (items: FeedItem[]) => items.map((x) => `${x.ref} [${x.where}] ${x.title}`).join("\n");
