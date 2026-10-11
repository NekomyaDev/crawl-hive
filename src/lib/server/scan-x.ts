// Instant Crawl, краулер X: Grok ищет в X посты о токене за последние двое суток и коротко пересказывает,
// что о нём говорят. Поиск идёт 30–60 секунд и стоит денег, поэтому он догружается после основного
// вердикта только по кнопке, на оценку не влияет, кэшируется на 6 часов и ограничен в сутки и по IP.
import "server-only";
import { extractJson, grok, grokEnabled } from "./crawl/grok";

export interface XBuzz {
  sentiment: "bullish" | "mixed" | "bearish" | "quiet";
  summary: string;
  warnings: string[]; // обвинения в скаме, руге, взломе — то, что стоит прочитать до покупки
  posts: { handle: string; text: string; url: string }[];
  // Кто писал о токене: один человек — один пузырь на карте «who's talking», с его самым показательным постом.
  voices?: XVoice[];
  at: number;
}

export interface XVoice {
  handle: string;
  name: string;
  text: string;
  url: string;
  stance: "bullish" | "bearish" | "neutral";
  posts: number; // сколько постов этого автора нашлось
  avatar?: string; // pbs.twimg.com, из профиля через fxtwitter
  followers?: number;
}

// Аватар и подписчики автора: публичный API fxtwitter, без ключа. Кэш на сутки, на ошибку — без аватара.
const profiles = globalThis as unknown as { __crawlhiveXProfiles?: Map<string, { at: number; avatar?: string; followers?: number }> };
async function profile(handle: string) {
  const cache = (profiles.__crawlhiveXProfiles ??= new Map());
  const key = handle.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 86400_000) return hit;
  try {
    const r = await fetch(`https://api.fxtwitter.com/${encodeURIComponent(handle)}`, { signal: AbortSignal.timeout(6000) });
    if (!r.ok && r.status !== 404) throw new Error(`fxtwitter ${r.status}`);
    const u = ((await r.json()) as { user?: { avatar_url?: string; followers?: number } }).user;
    const url = typeof u?.avatar_url === "string" && /^https:\/\/pbs\.twimg\.com\//.test(u.avatar_url) ? u.avatar_url.replace("_normal.", "_200x200.") : undefined;
    const v = { at: Date.now(), avatar: url, followers: typeof u?.followers === "number" ? u.followers : undefined };
    cache.set(key, v);
    return v;
  } catch {
    // Сбой не кэшируем: следующий скан попробует снова.
    return { at: 0 } as { at: number; avatar?: string; followers?: number };
  }
}

async function withProfiles(voices: XVoice[]): Promise<XVoice[]> {
  const out = [...voices];
  // По 6 запросов разом, чтобы не долбить fxtwitter тридцатью сразу.
  for (let i = 0; i < out.length; i += 6) {
    await Promise.all(
      out.slice(i, i + 6).map(async (v, k) => {
        const p = await profile(v.handle);
        out[i + k] = { ...v, avatar: p.avatar, followers: p.followers };
      }),
    );
  }
  // Кому не ответили с первого раза (лимит, таймаут) — ещё раз по одному.
  for (let i = 0; i < out.length; i++) {
    if (out[i].followers !== undefined) continue;
    await new Promise((r) => setTimeout(r, 300));
    const p = await profile(out[i].handle);
    out[i] = { ...out[i], avatar: p.avatar, followers: p.followers };
  }
  // Крупные аккаунты — ближе к центру карты.
  return out.sort((a, b) => (b.followers ?? 0) - (a.followers ?? 0));
}

// Поиск платный (xAI берёт и за каждый вытянутый пост), поэтому сводку держим долго, а лимиты — маленькие.
export const BUZZ_TTL_MS = 6 * 3600_000;
const DAILY = () => Number(process.env.SCAN_X_DAILY ?? 20);
const PER_IP_HOUR = 2;

const g = globalThis as unknown as {
  __crawlhiveScanX?: { cache: Map<string, XBuzz>; inflight: Map<string, Promise<XBuzz>>; day: string; used: number; ips: Map<string, number[]> };
};
function mem() {
  g.__crawlhiveScanX ??= { cache: new Map(), inflight: new Map(), day: "", used: 0, ips: new Map() };
  return g.__crawlhiveScanX;
}

export const scanXEnabled = () => grokEnabled() && DAILY() > 0;

export function cachedBuzz(id: string) {
  const c = mem().cache.get(id);
  return c && Date.now() - c.at < BUZZ_TTL_MS ? c : null;
}

// null — можно; строка — почему нельзя.
function admit(ip: string): string | null {
  const m = mem();
  const day = new Date().toISOString().slice(0, 10);
  if (m.day !== day) Object.assign(m, { day, used: 0 });
  if (m.used >= DAILY()) return "daily X budget for free scans is used up, back tomorrow";
  const now = Date.now();
  const list = (m.ips.get(ip) ?? []).filter((t) => now - t < 3600_000);
  if (list.length >= PER_IP_HOUR) return "X check limit for your network reached, try again within the hour";
  list.push(now);
  m.ips.set(ip, list);
  m.used++;
  return null;
}

