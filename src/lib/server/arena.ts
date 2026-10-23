// Crawler Arena: ежедневные раунды, где личные бумажные стратегии холдеров (Strategy builder) соревнуются вживую.
// Раунд: 00:00-24:00 UTC (ARENA_KIND, недельный тоже поддержан). Вход: холдер выбирает свою стратегию, запись
// закрывается через ENTRY_WINDOW_MS после старта, одна заявка на кошелёк за раунд, не больше MAX_ENTRIES заявок.
// Заморозка: при входе снимок конфига кладётся в arena_entries, движок (paper-engine.ts) гоняет его как отдельную
// стратегию a<id заявки>. Правка или удаление исходной u-стратегии заявку не трогают, а счёт заявки не смешивается
// с позициями, открытыми исходной стратегией до раунда. Счёт: реализованный P&L сделок копии плюс открытые позиции
// по последнему замеру; при равенстве выше тот, у кого меньше сделок, потом кто вошёл раньше.
// Итоги: после конца раунда (таймер раз в минуту и каждый GET) счёт замораживается, копии убираются из движка,
// их позиции закрываются по рынку с причиной «removed» уже вне зачёта. Победитель получает значок чемпиона и перк
// продукта (+Ask в сутки, referrals.ts). Никаких денег, ставок и выплат токенами: только бумага.
// Публичность: имя, короткий адрес владельца и правила без чисел видны всем, пока раунд идёт; полный конфиг
// раскрывается после подведения итогов. События копий приходят только сюда (onArenaPaperEvent), не в tg-signals.
import "server-only";
import { ApiError, getMeta } from "./store";
import { TIER_LIMITS, tierOf } from "./tiers";
import { arenaLive, arenaStrategyId, invalidateUserStrategies, onArenaPaperEvent, paperDb, paperEnabled, type ArenaEntryRow, type ArenaLive, type ExitReason, type PaperEvent } from "./paper-engine";
import { arenaPerkUntil, ARENA_ASK, ARENA_DAYS, grantArenaPerk } from "./referrals";
import { describeUserConfig, normalizeUserConfig, teaseUserConfig, userConfigError, USER_SIZE_USD, type UserStrategyConfig } from "../user-strategy-config";

export type ArenaKind = "daily" | "weekly";
export const ARENA_KIND: ArenaKind = "daily";
export const ENTRY_WINDOW_MS = 2 * 3600_000; // запись закрыта через 2 часа после старта: поздние копировщики не влезут
export const MAX_ENTRIES = 100;
export const MIN_ENTRIES_FOR_CHAMPION = 2; // в одиночку чемпионом не стать
const CACHE_MS = 5_000;
const SETTLE_EVERY_MS = 60_000;
const EVENTS_KEEP_MS = 30 * 86400_000;
const FEED_LIMIT = 40;
const PAST_ROUNDS = 7;
const NOTE_MAX = 200;
// Цвета краулеров на дорожке: первый свободный в раунде, дальше по кругу.
export const ARENA_COLORS = ["#ffb020", "#a3e635", "#38bdf8", "#f472b6", "#a78bfa", "#2dd4bf", "#fb7185", "#facc15", "#60a5fa", "#4ade80", "#f97316", "#e879f9", "#22d3ee", "#c084fc", "#fde047", "#34d399"];

const DAY = 86400_000;
const short = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);

// ---------- раунды ----------

export interface ArenaRound {
  id: string;
  kind: ArenaKind;
  startAt: number;
  endAt: number;
  entryCloseAt: number;
}

// Раунд, в который попадает момент t. Дневной: d-ГГГГ-ММ-ДД, недельный: w-<дата понедельника>.
export function roundAt(t: number, kind: ArenaKind = ARENA_KIND): ArenaRound {
  const day = Math.floor(t / DAY) * DAY;
  if (kind === "weekly") {
    const start = day - ((new Date(day).getUTCDay() + 6) % 7) * DAY;
    return { id: `w-${ymd(start)}`, kind, startAt: start, endAt: start + 7 * DAY, entryCloseAt: start + ENTRY_WINDOW_MS };
  }
  return { id: `d-${ymd(day)}`, kind, startAt: day, endAt: day + DAY, entryCloseAt: day + ENTRY_WINDOW_MS };
}

