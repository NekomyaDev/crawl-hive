// Медиа и охват нарративов. Статистика и картинки постов — из публичного API fxtwitter (без ключа и без X API):
// просмотры, лайки, репосты, подписчики автора, фото и превью видео. Картинки отдаём через свой прокси
// (только pbs.twimg.com), чтобы браузер мог положить их в форму запуска и в баннер без CORS.
// ИИ-арт для монеты (grok-imagine-image, ~$0.02) рисуется только по кнопке при запуске, с кэшем и лимитами.
import "server-only";
import path from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

export interface PostInfo {
  likes: number;
  reposts: number;
  replies: number;
  views: number;
  followers: number;
  createdAt: number;
  images: string[];
  text: string;
}

const POST_TTL = 60 * 60_000;
const g = globalThis as unknown as { __crawlhivePosts?: Map<string, { at: number; v: PostInfo | null }>; __crawlhiveArt?: { day: string; n: number; ip: Map<string, number> } };
const posts = () => (g.__crawlhivePosts ??= new Map());

const idOf = (u: string) => u.match(/status(?:es)?\/(\d{5,25})/)?.[1];

export async function postInfo(url: string): Promise<PostInfo | null> {
  const id = idOf(url);
  if (!id) return null;
  const hit = posts().get(id);
  if (hit && Date.now() - hit.at < POST_TTL) return hit.v;
  let v: PostInfo | null = null;
  try {
    const r = await fetch(`https://api.fxtwitter.com/status/${id}`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const t = ((await r.json()) as { tweet?: Record<string, unknown> }).tweet as
        | { text?: string; likes?: number; retweets?: number; replies?: number; views?: number; created_timestamp?: number; author?: { followers?: number }; media?: { photos?: { url: string }[]; videos?: { thumbnail_url?: string }[] } }
        | undefined;
      if (t) {
        const images = [...(t.media?.photos ?? []).map((p) => p.url), ...(t.media?.videos ?? []).map((x) => x.thumbnail_url ?? "")].filter((u) => /^https:\/\/pbs\.twimg\.com\//.test(u)).slice(0, 4);
        v = { likes: t.likes ?? 0, reposts: t.retweets ?? 0, replies: t.replies ?? 0, views: t.views ?? 0, followers: t.author?.followers ?? 0, createdAt: (t.created_timestamp ?? 0) * 1000, images, text: String(t.text ?? "").slice(0, 600) };
      }
    }
  } catch {
    v = hit?.v ?? null;
  }
  if (posts().size > 3000) posts().clear();
  posts().set(id, { at: Date.now(), v });
  return v;
}

// Прокси картинок X: только pbs.twimg.com, только изображения, до 5 МБ.
export async function twimg(u: string): Promise<{ type: string; bytes: ArrayBuffer } | null> {
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "pbs.twimg.com") return null;
  const r = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: "error" }).catch(() => null);
  const type = r?.headers.get("content-type") ?? "";
  if (!r?.ok || !type.startsWith("image/")) return null;
  const bytes = await r.arrayBuffer();
  return bytes.byteLength > 5_000_000 ? null : { type, bytes };
}

// ---------- ИИ-арт ----------

const ART_DAY = () => Number(process.env.NARR_ART_DAILY ?? 60);
const ART_IP_DAY = 6;
const artDir = () => path.join(process.env.DATA_DIR?.trim() || path.join(/* turbopackIgnore: true */ process.cwd(), ".data"), "narr-art");
const artFile = (id: string) => path.join(artDir(), `${id.replace(/[^a-z0-9-]/gi, "")}.png`);

export function cachedArt(id: string): Buffer | null {
  const f = artFile(id);
  return existsSync(f) ? readFileSync(f) : null;
}

export async function makeArt(id: string, n: { title: string; why: string; ticker: string }, ip: string): Promise<Buffer> {
  const have = cachedArt(id);
  if (have) return have;
  if (!process.env.XAI_API_KEY?.trim()) throw new Error("Art is not available right now");
  const day = new Date().toISOString().slice(0, 10);
  const q = (g.__crawlhiveArt ??= { day, n: 0, ip: new Map() });
  if (q.day !== day) Object.assign(q, { day, n: 0, ip: new Map() });
  if (q.n >= ART_DAY()) throw new Error("Today's art budget is used up. Upload your own picture or use the post image.");
  if ((q.ip.get(ip) ?? 0) >= ART_IP_DAY) throw new Error("You generated enough art today. Upload your own picture or use the post image.");
  q.n++;
  q.ip.set(ip, (q.ip.get(ip) ?? 0) + 1);
  // Название и тикер в промпт не кладём: модель тогда пишет их текстом на картинке.
  const prompt = [
    "Square mascot illustration for a memecoin, used as a round coin logo.",
    `Subject: ${n.why.replace(/\$[A-Z0-9]+/g, "").replace(/["“”]/g, "")}`,
    "Bold, bright, funny cartoon style, one clear central character or object, thick outlines, vivid colors, plain simple background, readable at small size.",
    "Absolutely no text, no letters, no words, no numbers, no logos, no watermarks, no real people's faces.",
  ].join("\n");
  const r = await fetch("https://api.x.ai/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.XAI_API_KEY}` },
    body: JSON.stringify({ model: process.env.XAI_IMAGE_MODEL?.trim() || "grok-imagine-image", prompt, n: 1, response_format: "b64_json" }),
    signal: AbortSignal.timeout(60_000),
  });
  const j = (await r.json().catch(() => ({}))) as { data?: { b64_json?: string; url?: string }[]; error?: unknown };
  let buf: Buffer | null = null;
  const d = j.data?.[0];
  if (d?.b64_json) buf = Buffer.from(d.b64_json, "base64");
  else if (d?.url) buf = Buffer.from(await (await fetch(d.url, { signal: AbortSignal.timeout(20_000) })).arrayBuffer());
  if (!r.ok || !buf) {
    q.n--;
    q.ip.set(ip, Math.max(0, (q.ip.get(ip) ?? 1) - 1));
    console.warn("[narratives] art failed", r.status, JSON.stringify(j.error ?? {}).slice(0, 200));
    throw new Error("Could not draw the art right now. Try again or upload your own picture.");
  }
  console.log(`[narratives] art for $${n.ticker} (${q.n} today)`);
  mkdirSync(artDir(), { recursive: true });
  writeFileSync(artFile(id), buf);
  return buf;
}
