// Grok Bots: необязательное подключение внешнего ИИ-агента (Grok Bot, Claude, Cursor — любой клиент MCP)
// к своим краулерам. Владелец создаёт бота, выбирает, над какими краулерами он стоит (один, два, все),
// и получает ключ. Агент по ключу ходит в /mcp и видит только эти краулеры: что нового, сигналы, статус,
// плюс бесплатный скан токена. Ключ хранится только хешем; показываем его один раз при создании.
// Основная работа сайта от ботов не зависит: нет ботов — всё работает как раньше.
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { ApiError, getMeta, listCrawlers, mySignals, setMeta } from "./store";
import type { Signal } from "../types";
import { dutyCrawlerIds } from "./grok-duty";

const KEY = "grokbots";
const MAX_PER_WALLET = 10;
const SCANS_PER_HOUR = 20; // скан через MCP: без Grok, но ходит в DexScreener и RPC
const LIVE_MS = 10 * 60_000; // бот считается «на связи», если обращался за последние 10 минут

export interface GrokBot {
  id: string;
  wallet: string;
  name: string;
  keyHash: string;
  keyTail: string; // последние символы ключа, чтобы владелец узнал его в списке
  crawlerIds: string[];
  createdAt: number;
  lastSeenAt?: number;
  calls: number;
  cursor?: number; // до какого времени бот уже видел сигналы (для whats_new)
  tokens?: BotToken[]; // доступ агентов, подключённых кнопкой Connect (OAuth), см. oauth.ts
}

// Токен OAuth: хранится только хешем, как и ключ. Удаление бота отзывает все его токены.
interface BotToken {
  h: string; // sha256 токена доступа cht_…
  rh: string; // sha256 токена обновления chr_…
  exp: number; // когда истекает токен доступа
  rexp: number; // когда истекает токен обновления
  app: string; // имя приложения из регистрации: ChatGPT, Claude, Muse…
  client?: string; // client_id OAuth: токен обновления принимаем только от того же приложения
  at: number;
}

export interface PublicBot extends Omit<GrokBot, "keyHash" | "cursor" | "tokens"> {
  live: boolean;
  apps: { name: string; at: number }[]; // агенты, подключённые через Connect
}

// Вызовы между записями на диск копим в памяти, чтобы счётчик не терял их.
const pending = new Map<string, number>();

const hash = (k: string) => createHash("sha256").update(k).digest("hex");

function all(): GrokBot[] {
  try {
    return JSON.parse(getMeta(KEY) ?? "[]");
  } catch {
    return [];
  }
}

function save(list: GrokBot[]) {
  for (const b of list) {
    b.calls += pending.get(b.id) ?? 0;
    pending.delete(b.id);
  }
  setMeta(KEY, JSON.stringify(list));
}

const toPublic = ({ keyHash: _k, cursor: _c, tokens, ...b }: GrokBot): PublicBot => ({
  ...b,
  calls: b.calls + (pending.get(b.id) ?? 0),
  live: !!b.lastSeenAt && Date.now() - b.lastSeenAt < LIVE_MS,
  apps: (tokens ?? []).filter((t) => t.rexp > Date.now()).map((t) => ({ name: t.app, at: t.at })),
});

// Краулеры кошелька, над которыми можно поставить бота: свои и арендованные.
function ownCrawlerIds(wallet: string) {
  return new Set(listCrawlers({ owner: wallet }, wallet).map((c) => c.id));
}

function cleanIds(wallet: string, ids: unknown): string[] {
  if (!Array.isArray(ids)) throw new ApiError("crawlerIds must be a list");
  const own = ownCrawlerIds(wallet);
  const out = [...new Set(ids.map(String))].filter((id) => own.has(id));
  if (!out.length) throw new ApiError("Pick at least one of your crawlers");
  return out;
}

const cleanName = (n: unknown) => {
  const s = String(n ?? "").trim().slice(0, 32);
  if (!s) throw new ApiError("Give the bot a name");
  return s;
};

export function listBots(wallet: string): PublicBot[] {
  return all()
    .filter((b) => b.wallet === wallet)
    .map(toPublic);
}

