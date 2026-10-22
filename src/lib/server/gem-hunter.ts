// Gem Hunter: ежедневная игра для держателей $CRAWLHIVE. Держатель (тариф Holder и выше, tiers.ts) сканирует монету,
// наш публичный вердикт CLEAN или OK, капитализация на момент скана от $25k: скан засчитывается. Монета за игровой
// день (UTC) достаётся первому игроку, который её отсканировал; не больше 20 засчитанных сканов на игрока в день.
// Через 24 часа скан закрывается по ценам DexScreener так же, как Track Record (track.ts): цена из самой ликвидной
// пары токена, ликвидность суммой по всем парам, так что миграция с кривой pump.fun и переезд в другой пул не теряются;
// руг: по тем же правилам. Очки дня суммируются, победитель дня сохраняется.
// Приз отправляет команда вручную из казны: у сервера нет ключей казны, здесь нет ни выплат, ни подписей. Админ только
// вписывает подпись транзакции, чтобы её было видно на странице.
//
// Пик или закрытие. Очки считаем по ПИКУ за сутки, а не по цене через 24 часа: игра награждает умение найти монету
// рано, а не угадать минуту продажи; закрытие через сутки для мемкоинов почти шум (та же монета за час до или после
// дала бы другой результат). Чтобы пик нельзя было нарисовать одной свечой или одним кривым ответом DexScreener, пик
// подтверждённый: берём минимум из двух замеров подряд (раз в 10 минут), то есть цена держалась на этом уровне
// хотя бы между двумя замерами. Первый замер подтверждается ценой скана, поэтому скачок сразу после скана сам по себе
// не считается. Руг перекрывает всё (-3, даже если до этого был пик). Без очков за пик монета, упавшая к закрытию на
// 50% и больше, даёт -1. Пик больше ×50 почти всегда ошибка цены на момент скана (как в Replay, track.ts): такой скан
// аннулируется с нулём очков.
import "server-only";
import { memDb } from "./memory-db";
import { ApiError, metaEntries } from "./store";
import { bestPairs, tokenPairs, type PairInfo } from "./crawl/dexscreener";
import { TOKEN } from "@/lib/token";
import type { ScanResult } from "./scan";

// ---------- правила ----------
export const HUNT = {
  minMcap: 25_000,
  dailyCap: 20,
  windowHours: 24,
  tiers: [
    { mult: 25, points: 5 },
    { mult: 10, points: 4 },
    { mult: 5, points: 3 },
    { mult: 3, points: 2 },
    { mult: 2, points: 1 },
  ],
  rugPoints: -3,
  dumpPoints: -1,
  dumpPct: -50,
  maxSaneMult: 50,
};

const DAY_MS = 86_400_000;
const WINDOW_MS = HUNT.windowHours * 3600_000;
const SAMPLE_MS = 10 * 60_000;
const TICK_MS = 60_000;
const GIVE_UP_MS = WINDOW_MS + 2 * 3600_000; // замеры не идут больше 26 часов: закрываем по последнему известному
const CLAIM_TTL_MS = 10 * 60_000; // скан на сайте можно засчитать в течение 10 минут после результата
const RUG_LIQ = 0.2; // как в track.ts
const RUG_CONFIRM = 2;
const DEAD_LIQ = 500;
const DEEP_PER_TICK = 20; // перепроверок по всем парам за тик (лимит DexScreener 300 запросов в минуту делим с другими)
const CHAINS = ["solana", "robinhood", "bsc", "base"];

export type HuntOutcome = "open" | "rug" | "gem" | "dump" | "flat" | "void";

interface HuntRow {
  id: number;
  day: string;
  coin: string;
  chain: string;
  symbol: string;
  wallet: string;
  src: string;
  verdict: string;
  score: number | null;
  at: number;
  price0: number;
  liq0: number;
  fdv0: number;
  peak_pct: number | null;
  peak_at: number | null;
  low_pct: number | null;
  last_pct: number | null;
  liq_now: number | null;
  pair: string | null;
  sampled_at: number | null;
  missing: number;
  rug_hits: number;
  rugged: number;
  settled: number;
  points: number;
  outcome: HuntOutcome;
  settled_at: number | null;
}

