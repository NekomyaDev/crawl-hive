// Профиль токена: /token/<адрес>. Собирает всё, что CrawlHive уже знает о токене, без новых сетевых запросов:
// последний сохранённый скан (публичный вердикт v2), снимки прошлых сканов (scan-memory, до 10 на токен),
// записи Track Record (track.ts) и память роя в SQLite (dev, связанные кошельки).
// Плюс голоса сообщества: держатели (Holder и выше) ставят 👍/👎 «анализу» и «токену» и пишут короткий комментарий.
// Голоса только для справки: в балл и вердикт они НЕ идут, и ничего здесь их туда не передаёт.
import "server-only";
import { ApiError } from "./store";
import { savedScan, allowHit } from "./scan";
import { tokenSnapshots } from "./scan-memory";
import { trackEntries, type TrackEntry } from "./track";
import { memDb, launchOf } from "./memory-db";
import { tierOf, tierAtLeast } from "./tiers";

export const VOTE_TIER = "holder" as const;
export const COMMENT_MAX = 280;
export const COMMENTS_PER_DAY = 5;
const DAY_MS = 86_400_000;
const COMMENTS_SHOWN = 30;

export type VoteTarget = "analysis" | "token";
export interface VoteTotals { up: number; down: number }
export interface TokenComment { id: number; wallet: string; text: string; at: number }

export interface TimelinePoint { at: number; verdict: string; score: number | null; model: "v1" | "v2" }
export interface TokenOutcome {
  at: number;
  verdict: string;
  score: number | null;
  settled: boolean;
  peakPct: number | null;
  lowPct: number | null;
  dumped: boolean;
  rugged: boolean;
}
export interface TokenProfile {
  id: string;
  chain: string;
  symbol: string;
  name: string | null;
  scans: number; // сколько сканов мы помним (снимки, не больше 10 на токен)
  scansCapped: boolean; // упёрлись в потолок снимков: на деле сканов могло быть больше
  firstAt: number | null;
  lastAt: number | null;
  latest: { score: number | null; verdict: string; reason: string; model: "v1" | "v2"; at: number } | null;
  timeline: TimelinePoint[]; // старые первыми
  outcome: TokenOutcome | null; // последняя запись Track Record по токену
  brain: { dev: string | null; devTokens: number | null; linked: number; wallets: number } | null;
}

const SNAP_CAP = 10;
const key = (id: string) => (id.startsWith("0x") ? id.toLowerCase() : id);

// ---------- SQLite: голоса и комментарии ----------
// Таблицы живут в той же brain.db (memDb), создаются при первом обращении. Нет SQLite: голосование выключено.
type Db = NonNullable<ReturnType<typeof memDb>>;
const host = globalThis as unknown as { __crawlhiveVotesReady?: boolean };
function vdb(): Db | null {
  const d = memDb();
  if (!d) return null;
  if (!host.__crawlhiveVotesReady) {
    d.db.exec(`
      CREATE TABLE IF NOT EXISTS token_votes (token TEXT NOT NULL, wallet TEXT NOT NULL, target TEXT NOT NULL, vote INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (token, wallet, target)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS token_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL, wallet TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS token_comments_token ON token_comments (token, at);
      CREATE INDEX IF NOT EXISTS token_comments_wallet ON token_comments (wallet, at);
    `);
    host.__crawlhiveVotesReady = true;
  }
  return d;
}

function totals(d: Db, token: string): Record<VoteTarget, VoteTotals> {
  const rows = d.db
    .prepare("SELECT target, SUM(CASE WHEN vote > 0 THEN 1 ELSE 0 END) AS up, SUM(CASE WHEN vote < 0 THEN 1 ELSE 0 END) AS down FROM token_votes WHERE token = ? GROUP BY target")
    .all(token) as unknown as { target: string; up: number; down: number }[];
  const out: Record<VoteTarget, VoteTotals> = { analysis: { up: 0, down: 0 }, token: { up: 0, down: 0 } };
  for (const r of rows) if (r.target === "analysis" || r.target === "token") out[r.target] = { up: Number(r.up), down: Number(r.down) };
  return out;
}