export function createBot(wallet: string, input: { name?: unknown; crawlerIds?: unknown }) {
  const list = all();
  if (list.filter((b) => b.wallet === wallet).length >= MAX_PER_WALLET) throw new ApiError(`Up to ${MAX_PER_WALLET} bots per wallet`);
  const key = `chb_${randomBytes(24).toString("base64url")}`;
  const bot: GrokBot = {
    id: `BOT-${randomBytes(3).toString("hex").toUpperCase()}`,
    wallet,
    name: cleanName(input.name),
    keyHash: hash(key),
    keyTail: key.slice(-4),
    crawlerIds: cleanIds(wallet, input.crawlerIds),
    createdAt: Date.now(),
    calls: 0,
    cursor: Date.now(),
  };
  save([...list, bot]);
  return { bot: toPublic(bot), key };
}

export function updateBot(wallet: string, id: string, input: { name?: unknown; crawlerIds?: unknown }) {
  const list = all();
  const b = list.find((x) => x.id === id && x.wallet === wallet);
  if (!b) throw new ApiError("Bot not found", 404);
  if (input.name !== undefined) b.name = cleanName(input.name);
  if (input.crawlerIds !== undefined) b.crawlerIds = cleanIds(wallet, input.crawlerIds);
  save(list);
  return toPublic(b);
}

export function deleteBot(wallet: string, id: string) {
  const list = all();
  if (!list.some((x) => x.id === id && x.wallet === wallet)) throw new ApiError("Bot not found", 404);
  save(list.filter((x) => x.id !== id));
  return { ok: true };
}

// Для карты роя: сколько ботов стоит над каждым краулером и на связи ли хоть один.
export function botsByCrawler(): Map<string, { count: number; live: boolean }> {
  const m = new Map<string, { count: number; live: boolean }>();
  const now = Date.now();
  for (const b of all()) {
    const live = !!b.lastSeenAt && now - b.lastSeenAt < LIVE_MS;
    for (const id of b.crawlerIds) {
      const cur = m.get(id) ?? { count: 0, live: false };
      m.set(id, { count: cur.count + 1, live: cur.live || live });
    }
  }
  // Встроенный бот с переключателя тоже стоит над краулером и всегда на связи.
  for (const id of dutyCrawlerIds()) {
    const cur = m.get(id) ?? { count: 0, live: false };
    m.set(id, { count: cur.count + 1, live: true });
  }
  return m;
}

// ---------- для MCP ----------

// Бот по ключу chb_ или токену OAuth cht_; заодно отмечаем, что он на связи.
// Краулеры, которые владелец потерял (истекла аренда), отсекаем.
export function botByKey(key: string): GrokBot | null {
  if (!key.startsWith("chb_") && !key.startsWith("cht_")) return null;
  const h = hash(key);
  const list = all();
  const now0 = Date.now();
  const b = key.startsWith("chb_") ? list.find((x) => x.keyHash === h) : list.find((x) => x.tokens?.some((t) => t.h === h && t.exp > now0));
  if (!b) return null;
  const now = Date.now();
  // Сохраняем не чаще раза в минуту: частые вызовы агента не должны дёргать запись на диск.
  pending.set(b.id, (pending.get(b.id) ?? 0) + 1);
  if (!b.lastSeenAt || now - b.lastSeenAt > 60_000) {
    b.lastSeenAt = now;
    save(list);
  }
  return b;
}

export function botCrawlers(b: GrokBot) {
  const ids = new Set(b.crawlerIds);
  return listCrawlers({ owner: b.wallet }, b.wallet).filter((c) => ids.has(c.id));
}

const brief = (s: Signal) => ({
  id: s.id,
  crawler: s.crawlerName,
  crawlerId: s.crawlerId,
  kind: s.kind,
  ticker: s.ticker || undefined,
  text: s.text,
  confidence: Math.round(s.confidence * 100) / 100,
  at: new Date(s.ts).toISOString(),
  token: s.token,
  urls: s.urls?.slice(0, 3),
  outcome: s.outcome && s.outcome.status !== "pending" ? { status: s.outcome.status, changePct: s.outcome.changePct } : undefined,
});