interface WinnerRow {
  day: string;
  wallet: string | null;
  points: number;
  hunts: number;
  decided_at: number;
  tx: string | null;
  tx_at: number | null;
}

const host = globalThis as unknown as { __crawlhiveHuntDb?: boolean; __crawlhiveHunt?: { started?: boolean; busy?: boolean; lastTick?: number }; __crawlhiveHuntClaims?: Map<string, Claim> };
const st = () => (host.__crawlhiveHunt ??= {});

function db() {
  const d = memDb();
  if (!d) return null;
  if (!host.__crawlhiveHuntDb) {
    d.db.exec(`
      CREATE TABLE IF NOT EXISTS hunt_scans (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, coin TEXT NOT NULL, chain TEXT NOT NULL,
        symbol TEXT NOT NULL, wallet TEXT NOT NULL, src TEXT NOT NULL, verdict TEXT NOT NULL, score INTEGER, at INTEGER NOT NULL,
        price0 REAL NOT NULL, liq0 REAL NOT NULL, fdv0 REAL NOT NULL, peak_pct REAL, peak_at INTEGER, low_pct REAL, last_pct REAL,
        liq_now REAL, pair TEXT, sampled_at INTEGER, missing INTEGER NOT NULL DEFAULT 0, rug_hits INTEGER NOT NULL DEFAULT 0,
        rugged INTEGER NOT NULL DEFAULT 0, settled INTEGER NOT NULL DEFAULT 0, points INTEGER NOT NULL DEFAULT 0,
        outcome TEXT NOT NULL DEFAULT 'open', settled_at INTEGER);
      -- Одна монета за день: одному игроку: первый скан забирает её, остальные получают отказ.
      CREATE UNIQUE INDEX IF NOT EXISTS hunt_scans_day_coin ON hunt_scans (day, coin);
      CREATE INDEX IF NOT EXISTS hunt_scans_wallet ON hunt_scans (wallet, day);
      CREATE INDEX IF NOT EXISTS hunt_scans_open ON hunt_scans (settled, sampled_at);
      CREATE TABLE IF NOT EXISTS hunt_winners (day TEXT PRIMARY KEY, wallet TEXT, points INTEGER NOT NULL, hunts INTEGER NOT NULL,
        decided_at INTEGER NOT NULL, tx TEXT, tx_at INTEGER) WITHOUT ROWID;
    `);
    host.__crawlhiveHuntDb = true;
  }
  return d.db;
}

export const huntDay = (ts = Date.now()) => new Date(ts).toISOString().slice(0, 10);
const dayStart = (day: string) => Date.parse(`${day}T00:00:00Z`);
// Адреса EVM храним в нижнем регистре, чтобы «одна монета в день» не обходилась сменой регистра.
const coinKey = (id: string) => (id.startsWith("0x") ? id.toLowerCase() : id);

// ---------- приём скана ----------

interface Claim {
  coin: string;
  chain: string;
  symbol: string;
  verdict: string;
  score: number | null;
  price0: number;
  liq0: number;
  fdv0: number;
  at: number;
}

export interface HuntCredit {
  counted: boolean;
  reason?: string;
  day?: string;
  left?: number;
}

const claims = () => (host.__crawlhiveHuntClaims ??= new Map());

// Подходит ли скан под правила, без учёта игрока. Возвращает снимок рынка или причину отказа.
function snapshotOf(r: ScanResult): Claim | string {
  if (r.verdict !== "CLEAN" && r.verdict !== "OK") return "Only CLEAN or OK verdicts count";
  if (!CHAINS.includes(r.chain)) return "This chain is not tracked yet";
  if (coinKey(r.id) === coinKey(TOKEN.mint)) return `$${TOKEN.symbol} itself does not count`;
  const price0 = Number(r.market?.priceUsd);
  const liq0 = Number(r.market?.liquidityUsd);
  const fdv0 = Number(r.market?.fdv);
  if (!(price0 > 0) || !(liq0 > 0)) return "No live market price at scan time";
  if (!(fdv0 >= HUNT.minMcap)) return `Market cap under $${HUNT.minMcap / 1000}k at scan time`;
  return { coin: coinKey(r.id), chain: r.chain, symbol: r.symbol, verdict: r.verdict, score: r.score, price0, liq0, fdv0, at: Date.now() };
}