// ---------- база ----------

type Db = NonNullable<ReturnType<typeof paperDb>>;
const host = globalThis as unknown as {
  __crawlhiveArenaDb?: boolean;
  __crawlhiveArena?: { started: boolean; settling: boolean; subs: Set<(e: ArenaFeedEvent) => void>; cache: { at: number; data: ArenaData } | null };
};
const st = () => (host.__crawlhiveArena ??= { started: false, settling: false, subs: new Set(), cache: null });

function db(): Db | null {
  const d = paperDb(); // таблица arena_entries создаётся движком вместе с остальными
  if (!d) return null;
  if (!host.__crawlhiveArenaDb) {
    d.exec(`
      CREATE TABLE IF NOT EXISTS arena_rounds (id TEXT PRIMARY KEY, kind TEXT NOT NULL, start_at INTEGER NOT NULL, end_at INTEGER NOT NULL,
        entry_close_at INTEGER NOT NULL, prize_note TEXT, settled_at INTEGER, winner INTEGER, entries INTEGER) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS arena_rounds_settled ON arena_rounds (settled_at, start_at);
      CREATE TABLE IF NOT EXISTS arena_events (id INTEGER PRIMARY KEY AUTOINCREMENT, round TEXT NOT NULL, entry INTEGER NOT NULL, kind TEXT NOT NULL,
        symbol TEXT, token TEXT, chain TEXT, reason TEXT, net_pct REAL, pnl REAL, at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS arena_events_round ON arena_events (round, id);
    `);
    host.__crawlhiveArenaDb = true;
  }
  return d;
}
function need(): Db {
  const d = db();
  if (!d) throw new ApiError("Crawler Arena is unavailable right now, try again later", 503);
  return d;
}

function ensureRound(d: Db, r: ArenaRound) {
  d.prepare("INSERT OR IGNORE INTO arena_rounds (id, kind, start_at, end_at, entry_close_at) VALUES (?, ?, ?, ?, ?)").run(r.id, r.kind, r.startAt, r.endAt, r.entryCloseAt);
}

const configOf = (row: Pick<ArenaEntryRow, "config">): UserStrategyConfig => {
  try {
    return normalizeUserConfig(JSON.parse(row.config));
  } catch {
    return normalizeUserConfig({});
  }
};
const entryIdOf = (strategy: string) => (/^a(\d+)$/.exec(strategy) ? Number(strategy.slice(1)) : null);

// ---------- события: лента и SSE ----------

export interface ArenaFeedEvent {
  id: number;
  entry: number;
  name: string;
  color: string;
  kind: "join" | "open" | "close";
  symbol: string | null;
  token: string | null;
  chain: string | null;
  reason: ExitReason | null;
  netPct: number | null;
  pnl: number | null;
  at: number;
}

interface EventRow {
  id: number;
  round: string;
  entry: number;
  kind: ArenaFeedEvent["kind"];
  symbol: string | null;
  token: string | null;
  chain: string | null;
  reason: ExitReason | null;
  net_pct: number | null;
  pnl: number | null;
  at: number;
}