export function botSignals(b: GrokBot, opts: { crawlerId?: string; limit?: number } = {}) {
  const ids = new Set(b.crawlerIds);
  if (opts.crawlerId && !ids.has(opts.crawlerId)) throw new ApiError("This bot does not watch that crawler", 403);
  return mySignals(b.wallet, { crawlerId: opts.crawlerId, limit: 200 })
    .filter((s) => ids.has(s.crawlerId))
    .slice(0, Math.min(50, Math.max(1, opts.limit ?? 10)))
    .map(brief);
}

// Дешёвая проверка «что нового» с прошлого вызова: если ничего, агент может сразу засыпать.
export function botWhatsNew(b: GrokBot, since?: number) {
  const ids = new Set(b.crawlerIds);
  const from = since ?? b.cursor ?? Date.now() - 3600_000;
  const fresh = mySignals(b.wallet, { limit: 200 }).filter((s) => ids.has(s.crawlerId) && s.ts > from);
  const list = all();
  const me = list.find((x) => x.id === b.id);
  if (me) {
    me.cursor = Date.now();
    save(list);
  }
  return fresh.length
    ? { changed: true, count: fresh.length, signals: fresh.slice(0, 20).map(brief) }
    : { changed: false, note: "Nothing new since the last check. Safe to go back to sleep." };
}

const scanLog = new Map<string, number[]>();
export function allowBotScan(b: GrokBot) {
  const now = Date.now();
  const list = (scanLog.get(b.id) ?? []).filter((t) => now - t < 3600_000);
  if (list.length >= SCANS_PER_HOUR) return false;
  list.push(now);
  scanLog.set(b.id, list);
  return true;
}

// ---------- OAuth (oauth.ts) ----------

const ACCESS_TTL_MS = 30 * 86400_000;
const REFRESH_TTL_MS = 180 * 86400_000;
const MAX_TOKENS = 6; // подключений одного бота: старые вытесняются

export function ownBot(wallet: string, id: string) {
  const b = all().find((x) => x.id === id && x.wallet === wallet);
  if (!b) throw new ApiError("Pick one of your bots", 404);
  return b;
}

function mint(b: GrokBot, app: string, client?: string) {
  const access = `cht_${randomBytes(24).toString("base64url")}`;
  const refresh = `chr_${randomBytes(24).toString("base64url")}`;
  const now = Date.now();
  b.tokens = [...(b.tokens ?? []).filter((t) => t.rexp > now), { h: hash(access), rh: hash(refresh), exp: now + ACCESS_TTL_MS, rexp: now + REFRESH_TTL_MS, app, client, at: now }].slice(-MAX_TOKENS);
  return { access, refresh, expiresIn: ACCESS_TTL_MS / 1000 };
}

export function attachBotToken(wallet: string, botId: string, app: string, client?: string) {
  const list = all();
  const b = list.find((x) => x.id === botId && x.wallet === wallet);
  if (!b) throw new ApiError("Bot not found", 404);
  const t = mint(b, app, client);
  save(list);
  return t;
}

// Обновление: старая пара токенов сгорает, выдаётся новая.
export function refreshBotToken(refresh: string, clientId?: string) {
  if (!refresh.startsWith("chr_")) return null;
  const rh = hash(refresh);
  const list = all();
  const now = Date.now();
  for (const b of list) {
    const old = b.tokens?.find((t) => t.rh === rh && t.rexp > now);
    if (!old) continue;
    if (old.client && clientId && old.client !== clientId) return null;
    b.tokens = b.tokens!.filter((t) => t !== old);
    const t = mint(b, old.app, old.client);
    save(list);
    return t;
  }
  return null;
}

// Отключить одно приложение от бота, не трогая ключ и остальные подключения.
export function disconnectApp(wallet: string, botId: string, at: number) {
  const list = all();
  const b = list.find((x) => x.id === botId && x.wallet === wallet);
  if (!b) throw new ApiError("Bot not found", 404);
  b.tokens = (b.tokens ?? []).filter((t) => t.at !== at);
  save(list);
  return toPublic(b);
}