// Зовётся там, где готов результат скана. Сайт и мини-апп сканируют через EventSource без заголовков, поэтому кошелёк
// там неизвестен: скан запоминается по IP на 10 минут, а клиент сразу после результата подтверждает его запросом
// с сессией (gemHunterClaim). Бот передаёт чат Telegram, кошелёк берём из привязки «Connect Telegram».
export function gemHunterOnScan(r: ScanResult, who: { wallet?: string | null; tgChat?: string; ip?: string }): void {
  try {
    if (!db()) return;
    const snap = snapshotOf(r);
    if (typeof snap === "string") return;
    if (who.wallet) {
      void credit(who.wallet, snap, "web").catch((e) => console.warn("[hunt]", (e as Error).message));
      return;
    }
    if (who.tgChat && !who.tgChat.startsWith("-")) {
      const wallets = metaEntries("tg:").filter(([, chat]) => chat === who.tgChat).map(([k]) => k.slice(3));
      void creditFirst(wallets, snap, "telegram").catch((e) => console.warn("[hunt]", (e as Error).message));
      return;
    }
    if (who.ip) {
      const m = claims();
      const now = Date.now();
      if (m.size > 5000) for (const [k, c] of m) if (now - c.at > CLAIM_TTL_MS) m.delete(k);
      if (m.size > 5000) m.clear();
      m.set(`${who.ip}|${snap.coin}`, snap);
    }
  } catch (e) {
    console.warn("[hunt]", (e as Error).message);
  }
}

// Подтверждение скана с сайта или из мини-аппа: скан этой монеты с того же IP за последние 10 минут.
export async function gemHunterClaim(wallets: string[], ip: string, coin: string, src: "web" | "telegram"): Promise<HuntCredit> {
  if (!db()) return { counted: false, reason: "Gem Hunter is offline right now" };
  if (!wallets.length) return { counted: false, reason: "Sign in with a wallet to play Gem Hunter" };
  const key = `${ip}|${coinKey(coin)}`;
  const snap = claims().get(key);
  if (!snap || Date.now() - snap.at > CLAIM_TTL_MS) return { counted: false, reason: "This scan does not qualify for Gem Hunter" };
  const res = await creditFirst(wallets, snap, src);
  if (res.counted || res.reason !== NOT_HOLDER) claims().delete(key);
  return res;
}

const NOT_HOLDER = `Gem Hunter is for Holder plan and up: hold $${TOKEN.symbol} to play`;

async function creditFirst(wallets: string[], snap: Claim, src: string): Promise<HuntCredit> {
  let last: HuntCredit = { counted: false, reason: NOT_HOLDER };
  for (const w of wallets) {
    last = await credit(w, snap, src);
    if (last.counted || last.reason !== NOT_HOLDER) return last;
  }
  return last;
}