// Строка для лога краулеров: настроение, предупреждения и сводка.
export const buzzLine = (x: XBuzz) => ({
  crawler: "crawler_x",
  text: `${x.sentiment}${x.warnings.length ? ` · warnings: ${x.warnings.join(", ")}` : ""} · ${x.summary}`,
  tone: x.warnings.length || x.sentiment === "bearish" ? "bad" : x.sentiment === "bullish" ? "ok" : "info",
});

const cited = (real: Set<string>, url: string) => {
  const id = url.match(/status\/(\d+)/)?.[1];
  return !!id && [...real].some((c) => c.includes(id));
};

export async function scanX(t: { id: string; symbol: string; name: string; chain?: string }, ip: string): Promise<XBuzz> {
  const m = mem();
  const hit = cachedBuzz(t.id);
  if (hit) return hit;
  const running = m.inflight.get(t.id);
  if (running) return running;
  const why = admit(ip);
  if (why) throw new Error(why);

  const p = (async () => {
    const since = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);
    const { text, citations } = await grok({
      system:
        "You check what people on X say about a crypto token. Search X, read the posts, and answer with JSON only: " +
        '{"sentiment":"bullish|mixed|bearish|quiet","summary":"one plain sentence, max 30 words","warnings":["short phrase"],"posts":[{"handle":"name without @","name":"display name","text":"under 140 chars","url":"https://x.com/...","stance":"bullish|bearish|neutral"}]}. ' +
        "sentiment is quiet when there are fewer than 5 relevant posts. warnings: only concrete accusations people make (rug, scam, hacked, dev sold, bundled supply, fake volume); empty if none. " +
        "posts: up to 8 posts by different authors, most informative first, real URLs from your search only; text is a short faithful excerpt of the post. Work from the search results; do not open posts one by one. Skip pure bots and spam reposts. Ignore posts about other tokens that share the ticker.",
      // Один поисковый запрос вместо трёх: xAI берёт за каждый пост в выдаче, а три запроса приносят одни и те же посты.
      user: `Token: $${t.symbol}${t.name ? ` (${t.name})` : ""}, ${t.chain === "robinhood" ? "Robinhood Chain" : "Solana"} contract ${t.id}. Make exactly one X search, for the query "${t.id} OR $${t.symbol}", since ${since}.`,
      xSearch: { fromDate: since },
      // Один круг поиска: каждый следующий заново скармливает модели все найденные посты и умножает счёт.
      maxTurns: 1,
      timeoutMs: 90_000,
    });
    const j = extractJson<Partial<XBuzz>>(text) ?? {};
    const real = new Set(citations);
    const byHandle = new Map<string, XVoice>();
    for (const x of Array.isArray(j.posts) ? (j.posts as Partial<XVoice>[]) : []) {
      if (!x || typeof x.url !== "string" || !/^https:\/\/(x|twitter)\.com\//.test(x.url) || !cited(real, x.url)) continue;
      // Ник берём из самой ссылки: x.com/<ник>/status/…; модель могла записать его иначе.
      const handle = (x.url.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\//)?.[1] ?? String(x.handle ?? "").replace(/^@/, "")).slice(0, 15);
      if (!handle || handle === "i") continue;
      const key = handle.toLowerCase();
      const prev = byHandle.get(key);
      if (prev) {
        prev.posts++;
        continue;
      }
      byHandle.set(key, {
        handle,
        name: String(x.name ?? "").slice(0, 40) || handle,
        text: String(x.text ?? "").slice(0, 160),
        url: x.url,
        stance: (["bullish", "bearish", "neutral"] as const).includes(x.stance as XVoice["stance"]) ? (x.stance as XVoice["stance"]) : "neutral",
        posts: 1,
      });
    }
    const voices = await withProfiles([...byHandle.values()].slice(0, 8));
    const buzz: XBuzz = {
      sentiment: (["bullish", "mixed", "bearish", "quiet"] as const).includes(j.sentiment as XBuzz["sentiment"]) ? (j.sentiment as XBuzz["sentiment"]) : "quiet",
      summary: String(j.summary ?? "").slice(0, 240) || "Nothing notable on X in the last two days.",
      warnings: (Array.isArray(j.warnings) ? j.warnings : []).map((w) => String(w).slice(0, 60)).slice(0, 4),
      // Ссылки берём только те, что Grok реально нашёл, — выдуманные URL не показываем.
      posts: [...byHandle.values()].slice(0, 4).map(({ handle, text, url }) => ({ handle, text, url })),
      voices,
      at: Date.now(),
    };
    m.cache.set(t.id, buzz);
    return buzz;
  })().finally(() => m.inflight.delete(t.id));
  m.inflight.set(t.id, p);
  return p;
}