function myVotes(d: Db, token: string, wallet: string): Record<VoteTarget, -1 | 0 | 1> {
  const rows = d.db.prepare("SELECT target, vote FROM token_votes WHERE token = ? AND wallet = ?").all(token, wallet) as unknown as { target: string; vote: number }[];
  const out: Record<VoteTarget, -1 | 0 | 1> = { analysis: 0, token: 0 };
  for (const r of rows) if (r.target === "analysis" || r.target === "token") out[r.target] = r.vote > 0 ? 1 : -1;
  return out;
}

const comments = (d: Db, token: string) =>
  (d.db.prepare("SELECT id, wallet, text, at FROM token_comments WHERE token = ? ORDER BY at DESC LIMIT ?").all(token, COMMENTS_SHOWN) as unknown as TokenComment[]).map((c) => ({
    id: Number(c.id),
    wallet: c.wallet,
    text: c.text,
    at: Number(c.at),
  }));

const commentsToday = (d: Db, wallet: string) =>
  Number((d.db.prepare("SELECT COUNT(*) AS n FROM token_comments WHERE wallet = ? AND at > ?").get(wallet, Date.now() - DAY_MS) as { n: number }).n);

// Комментарий: обычный текст. Убираем управляющие символы и ссылки (http, www, t.me, домены), сжимаем пробелы.
// HTML не допускаем: угловые скобки выкидываем, а React всё равно экранирует текст при выводе.
const LINK_RE = /\b(?:https?:\/\/|www\.)\S+|\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|xyz|fun|app|gg|me|co|ly|sh|so|ai|link|site|top|info|club|dev|lol|cc|to|tv|live|pro|vip|world|finance|money|exchange|cash)\b(?:\/\S*)?/gi;
export function cleanComment(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(LINK_RE, "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, COMMENT_MAX);
}

// ---------- сводка ----------
const model = (m?: number): "v1" | "v2" => (m === 2 ? "v2" : "v1");

export function tokenProfile(raw: string): TokenProfile | null {
  const id = key(raw);
  const r = savedScan(id);
  const { snaps } = tokenSnapshots(id);
  const track = trackEntries().filter((e) => key(e.id) === id); // новые первыми
  if (!r && !snaps.length && !track.length) return null;

  const timeline: TimelinePoint[] = snaps.length
    ? snaps.map((s) => ({ at: s.at, verdict: s.verdict, score: s.score, model: model(s.m) }))
    : [...track].reverse().map((e) => ({ at: e.at, verdict: e.verdict, score: e.score, model: e.pv ? "v2" : "v1" }));
  const times = [...timeline.map((t) => t.at), ...track.map((e) => e.at), ...(r ? [r.scannedAt] : [])];
  const t0: TrackEntry | undefined = track[0];

  return {
    id: r?.id ?? t0?.id ?? id,
    chain: r?.chain ?? t0?.chain ?? (id.startsWith("0x") ? "robinhood" : "solana"),
    symbol: r?.symbol ?? t0?.symbol ?? "?",
    name: r?.name || t0?.name || null,
    scans: Math.max(timeline.length, r ? 1 : 0),
    scansCapped: snaps.length >= SNAP_CAP,
    firstAt: times.length ? Math.min(...times) : null,
    lastAt: times.length ? Math.max(...times) : null,
    latest: r
      ? { score: r.score, verdict: r.verdict, reason: r.reason, model: r.v1 ? "v2" : "v1", at: r.scannedAt }
      : t0
        ? { score: t0.score, verdict: t0.verdict, reason: "", model: t0.pv ? "v2" : "v1", at: t0.at }
        : null,
    timeline: timeline.slice(-SNAP_CAP),
    outcome: t0
      ? {
          at: t0.at,
          verdict: t0.verdict,
          score: t0.score,
          settled: !!t0.done,
          peakPct: t0.peakPct ?? null,
          lowPct: t0.lowPct ?? null,
          dumped: track.some((e) => e.dumped),
          rugged: track.some((e) => e.rugged),
        }
      : null,
    brain: brainOf(id, r?.dev?.creator ?? null),
  };
}

// Что помнит рой: кто выпустил (из launches или роли dev), сколько у него токенов в памяти, сколько связанных
// кошельков (группы оператора) и всего кошельков с ролями в этом токене. Только индексные запросы, без сети.
function brainOf(token: string, devFromScan: string | null) {
  const d = memDb();
  if (!d) return null;
  try {
    const dev =
      launchOf(d, token)?.deployer ??
      devFromScan ??
      ((d.db.prepare("SELECT wallet FROM wallet_roles WHERE token = ? AND role = 'dev' LIMIT 1").get(token) as { wallet: string } | undefined)?.wallet ?? null);
    const linked = Number((d.db.prepare("SELECT COUNT(DISTINCT wallet) AS n FROM op_members WHERE token = ?").get(token) as { n: number }).n);
    const wallets = Number((d.db.prepare("SELECT COUNT(*) AS n FROM wallet_roles WHERE token = ?").get(token) as { n: number }).n);
    const devTokens = dev ? Number((d.db.prepare("SELECT COUNT(*) AS n FROM wallet_roles WHERE wallet = ? AND role = 'dev'").get(dev) as { n: number }).n) : null;
    return { dev, devTokens: devTokens || null, linked, wallets };
  } catch {
    return null;
  }
}

// Публичный ответ: сводка, итоги голосов, последние комментарии и, если смотрит вошедший кошелёк, его голоса.
export function tokenSummary(raw: string, viewer: string | null) {
  const profile = tokenProfile(raw);
  if (!profile) throw new ApiError("This token has not been scanned yet", 404);
  const d = vdb();
  const id = key(raw);
  return {
    profile,
    votes: d ? totals(d, id) : { analysis: { up: 0, down: 0 }, token: { up: 0, down: 0 } },
    comments: d ? comments(d, id) : [],
    mine: d && viewer ? { votes: myVotes(d, id, viewer), commentsLeft: Math.max(0, COMMENTS_PER_DAY - commentsToday(d, viewer)) } : null,
    voting: !!d,
    advisory: "Community votes are advisory only and do not change the score or verdict.",
  };
}

export interface VoteInput { analysis?: number; token?: number; comment?: string }
const asVote = (v: unknown): -1 | 0 | 1 | undefined => (v === 1 || v === -1 || v === 0 ? v : undefined);

// Голос держателя. vote 1/-1 ставит или меняет голос, 0 снимает. Комментарий необязателен, 5 в сутки на кошелёк.
export async function castVote(wallet: string, raw: string, input: VoteInput) {
  const d = vdb();
  if (!d) throw new ApiError("Voting is unavailable right now", 503);
  const id = key(raw);
  if (!tokenProfile(id)) throw new ApiError("This token has not been scanned yet", 404);
  // Каждый голос проверяет баланс по RPC: держим частоту разумной.
  if (!allowHit(`tvote:${wallet}`, 30, 10 * 60_000)) throw new ApiError("Too many votes, try again in a few minutes", 429);
  const { tier } = await tierOf(wallet);
  if (!tierAtLeast(tier, VOTE_TIER)) throw new ApiError("Only Holder tier and up can vote", 403);

  const a = asVote(input.analysis);
  const t = asVote(input.token);
  const text = input.comment === undefined ? "" : cleanComment(input.comment);
  if (input.comment !== undefined && typeof input.comment === "string" && input.comment.trim() && !text)
    throw new ApiError("Comment is empty after removing links");
  if (a === undefined && t === undefined && !text) throw new ApiError("Nothing to save");
  if (text && commentsToday(d, wallet) >= COMMENTS_PER_DAY) throw new ApiError(`Limit is ${COMMENTS_PER_DAY} comments per day`, 429);

  const now = Date.now();
  const set = d.db.prepare("INSERT INTO token_votes (token, wallet, target, vote, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (token, wallet, target) DO UPDATE SET vote = excluded.vote, at = excluded.at");
  const unset = d.db.prepare("DELETE FROM token_votes WHERE token = ? AND wallet = ? AND target = ?");
  d.db.exec("BEGIN");
  try {
    for (const [target, v] of [["analysis", a], ["token", t]] as const) {
      if (v === undefined) continue;
      if (v === 0) unset.run(id, wallet, target);
      else set.run(id, wallet, target, v, now);
    }
    if (text) d.db.prepare("INSERT INTO token_comments (token, wallet, text, at) VALUES (?, ?, ?, ?)").run(id, wallet, text, now);
    d.db.exec("COMMIT");
  } catch (e) {
    d.db.exec("ROLLBACK");
    throw e;
  }
  return tokenSummary(id, wallet);
}