async function credit(wallet: string, snap: Claim, src: string): Promise<HuntCredit> {
  const d = db();
  if (!d) return { counted: false, reason: "Gem Hunter is offline right now" };
  // Тариф не пересчитываем сами: тот же tierOf, что у ботов и сайта.
  const { tierOf, tierAtLeast } = await import("./tiers");
  const tier = (await tierOf(wallet).catch(() => null))?.tier ?? "free";
  if (!tierAtLeast(tier, "holder")) return { counted: false, reason: NOT_HOLDER };
  const day = huntDay(snap.at);
  const used = (d.prepare("SELECT COUNT(*) AS n FROM hunt_scans WHERE wallet = ? AND day = ?").get(wallet, day) as { n: number }).n;
  if (used >= HUNT.dailyCap) return { counted: false, reason: `Daily limit reached: ${HUNT.dailyCap} counted scans per player`, day, left: 0 };
  const res = d
    .prepare(
      `INSERT OR IGNORE INTO hunt_scans (day, coin, chain, symbol, wallet, src, verdict, score, at, price0, liq0, fdv0) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(day, snap.coin, snap.chain, snap.symbol.slice(0, 20), wallet, src, snap.verdict, snap.score, snap.at, snap.price0, snap.liq0, Math.round(snap.fdv0));
  if (!res.changes) {
    const mine = d.prepare("SELECT 1 FROM hunt_scans WHERE day = ? AND coin = ? AND wallet = ?").get(day, snap.coin, wallet);
    return { counted: false, reason: mine ? "Already counted for you today" : "Another hunter scanned this coin first today", day };
  }
  cache = null;
  console.log(`[hunt] ${wallet.slice(0, 6)} ${src} $${snap.symbol} ${snap.chain} ${snap.verdict} fdv $${Math.round(snap.fdv0)}`);
  return { counted: true, day, left: HUNT.dailyCap - used - 1 };
}

// ---------- замеры и закрытие ----------

interface Snap {
  price: number;
  liq: number;
  pair: string;
}
// Как snapOf в track.ts: цена из самой ликвидной пары, где токен базовый, ликвидность суммой по всем.
function snapOf(id: string, pairs: PairInfo[]): Snap | null {
  const mine = pairs.filter((p) => p.baseToken?.address?.toLowerCase() === id.toLowerCase() && Number(p.priceUsd) > 0);
  if (!mine.length) return null;
  const liqOf = (p: PairInfo) => p.liquidity?.usd ?? 0;
  const best = mine.reduce((a, b) => (liqOf(b) > liqOf(a) ? b : a));
  return { price: Number(best.priceUsd), liq: mine.reduce((n, p) => n + liqOf(p), 0), pair: best.pairAddress };
}

export function huntPoints(h: Pick<HuntRow, "rugged" | "peak_pct" | "last_pct">): { points: number; outcome: HuntOutcome } {
  if (h.rugged) return { points: HUNT.rugPoints, outcome: "rug" };
  const mult = 1 + (h.peak_pct ?? 0) / 100;
  if (mult > HUNT.maxSaneMult) return { points: 0, outcome: "void" };
  const t = HUNT.tiers.find((x) => mult >= x.mult);
  if (t) return { points: t.points, outcome: "gem" };
  if ((h.last_pct ?? 0) <= HUNT.dumpPct) return { points: HUNT.dumpPoints, outcome: "dump" };
  return { points: 0, outcome: "flat" };
}

async function sampleOpen(now: number) {
  const d = db()!;
  const open = d.prepare("SELECT * FROM hunt_scans WHERE settled = 0 AND COALESCE(sampled_at, at) <= ? ORDER BY at LIMIT 300").all(now - SAMPLE_MS + 30_000) as unknown as HuntRow[];
  if (!open.length) return 0;
  let deepLeft = DEEP_PER_TICK;
  let n = 0;
  const byChain = new Map<string, HuntRow[]>();
  for (const h of open) byChain.set(h.chain, [...(byChain.get(h.chain) ?? []), h]);
  const upd = d.prepare(
    `UPDATE hunt_scans SET peak_pct = ?, peak_at = ?, low_pct = ?, last_pct = ?, liq_now = ?, pair = ?, sampled_at = ?, missing = ?, rug_hits = ?, rugged = ? WHERE id = ?`,
  );
  for (const [chain, list] of byChain) {
    let pairs: Map<string, PairInfo>;
    try {
      pairs = await bestPairs(chain, [...new Set(list.map((h) => h.coin))]);
    } catch (e) {
      console.warn("[hunt] dexscreener failed:", (e as Error).message);
      continue;
    }
    for (const h of list) {
      const main = pairs.get(h.coin);
      let s = snapOf(h.coin, main ? [main] : []);
      const pctOf = (x: Snap) => Math.round(((x.price - h.price0) / h.price0) * 1000) / 10;
      const rugCond = (x: Snap) => (x.liq < h.liq0 * RUG_LIQ && pctOf(x) <= HUNT.dumpPct) || x.liq < Math.min(DEAD_LIQ, h.liq0 * RUG_LIQ);
      const switched = !!main?.pairAddress && !!h.pair && main.pairAddress !== h.pair;
      // Как в track.ts: по всем парам перепроверяем только то, что меняет исход (пары нет, руг, обвал, смена пары).
      if (!s || rugCond(s) || pctOf(s) <= HUNT.dumpPct || switched) {
        if (deepLeft <= 0) continue;
        deepLeft--;
        try {
          s = snapOf(h.coin, await tokenPairs(chain, h.coin));
        } catch (e) {
          console.warn("[hunt] token pairs failed:", (e as Error).message);
          continue;
        }
      }
      let { peak_pct, peak_at, low_pct, last_pct, liq_now, pair, missing, rug_hits, rugged } = h;
      if (!s) {
        // Ни одной пары три замера подряд: DexScreener снимает с листинга токены с вытащенной ликвидностью.
        missing++;
        if (missing >= 3) {
          rugged = 1;
          low_pct = -100;
          last_pct = -100;
        }
      } else {
        missing = 0;
        const pct = pctOf(s);
        // Подтверждённый пик: уровень, на котором цена была два замера подряд (предыдущий замер или цена скана).
        const confirmed = Math.min(pct, last_pct ?? 0);
        if (peak_pct === null || confirmed > peak_pct) {
          peak_pct = confirmed;
          peak_at = now;
        }
        low_pct = Math.min(low_pct ?? pct, pct);
        last_pct = pct;
        liq_now = Math.round(s.liq);
        pair = main?.pairAddress ?? s.pair;
        rug_hits = rugCond(s) ? rug_hits + 1 : 0;
        if (rug_hits >= RUG_CONFIRM) rugged = 1;
      }
      upd.run(peak_pct, peak_at, low_pct, last_pct, liq_now, pair, now, missing, rug_hits, rugged, h.id);
      n++;
    }
  }
  return n;
}

function settleDue(now: number) {
  const d = db()!;
  // Закрываем: прошли сутки и после них был замер, или руг, или замеры не шли больше GIVE_UP_MS.
  const due = d
    .prepare("SELECT * FROM hunt_scans WHERE settled = 0 AND (rugged = 1 OR (sampled_at IS NOT NULL AND sampled_at - at >= ?) OR ? - at >= ?)")
    .all(WINDOW_MS, now, GIVE_UP_MS) as unknown as HuntRow[];
  const upd = d.prepare("UPDATE hunt_scans SET settled = 1, points = ?, outcome = ?, settled_at = ? WHERE id = ?");
  for (const h of due) {
    const { points, outcome } = huntPoints(h);
    upd.run(points, outcome, now, h.id);
  }
  if (due.length) cache = null;
  return due.length;
}

// Победитель дня: когда закрыты все сканы этого дня (последние закрываются через сутки после конца дня).
// При равенстве очков выше тот, у кого больше находок с очками, затем кто раньше начал.
function decideWinners(now: number) {
  const d = db()!;
  const today = huntDay(now);
  const days = d.prepare("SELECT DISTINCT day FROM hunt_scans WHERE day < ? AND day NOT IN (SELECT day FROM hunt_winners)").all(today) as { day: string }[];
  for (const { day } of days) {
    const end = dayStart(day) + DAY_MS;
    if (now < end + WINDOW_MS) continue;
    const open = (d.prepare("SELECT COUNT(*) AS n FROM hunt_scans WHERE day = ? AND settled = 0").get(day) as { n: number }).n;
    if (open) continue;
    const top = d
      .prepare(
        `SELECT wallet, SUM(points) AS points, COUNT(*) AS hunts, SUM(points > 0) AS hits, MIN(at) AS first FROM hunt_scans WHERE day = ?
         GROUP BY wallet ORDER BY points DESC, hits DESC, first ASC LIMIT 1`,
      )
      .get(day) as { wallet: string; points: number; hunts: number } | undefined;
    // Ноль или минус у лучшего: победителя нет (день записываем, чтобы не пересчитывать).
    const win = top && top.points > 0 ? top : null;
    d.prepare("INSERT OR IGNORE INTO hunt_winners (day, wallet, points, hunts, decided_at) VALUES (?, ?, ?, ?, ?)").run(day, win?.wallet ?? null, win?.points ?? 0, win?.hunts ?? 0, now);
    cache = null;
    console.log(`[hunt] day ${day} winner ${win ? `${win.wallet.slice(0, 6)} ${win.points} pts` : "none"}`);
  }
}

async function huntTick() {
  const s = st();
  if (s.busy) return;
  s.busy = true;
  try {
    const now = Date.now();
    await sampleOpen(now);
    settleDue(Date.now());
    decideWinners(Date.now());
    s.lastTick = Date.now();
  } finally {
    s.busy = false;
  }
}

export function startGemHunter() {
  const s = st();
  if (s.started) return;
  if (!db()) {
    console.warn("[hunt] off: SQLite unavailable");
    return;
  }
  s.started = true;
  setInterval(() => huntTick().catch((e) => console.warn("[hunt]", (e as Error).message)), TICK_MS).unref?.();
  console.log("[hunt] gem hunter started");
}

// ---------- приз: только запись подписи, без выплат ----------

const TX_RE = /^([1-9A-HJ-NP-Za-km-z]{64,90}|0x[0-9a-fA-F]{64})$/;

// Подпись транзакции приза. Отправляет команда вручную из казны; сервер только показывает ссылку.
// Право проверяет вызывающий (isAdmin из admin.ts).
export function setPrizeTx(day: string, tx: string | null) {
  const d = db();
  if (!d) throw new ApiError("Gem Hunter is offline right now", 503);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new ApiError("Bad day, use YYYY-MM-DD", 400);
  const w = d.prepare("SELECT * FROM hunt_winners WHERE day = ?").get(day) as WinnerRow | undefined;
  if (!w?.wallet) throw new ApiError("No winner stored for that day", 404);
  const t = tx?.trim() || null;
  if (t && !TX_RE.test(t)) throw new ApiError("That does not look like a transaction signature", 400);
  d.prepare("UPDATE hunt_winners SET tx = ?, tx_at = ? WHERE day = ?").run(t, t ? Date.now() : null, day);
  cache = null;
  return { ok: true, day, tx: t };
}

// ---------- для страницы ----------

export interface HuntBoardRow {
  wallet: string;
  points: number;
  hunts: number;
  open: number;
  hits: number;
  rugs: number;
  bestMult: number | null;
  wins?: number;
}
export interface HuntView {
  id: number;
  day: string;
  coin: string;
  chain: string;
  symbol: string;
  wallet: string;
  src: string;
  verdict: string;
  score: number | null;
  at: number;
  fdv0: number;
  peakMult: number | null;
  lastPct: number | null;
  settled: boolean;
  points: number;
  outcome: HuntOutcome;
  settlesAt: number;
}
export interface HuntWinner {
  day: string;
  wallet: string | null;
  points: number;
  hunts: number;
  decidedAt: number;
  tx: string | null;
  txAt: number | null;
}

const multOf = (pct: number | null) => (pct == null ? null : Math.round((1 + pct / 100) * 10) / 10);
const view = (h: HuntRow): HuntView => ({
  id: h.id,
  day: h.day,
  coin: h.coin,
  chain: h.chain,
  symbol: h.symbol,
  wallet: h.wallet,
  src: h.src,
  verdict: h.verdict,
  score: h.score,
  at: h.at,
  fdv0: h.fdv0,
  peakMult: multOf(h.peak_pct),
  lastPct: h.last_pct,
  settled: !!h.settled,
  points: h.points,
  outcome: h.outcome,
  settlesAt: h.at + WINDOW_MS,
});
const winnerView = (w: WinnerRow): HuntWinner => ({ day: w.day, wallet: w.wallet, points: w.points, hunts: w.hunts, decidedAt: w.decided_at, tx: w.tx, txAt: w.tx_at });

const BOARD_SQL = (where: string) => `SELECT wallet, SUM(CASE WHEN settled = 1 THEN points ELSE 0 END) AS points, COUNT(*) AS hunts,
  SUM(settled = 0) AS open, SUM(settled = 1 AND points > 0) AS hits, SUM(outcome = 'rug') AS rugs,
  MAX(CASE WHEN settled = 1 AND outcome = 'gem' THEN peak_pct END) AS best, MIN(at) AS first
  FROM hunt_scans ${where} GROUP BY wallet ORDER BY points DESC, hits DESC, first ASC LIMIT 50`;

type BoardSqlRow = { wallet: string; points: number; hunts: number; open: number; hits: number; rugs: number; best: number | null };
const boardRow = (r: BoardSqlRow): HuntBoardRow => ({ wallet: r.wallet, points: r.points, hunts: r.hunts, open: r.open, hits: r.hits, rugs: r.rugs, bestMult: multOf(r.best) });

function dayData(day: string) {
  const d = db()!;
  const board = (d.prepare(BOARD_SQL("WHERE day = ?")).all(day) as unknown as BoardSqlRow[]).map(boardRow);
  const hunts = (d.prepare("SELECT * FROM hunt_scans WHERE day = ? ORDER BY at DESC LIMIT 40").all(day) as unknown as HuntRow[]).map(view);
  const tot = d.prepare("SELECT COUNT(*) AS n, COUNT(DISTINCT wallet) AS players, SUM(settled = 0) AS open FROM hunt_scans WHERE day = ?").get(day) as { n: number; players: number; open: number | null };
  const w = d.prepare("SELECT * FROM hunt_winners WHERE day = ?").get(day) as WinnerRow | undefined;
  return { day, start: dayStart(day), end: dayStart(day) + DAY_MS, finalAt: dayStart(day) + DAY_MS + WINDOW_MS, scans: tot.n, players: tot.players, open: tot.open ?? 0, board, hunts, winner: w ? winnerView(w) : null };
}

let cache: { at: number; data: ReturnType<typeof compute> } | null = null;

function compute() {
  const d = db()!;
  const now = Date.now();
  const today = huntDay(now);
  const yesterday = huntDay(now - DAY_MS);
  const wins = new Map((d.prepare("SELECT wallet, COUNT(*) AS n FROM hunt_winners WHERE wallet IS NOT NULL GROUP BY wallet").all() as { wallet: string; n: number }[]).map((r) => [r.wallet, r.n]));
  const allTime = (d.prepare(BOARD_SQL("")).all() as unknown as BoardSqlRow[]).map((r) => ({ ...boardRow(r), wins: wins.get(r.wallet) ?? 0 }));
  const winners = (d.prepare("SELECT * FROM hunt_winners ORDER BY day DESC LIMIT 30").all() as unknown as WinnerRow[]).map(winnerView);
  return { today: dayData(today), yesterday: dayData(yesterday), allTime, winners };
}

export function huntStats() {
  const d = db();
  const rules = { ...HUNT, sampleMin: SAMPLE_MS / 60_000 };
  if (!d) return { enabled: false as const, rules, now: Date.now() };
  if (!cache || Date.now() - cache.at > 30_000) cache = { at: Date.now(), data: compute() };
  return { enabled: true as const, rules, now: Date.now(), lastTick: st().lastTick ?? null, ...cache.data };
}

export async function huntMe(wallet: string) {
  const d = db();
  const { tierOf, tierAtLeast } = await import("./tiers");
  const tier = (await tierOf(wallet).catch(() => null))?.tier ?? "free";
  const base = { wallet, tier, eligible: tierAtLeast(tier, "holder") };
  if (!d) return { ...base, today: null, allTime: null, hunts: [] as HuntView[] };
  const today = huntDay();
  const sum = (where: string, ...args: (string | number)[]) =>
    d.prepare(`SELECT COUNT(*) AS hunts, COALESCE(SUM(CASE WHEN settled = 1 THEN points ELSE 0 END), 0) AS points, COALESCE(SUM(settled = 0), 0) AS open FROM hunt_scans WHERE wallet = ? ${where}`).get(wallet, ...args) as {
      hunts: number;
      points: number;
      open: number;
    };
  const t = sum("AND day = ?", today);
  const wins = (d.prepare("SELECT COUNT(*) AS n FROM hunt_winners WHERE wallet = ?").get(wallet) as { n: number }).n;
  const hunts = (d.prepare("SELECT * FROM hunt_scans WHERE wallet = ? ORDER BY at DESC LIMIT 30").all(wallet) as unknown as HuntRow[]).map(view);
  return { ...base, today: { ...t, left: Math.max(0, HUNT.dailyCap - t.hunts) }, allTime: { ...sum(""), wins }, hunts };
}

export type HuntData = ReturnType<typeof huntStats>;
export type HuntMe = Awaited<ReturnType<typeof huntMe>>;
