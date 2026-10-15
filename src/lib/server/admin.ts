// Админка владельца проекта: кто админ, учёт пользователей Telegram, обращения в поддержку и сводная статистика.
// Админ определяется по Telegram id (TELEGRAM_ADMIN_IDS) или username (TELEGRAM_ADMIN_USERNAMES, по умолчанию h100envy).
import "server-only";
import { getMeta, listCrawlers, metaEntries, networkStats, paymentTotals, setMeta } from "./store";
import { x402Stats } from "./x402";

const ids = () => (process.env.TELEGRAM_ADMIN_IDS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const names = () => (process.env.TELEGRAM_ADMIN_USERNAMES ?? "h100envy").split(",").map((x) => x.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);

export function isAdmin(u: { id: number | string; username?: string }) {
  return ids().includes(String(u.id)) || (!!u.username && names().includes(u.username.toLowerCase()));
}

// ---------- пользователи Telegram ----------

interface TgUserRec {
  n: string; // имя
  u?: string; // username
  first: number;
  last: number;
  scans: number;
  app?: number; // когда последний раз открывал мини-апп
}
const USERS_KEY = "tgusers";
const MAX_USERS = 50_000;

function users(): Record<string, TgUserRec> {
  try {
    return JSON.parse(getMeta(USERS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

// Запись не чаще раза в минуту на пользователя: бот и мини-апп дёргают это на каждое действие.
const touched = new Map<string, number>();
export function seenTgUser(u: { id: number; first_name?: string; username?: string }, what: "msg" | "scan" | "app" = "msg") {
  const id = String(u.id);
  const now = Date.now();
  if (what === "msg" && now - (touched.get(id) ?? 0) < 60_000) return;
  touched.set(id, now);
  if (touched.size > 20_000) touched.clear();
  const all = users();
  const r = all[id] ?? { n: "", first: now, last: now, scans: 0 };
  r.n = (u.first_name ?? r.n ?? "").slice(0, 40);
  if (u.username) r.u = u.username.slice(0, 40);
  r.last = now;
  if (what === "scan") r.scans++;
  if (what === "app") r.app = now;
  all[id] = r;
  const keys = Object.keys(all);
  if (keys.length > MAX_USERS) delete all[keys.sort((a, b) => all[a].last - all[b].last)[0]];
  setMeta(USERS_KEY, JSON.stringify(all));
}

// ---------- поддержка ----------

export interface SupportMsg {
  from: number;
  name: string;
  username?: string;
  text: string;
  at: number;
  answered?: boolean;
}
const SUPPORT_KEY = "tgsupport";

export function supportList(): SupportMsg[] {
  try {
    return JSON.parse(getMeta(SUPPORT_KEY) ?? "[]");
  } catch {
    return [];
  }
}
export function addSupport(m: SupportMsg) {
  setMeta(SUPPORT_KEY, JSON.stringify([m, ...supportList()].slice(0, 300)));
}
export function markAnswered(userId: number) {
  setMeta(SUPPORT_KEY, JSON.stringify(supportList().map((m) => (m.from === userId ? { ...m, answered: true } : m))));
}

// Чаты админов: куда пересылать обращения. Запоминаем, когда админ пишет боту.
export function rememberAdminChat(chat: string) {
  const list = adminChats();
  if (!list.includes(chat)) setMeta("tgadminchats", JSON.stringify([...list, chat].slice(-10)));
}
export function adminChats(): string[] {
  try {
    return JSON.parse(getMeta("tgadminchats") ?? "[]");
  } catch {
    return [];
  }
}

// ---------- сводка ----------

const DAY = 86_400_000;
const parse = <T,>(k: string, d: T): T => {
  try {
    return JSON.parse(getMeta(k) ?? "") as T;
  } catch {
    return d;
  }
};

export async function adminStats() {
  const now = Date.now();
  const net = networkStats();
  const crawlers = listCrawlers({});
  const live = crawlers.filter((c) => c.live);
  const u = Object.values(users());
  const track = parse<{ at: number; src: string; verdict: string }[]>("track", []);
  const radar = parse<{ at: number }[]>("radar", []);
  const prefs = parse<Record<string, { alerts?: { on?: boolean } }>>("tgprefs", {});
  const watch = parse<Record<string, unknown[]>>("tgwatch", {});
  const bots = parse<{ tokens?: { rexp: number }[]; lastSeenAt?: number }[]>("grokbots", []);
  const duty = parse<Record<string, unknown>>("grokduty", {});
  const support = supportList();
  const { grokUsage } = await import("./crawl/grok");
  const { jevUsage } = await import("./crawl/jev");
  const rate = (globalThis as unknown as { __crawlhiveRate?: { blocked: number; day?: string; uniq?: Set<string>; reqs?: number } }).__crawlhiveRate;
  let treasury: { sol?: number; eth?: number; solUsd?: number; ethUsd?: number } = {};
  try {
    const { treasuryBalance, solUsd } = await import("./solana");
    const { ethTreasuryBalance, ethUsd } = await import("./robinhood");
    const [sol, su, eth, eu] = await Promise.all([treasuryBalance(), solUsd(), ethTreasuryBalance(), ethUsd()]);
    treasury = { sol: sol ?? undefined, solUsd: su ?? undefined, eth: eth ?? undefined, ethUsd: eu ?? undefined };
  } catch {}
  // Байбеки и награды дня: итоги из журнала (эмиссия минта под кэшем, без лишних запросов к RPC).
  let buybacks = { count: 0, sol: 0, burned: 0, burnedPct: 0, rewardsSol: 0, rewardDays: 0 };
  try {
    const { buybackStats } = await import("./buyback");
    const { rewardsTotals } = await import("./rewards");
    const [b, r] = [await buybackStats(), rewardsTotals()];
    buybacks = { count: b.count, sol: b.solSpent, burned: b.burned, burnedPct: b.burnedPct, rewardsSol: r.paidSol, rewardDays: r.paidDays };
  } catch {}
  const bySrc = (since: number) => {
    const out: Record<string, number> = {};
    for (const e of track) if (e.at > since) out[e.src] = (out[e.src] ?? 0) + 1;
    return out;
  };
  return {
    at: now,
    users: {
      telegram: u.length,
      telegram24h: u.filter((x) => now - x.last < DAY).length,
      new24h: u.filter((x) => now - x.first < DAY).length,
      app24h: u.filter((x) => x.app && now - x.app < DAY).length,
      tgScans: u.reduce((n, x) => n + x.scans, 0),
      walletsLinked: metaEntries("tg:").length,
      owners: new Set(crawlers.map((c) => c.owner)).size,
      recent: u.sort((a, b) => b.last - a.last).slice(0, 12).map((x) => ({ name: x.n, username: x.u ?? null, last: x.last, scans: x.scans })),
    },
    traffic: { visitorsToday: rate?.uniq?.size ?? null, requestsToday: rate?.reqs ?? null, blocked: rate?.blocked ?? 0 },
    scans: { verdicts24h: bySrc(now - DAY), total: track.length, radar24h: radar.filter((r) => now - r.at < DAY).length },
    crawlers: {
      total: crawlers.length,
      live: live.length,
      active: live.filter((c) => c.status === "active").length,
      bySource: live.reduce<Record<string, number>>((m, c) => ((m[c.source] = (m[c.source] ?? 0) + 1), m), {}),
      failing: live.filter((c) => (c.run?.failStreak ?? 0) > 0).map((c) => ({ id: c.id, name: c.name, streak: c.run?.failStreak, error: c.run?.lastError })),
      signals24h: net.signals24h,
      scored: net.scored,
      hits: net.hits,
    },
    money: { ...paymentTotals(), treasury, buybacks },
    ai: { grok: grokUsage(), jev: jevUsage() },
    // Оплата агентами за вызов (x402): вызовы и USDC за сутки и за всё время.
    x402: x402Stats(),
    agents: {
      bots: bots.length,
      botsLive: bots.filter((b) => b.lastSeenAt && now - b.lastSeenAt < 10 * 60_000).length,
      oauthApps: bots.reduce((n, b) => n + (b.tokens ?? []).filter((t) => t.rexp > now).length, 0),
      dutyCrawlers: Object.keys(duty).length,
    },
    telegram: {
      watchers: Object.keys(watch).length,
      watched: Object.values(watch).reduce((n, l) => n + l.length, 0),
      alertSubs: Object.values(prefs).filter((p) => p.alerts?.on).length,
      groups: Object.keys(prefs).filter((k) => k.startsWith("-")).length,
    },
    support: { open: support.filter((m) => !m.answered).length, latest: support.slice(0, 10) },
  };
}