function pushEvent(d: Db, e: ArenaEntryRow, ev: Omit<EventRow, "id" | "round" | "entry">) {
  const r = d
    .prepare("INSERT INTO arena_events (round, entry, kind, symbol, token, chain, reason, net_pct, pnl, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(e.round, e.id, ev.kind, ev.symbol, ev.token, ev.chain, ev.reason, ev.net_pct, ev.pnl, ev.at);
  const out: ArenaFeedEvent = { id: Number(r.lastInsertRowid), entry: e.id, name: e.name, color: e.color, kind: ev.kind, symbol: ev.symbol, token: ev.token, chain: ev.chain, reason: ev.reason, netPct: ev.net_pct, pnl: ev.pnl, at: ev.at };
  st().cache = null;
  for (const fn of st().subs) {
    try {
      fn(out);
    } catch {
      // отвалившийся подписчик снимет себя сам
    }
  }
}

// Событие позиции копии из движка. Закрытия после подведения итогов (причина removed) в ленту не идут: они вне зачёта.
function onEngineEvent(e: PaperEvent) {
  const id = entryIdOf(e.strategy);
  const d = db();
  if (id === null || !d) return;
  const row = d.prepare("SELECT * FROM arena_entries WHERE id = ?").get(id) as unknown as ArenaEntryRow | undefined;
  if (!row || row.settled_at) return;
  if (e.kind === "open") pushEvent(d, row, { kind: "open", symbol: e.symbol, token: e.token, chain: e.chain, reason: null, net_pct: null, pnl: null, at: e.at });
  else pushEvent(d, row, { kind: "close", symbol: e.symbol, token: e.token, chain: e.chain, reason: e.reason, net_pct: e.netPct, pnl: e.pnl, at: e.at });
}

// SSE /api/arena/stream: подписка на события текущих заявок.
export function subscribeArena(fn: (e: ArenaFeedEvent) => void) {
  st().subs.add(fn);
  return () => void st().subs.delete(fn);
}

// ---------- счёт и итоги ----------

interface Scored {
  row: ArenaEntryRow;
  pnl: number;
  realized: number;
  unrealized: number;
  trades: number;
  closed: number;
  wins: number;
  open: number;
  pending: number;
  last: ArenaLive["last"];
}

// Порядок: больше P&L выше, при равенстве меньше сделок, потом кто вошёл раньше.
function score(rows: ArenaEntryRow[]): Scored[] {
  const live = arenaLive(rows.map((r) => arenaStrategyId(r.id)));
  return rows
    .map((row) => {
      const a = live.get(arenaStrategyId(row.id));
      return {
        row,
        pnl: a?.pnl ?? 0,
        realized: a?.realized ?? 0,
        unrealized: a?.unrealized ?? 0,
        trades: (a?.closed ?? 0) + (a?.open ?? 0),
        closed: a?.closed ?? 0,
        wins: a?.wins ?? 0,
        open: a?.open ?? 0,
        pending: a?.pending ?? 0,
        last: a?.last ?? null,
      };
    })
    .sort((x, y) => y.pnl - x.pnl || x.trades - y.trades || x.row.created_at - y.row.created_at);
}

// Подводит итоги одного раунда: счёт замораживается в заявках, копии уходят из движка, победителю перк.
function settleRound(d: Db, round: string, now: number) {
  const rows = d.prepare("SELECT * FROM arena_entries WHERE round = ? AND settled_at IS NULL ORDER BY id").all(round) as unknown as ArenaEntryRow[];
  if (!rows.length) return;
  // Счёт до invalidate: у быстрых копий markPnl берёт доплату проскальзывания из ещё живого конфига.
  const ranked = score(rows);
  const all = (d.prepare("SELECT COUNT(*) AS n FROM arena_entries WHERE round = ?").get(round) as { n: number }).n;
  const top = ranked[0];
  const winner = top && all >= MIN_ENTRIES_FOR_CHAMPION && top.pnl > 0 && top.trades > 0 ? top : null;
  const r = roundAt(rows[0].start_at, round.startsWith("w-") ? "weekly" : "daily");
  d.exec("BEGIN");
  try {
    ensureRound(d, r);
    const upd = d.prepare("UPDATE arena_entries SET settled_at = ?, final_pnl = ?, final_trades = ?, final_open = ?, rank = ? WHERE id = ?");
    ranked.forEach((x, i) => upd.run(now, x.pnl, x.trades, x.open, i + 1, x.row.id));
    d.prepare("UPDATE arena_rounds SET settled_at = ?, winner = ?, entries = ? WHERE id = ?").run(now, winner ? winner.row.id : null, all, round);
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
  invalidateUserStrategies();
  st().cache = null;
  console.log(`[arena] round ${round} settled: ${ranked.length} entries, ${winner ? `winner a${winner.row.id} ${winner.row.owner.slice(0, 6)} ${winner.pnl >= 0 ? "+" : ""}$${winner.pnl}` : "no champion"}`);
  if (winner) {
    grantArenaPerk(winner.row.owner, round, now);
    // Поздравление в личку, если кошелёк привязан к боту. Ничего не бросает.
    const chat = getMeta(`tg:${winner.row.owner}`);
    if (chat)
      void import("./telegram")
        .then(({ send, esc, siteUrl }) =>
          send(chat, `🏆 <b>${esc(winner.row.name)}</b> won today's Crawler Arena with ${winner.pnl >= 0 ? "+" : "-"}$${Math.abs(winner.pnl).toFixed(2)} of paper P&L.\nYour champion perk: +${ARENA_ASK} Ask questions a day for ${ARENA_DAYS} days.\n${siteUrl()}/arena`),
        )
        .catch(() => {});
  }
}

// Все раунды, чьё время вышло, а итоги не подведены (сервер мог лежать в полночь).
export function settleDue(now = Date.now()) {
  const s = st();
  const d = db();
  if (!d || s.settling) return;
  s.settling = true;
  try {
    const due = d.prepare("SELECT DISTINCT round FROM arena_entries WHERE settled_at IS NULL AND end_at <= ?").all(now) as { round: string }[];
    for (const x of due) {
      try {
        settleRound(d, x.round, now);
      } catch (e) {
        console.warn("[arena] settle", x.round, (e as Error).message);
      }
    }
    if (due.length) d.prepare("DELETE FROM arena_events WHERE at < ?").run(now - EVENTS_KEEP_MS);
  } finally {
    s.settling = false;
  }
}

export function startArena() {
  const s = st();
  if (s.started) return;
  s.started = true;
  onArenaPaperEvent((e) => {
    try {
      onEngineEvent(e);
    } catch (err) {
      console.warn("[arena] event", (err as Error).message);
    }
  });
  setInterval(() => {
    try {
      settleDue();
    } catch (e) {
      console.warn("[arena] settle", (e as Error).message);
    }
  }, SETTLE_EVERY_MS).unref?.();
  console.log("[arena] started");
}

// ---------- публичные данные ----------

const feedOf = (d: Db, where: string, ...args: (string | number)[]): ArenaFeedEvent[] =>
  (
    d
      .prepare(`SELECT ev.*, e.name AS name, e.color AS color FROM arena_events ev JOIN arena_entries e ON e.id = ev.entry WHERE ${where} ORDER BY ev.id DESC LIMIT ${FEED_LIMIT}`)
      .all(...args) as unknown as (EventRow & { name: string; color: string })[]
  ).map((x) => ({ id: x.id, entry: x.entry, name: x.name, color: x.color, kind: x.kind, symbol: x.symbol, token: x.token, chain: x.chain, reason: x.reason, netPct: x.net_pct, pnl: x.pnl, at: x.at }));

// Сколько раундов выиграл каждый владелец: значок «Arena champion».
function championCounts(d: Db, owners: string[]) {
  const out = new Map<string, number>();
  if (!owners.length) return out;
  const q = owners.map(() => "?").join(",");
  const rows = d
    .prepare(`SELECT e.owner AS owner, COUNT(*) AS n FROM arena_rounds r JOIN arena_entries e ON e.id = r.winner WHERE e.owner IN (${q}) GROUP BY e.owner`)
    .all(...owners) as { owner: string; n: number }[];
  for (const r of rows) out.set(r.owner, r.n);
  return out;
}

interface RoundRow {
  id: string;
  kind: ArenaKind;
  start_at: number;
  end_at: number;
  entry_close_at: number;
  prize_note: string | null;
  settled_at: number | null;
  winner: number | null;
  entries: number | null;
}

function compute(now: number) {
  const d = db();
  const r = roundAt(now);
  const base = {
    now,
    enabled: paperEnabled(),
    rules: { sizeUsd: USER_SIZE_USD, entryWindowMin: ENTRY_WINDOW_MS / 60_000, maxEntries: MAX_ENTRIES, minEntriesForChampion: MIN_ENTRIES_FOR_CHAMPION, perk: { ask: ARENA_ASK, days: ARENA_DAYS }, kind: ARENA_KIND },
  };
  const round = { ...r, entriesOpen: now < r.entryCloseAt, prizeNote: null as string | null };
  if (!d) return { ...base, round, entries: [], events: [] as ArenaFeedEvent[], past: [] };
  ensureRound(d, r);
  round.prizeNote = (d.prepare("SELECT prize_note FROM arena_rounds WHERE id = ?").get(r.id) as { prize_note: string | null } | undefined)?.prize_note ?? null;
  const rows = d.prepare("SELECT * FROM arena_entries WHERE round = ? ORDER BY id").all(r.id) as unknown as ArenaEntryRow[];
  const ranked = score(rows);
  const pastRounds = d.prepare("SELECT * FROM arena_rounds WHERE settled_at IS NOT NULL ORDER BY start_at DESC LIMIT ?").all(PAST_ROUNDS) as unknown as RoundRow[];
  const pastEntries = pastRounds.length
    ? (d.prepare(`SELECT * FROM arena_entries WHERE round IN (${pastRounds.map(() => "?").join(",")}) AND rank <= 3 ORDER BY rank`).all(...pastRounds.map((x) => x.id)) as unknown as ArenaEntryRow[])
    : [];
  const champs = championCounts(d, [...new Set([...rows, ...pastEntries].map((x) => x.owner))]);
  const entries = ranked.map((x, i) => ({
    id: x.row.id,
    rank: i + 1,
    name: x.row.name,
    owner: short(x.row.owner),
    color: x.row.color,
    // Пока раунд идёт, правила без чисел; полный конфиг откроется после итогов (past).
    rules: teaseUserConfig(configOf(x.row)),
    pnl: x.pnl,
    realized: x.realized,
    unrealized: x.unrealized,
    trades: x.trades,
    closed: x.closed,
    wins: x.wins,
    open: x.open,
    pending: x.pending,
    last: x.last,
    joinedAt: x.row.created_at,
    champion: champs.get(x.row.owner) ?? 0,
  }));
  const past = pastRounds.map((pr) => {
    const top = pastEntries
      .filter((e) => e.round === pr.id)
      .map((e) => {
        const c = configOf(e);
        return { id: e.id, rank: e.rank ?? 0, name: e.name, owner: short(e.owner), color: e.color, pnl: e.final_pnl ?? 0, trades: e.final_trades ?? 0, rules: describeUserConfig(c), config: c, champion: champs.get(e.owner) ?? 0 };
      });
    return { id: pr.id, kind: pr.kind, startAt: pr.start_at, endAt: pr.end_at, entries: pr.entries ?? top.length, prizeNote: pr.prize_note, winner: top.find((e) => e.id === pr.winner) ?? null, top };
  });
  return { ...base, round, entries, events: feedOf(d, "ev.round = ?", r.id), past };
}
export type ArenaData = ReturnType<typeof compute>;

// Кэш CACHE_MS: страница и SSE-перечитывания дёргают часто, а счёт двигается раз в минуту (быстрые раз в 10 с).
export function arenaState(): ArenaData {
  const s = st();
  const now = Date.now();
  if (s.cache && now - s.cache.at < CACHE_MS) return s.cache.data;
  try {
    settleDue(now);
  } catch (e) {
    console.warn("[arena] settle", (e as Error).message);
  }
  s.cache = { at: now, data: compute(now) };
  return s.cache.data;
}

// Часть для вошедшего: его заявка в текущем раунде, может ли войти, перк чемпиона.
export async function arenaMe(owner: string) {
  const now = Date.now();
  const r = roundAt(now);
  const d = db();
  const row = d ? (d.prepare("SELECT id, name, color FROM arena_entries WHERE round = ? AND owner = ?").get(r.id, owner) as { id: number; name: string; color: string } | undefined) : undefined;
  const { tier } = await tierOf(owner);
  const holder = TIER_LIMITS[tier].strategies > 0;
  return { wallet: owner, tier, holder, entry: row ?? null, canEnter: holder && !row && now < r.entryCloseAt, perkUntil: arenaPerkUntil(owner) };
}

export type ArenaMe = Awaited<ReturnType<typeof arenaMe>>;

// ---------- вход ----------

export async function enterArena(owner: string, rawId: unknown) {
  const d = need();
  if (!paperEnabled()) throw new ApiError("The paper engine is paused right now, try again later", 503);
  const now = Date.now();
  const r = roundAt(now);
  if (now >= r.entryCloseAt) throw new ApiError(`Entries for this round closed ${ENTRY_WINDOW_MS / 3600_000}h after the start. The next round opens at 00:00 UTC`, 400);
  const { tier } = await tierOf(owner);
  if (TIER_LIMITS[tier].strategies === 0) throw new ApiError("Crawler Arena entries are for $CRAWLHIVE holders. Watching is free. See crawlhive.xyz/pricing", 402);
  const m = /^u(\d{1,12})$/.exec(String(rawId ?? "").trim());
  const src = m ? (d.prepare("SELECT * FROM user_strategies WHERE id = ? AND owner = ?").get(Number(m[1]), owner) as unknown as { id: number; name: string; config: string } | undefined) : undefined;
  if (!src) throw new ApiError("Strategy not found", 404);
  const config = configOf(src);
  const err = userConfigError(config);
  if (err) throw new ApiError(err, 400);
  ensureRound(d, r);
  const mine = d.prepare("SELECT name FROM arena_entries WHERE round = ? AND owner = ?").get(r.id, owner) as { name: string } | undefined;
  if (mine) throw new ApiError(`You are already in this round with ${mine.name}. One entry per wallet per round`, 400);
  const taken = d.prepare("SELECT color FROM arena_entries WHERE round = ?").all(r.id) as { color: string }[];
  if (taken.length >= MAX_ENTRIES) throw new ApiError(`This round is full: ${MAX_ENTRIES} crawlers already race`, 400);
  const used = new Set(taken.map((x) => x.color));
  const color = ARENA_COLORS.find((c) => !used.has(c)) ?? ARENA_COLORS[taken.length % ARENA_COLORS.length];
  let id: number;
  try {
    // Снимок: нормализованный конфиг на сейчас. Дальше заявка живёт отдельно от исходной стратегии.
    const res = d
      .prepare("INSERT INTO arena_entries (round, owner, source, name, config, color, start_at, end_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(r.id, owner, `u${src.id}`, src.name, JSON.stringify(config), color, r.startAt, r.endAt, now);
    id = Number(res.lastInsertRowid);
  } catch {
    // параллельный вход того же кошелька упёрся в уникальный индекс
    throw new ApiError("You are already in this round. One entry per wallet per round", 400);
  }
  invalidateUserStrategies();
  const row = d.prepare("SELECT * FROM arena_entries WHERE id = ?").get(id) as unknown as ArenaEntryRow;
  pushEvent(d, row, { kind: "join", symbol: null, token: null, chain: null, reason: null, net_pct: null, pnl: null, at: now });
  console.log(`[arena] ${owner.slice(0, 6)} entered ${r.id} with u${src.id} as a${id}`);
  return { id, name: row.name, color, round: r.id };
}

// ---------- заметка о призе (админ) ----------
// Только текст на странице («победитель получит мерч» и т.п.). Никакой автоматики выплат здесь нет.
export function setPrizeNote(raw: unknown) {
  const d = need();
  const r = roundAt(Date.now());
  ensureRound(d, r);
  const note =
    String(raw ?? "")
      .replace(/[<>\u2013\u2014]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, NOTE_MAX) || null;
  d.prepare("UPDATE arena_rounds SET prize_note = ? WHERE id = ?").run(note, r.id);
  st().cache = null;
  return { round: r.id, prizeNote: note };
}

// ---------- Telegram: /arena ----------

export async function tgArena(chat: string) {
  const { send, esc, siteUrl } = await import("./telegram");
  const a = arenaState();
  const left = Math.max(0, a.round.endAt - a.now);
  const h = Math.floor(left / 3600_000);
  const mm = Math.floor((left % 3600_000) / 60_000);
  const money = (n: number) => `${n >= 0 ? "+" : "-"}$${Math.abs(n).toFixed(2)}`;
  const top = a.entries.slice(0, 3).map((e, i) => `${["🥇", "🥈", "🥉"][i]} <b>${esc(e.name)}</b> ${money(e.pnl)} · ${e.trades} trades`);
  send(
    chat,
    [
      "🐙 <b>Crawler Arena</b>",
      `Today's round ends in ${h}h ${mm}m, ${a.entries.length} crawler${a.entries.length === 1 ? "" : "s"} racing on paper.`,
      "",
      ...(top.length ? top : ["No crawlers in this round yet."]),
      "",
      `${a.round.entriesOpen ? "Entries are open for holders. " : ""}Watch live: ${siteUrl()}/arena`,
      "Paper money only. No real trades, no betting.",
    ].join("\n"),
  );
}
