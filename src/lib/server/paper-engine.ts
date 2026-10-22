// Paper Engine: настоящая бумажная торговля вперёд по сигналам Launch Radar. В отличие от paper.ts (задним числом
// из Track Record, выход ровно через сутки) здесь каждая стратегия открывает виртуальную позицию в момент вердикта,
// раз в минуту получает цену и закрывается по своим правилам: стоп, тейк, трейлинг, лимит времени, руг.
// Комиссии и проскальзывание учитываются. Стратегии — просто данные в STRATEGIES: новый вариант = новая строка.
// Хранение в SQLite (brain.db из memory-db.ts): после рестарта открытые позиции продолжают вестись.
// PAPER_ENGINE=0 выключает и вход, и замеры.
import "server-only";
import { bestPairs, type PairInfo } from "./crawl/dexscreener";
import { kvGet, kvSet, memDb } from "./memory-db";
import type { ScanResult, Verdict } from "./scan";
import type { VerdictV2 } from "./score-v2";

// ---------- стратегии ----------

export interface EntryRule {
  verdicts?: Verdict[]; // пусто — любой вердикт (кроме TOO_EARLY, если его не указать явно)
  chains?: string[];
  noPumpFun?: boolean; // не брать монеты pump.fun (адрес на «pump»): по истории там 43% ругов
  minScore?: number;
  maxScore?: number;
  verdictsV2?: VerdictV2[]; // теневой вердикт v2 (score-v2.ts); без v2 у скана фильтр не проходит
  minScoreV2?: number;
  minAgeMin?: number;
  maxAgeMin?: number;
  minLiqUsd?: number;
  maxLiqUsd?: number;
  minFdv?: number;
  maxFdv?: number;
  maxTop1Pct?: number;
  maxTop10Pct?: number;
  maxSnipersPct?: number; // сколько держат покупатели первых блоков сейчас
  noBundles?: boolean; // нет кластеров кошельков с общим спонсором (кластер от BUNDLE_PCT% эмиссии)
  maxFreshPct?: number; // доля кошельков моложе 3 дней
  maxDevHoldsPct?: number;
  lpSafe?: boolean; // LP сожжена, залочена или токен ещё на кривой pump.fun
  noMintFreeze?: boolean;
  minBuySellRatio?: number; // покупки/продажи за час
  minVolume1h?: number;
  minSocials?: number;
  excludeFlags?: string[]; // метки факторов скана, при которых не входим ("Bundled", "Snipers hold a lot"...)
}

export interface ExitRule {
  tpPct?: number; // тейк: цена выросла на столько % от входа
  slPct?: number; // стоп: упала на столько % (положительное число)
  trailPct?: number; // трейлинг: откат на столько % от пика
  trailArmPct?: number; // трейлинг включается, когда пик выше входа на столько % (по умолчанию 0: сразу)
  maxHoldMin: number;
}

export interface StrategyConfig {
  id: string; // стабильный: сделки привязаны к нему. Поменяли правила заметно — заведите новый id
  label: string;
  note: string;
  entry: EntryRule;
  exits: ExitRule;
  sizeUsd: number;
  enabled: boolean;
}

const H = 60;
export const STRATEGIES: StrategyConfig[] = [
  { id: "s1", label: "CLEAN hold 24h", note: "Baseline like the old page: CLEAN, no stops, sold after 24h", entry: { verdicts: ["CLEAN"] }, exits: { maxHoldMin: 24 * H }, sizeUsd: 100, enabled: true },
  { id: "s2", label: "CLEAN TP50 SL30", note: "CLEAN, take +50%, stop -30%, max 6h", entry: { verdicts: ["CLEAN"] }, exits: { tpPct: 50, slPct: 30, maxHoldMin: 6 * H }, sizeUsd: 100, enabled: true },
  { id: "s3", label: "CLEAN runner", note: "CLEAN, take +100%, stop -40%, 30% trail once up 30%, max 12h", entry: { verdicts: ["CLEAN"] }, exits: { tpPct: 100, slPct: 40, trailPct: 30, trailArmPct: 30, maxHoldMin: 12 * H }, sizeUsd: 100, enabled: true },
  { id: "s4", label: "CLEAN+OK scalp", note: "CLEAN or OK, take +30%, stop -20%, max 2h", entry: { verdicts: ["CLEAN", "OK"] }, exits: { tpPct: 30, slPct: 20, maxHoldMin: 2 * H }, sizeUsd: 100, enabled: true },
  { id: "s5", label: "CLEAN low snipers", note: "CLEAN, snipers hold under 5%, no bundles, top 10 under 40%, TP50 SL30 6h", entry: { verdicts: ["CLEAN"], maxSnipersPct: 5, noBundles: true, maxTop10Pct: 40 }, exits: { tpPct: 50, slPct: 30, maxHoldMin: 6 * H }, sizeUsd: 100, enabled: true },
  { id: "s6", label: "Every coin TP50 SL30", note: "Control: every radar coin with a verdict, same exits as S2", entry: { verdicts: ["CLEAN", "OK", "RISKY", "DANGER"] }, exits: { tpPct: 50, slPct: 30, maxHoldMin: 6 * H }, sizeUsd: 100, enabled: true },
  { id: "s7", label: "DANGER only", note: "Inverse control: only DANGER calls, same exits as S2. Should lose the most", entry: { verdicts: ["DANGER"] }, exits: { tpPct: 50, slPct: 30, maxHoldMin: 6 * H }, sizeUsd: 100, enabled: true },
  { id: "s8", label: "CLEAN 80+ trail", note: "CLEAN with score 80+, 25% trail from the peak, stop -35%, max 12h", entry: { verdicts: ["CLEAN"], minScore: 80 }, exits: { slPct: 35, trailPct: 25, maxHoldMin: 12 * H }, sizeUsd: 100, enabled: true },
  { id: "s9", label: "Fresh momentum", note: "CLEAN or OK under 3h old, more buys than sells, TP40 SL25 3h", entry: { verdicts: ["CLEAN", "OK"], maxAgeMin: 3 * H, minBuySellRatio: 1.2 }, exits: { tpPct: 40, slPct: 25, maxHoldMin: 3 * H }, sizeUsd: 100, enabled: true },
  // Из бэктеста 22.10 (3723 записи, проверка на свежих 30%): широкий тейк и короткий стоп стабильно лучше TP30/50.
  { id: "s10", label: "Clean mid-liq", note: "Backtest #1: CLEAN 90+, not pump.fun, liquidity $20k-50k, TP100 SL30, 24h", entry: { verdicts: ["CLEAN"], minScore: 90, noPumpFun: true, minLiqUsd: 20_000, maxLiqUsd: 50_000 }, exits: { tpPct: 100, slPct: 30, maxHoldMin: 24 * H }, sizeUsd: 100, enabled: true },
  { id: "s11", label: "Radar momentum", note: "Backtest #5: CLEAN or OK 60+, not pump.fun, liquidity $20k+, TP100 SL20, 24h", entry: { verdicts: ["CLEAN", "OK"], minScore: 60, noPumpFun: true, minLiqUsd: 20_000 }, exits: { tpPct: 100, slPct: 20, maxHoldMin: 24 * H }, sizeUsd: 100, enabled: true },
  { id: "s12", label: "Deep liquidity", note: "Backtest #4: CLEAN, OK or RISKY with $100k+ liquidity, TP100 SL20, 24h", entry: { verdicts: ["CLEAN", "OK", "RISKY"], minLiqUsd: 100_000 }, exits: { tpPct: 100, slPct: 20, maxHoldMin: 24 * H }, sizeUsd: 100, enabled: true },
  { id: "s13", label: "Momentum trail", note: "Same entry as Radar momentum, stop -20%, 25% trail once up 50%, 24h", entry: { verdicts: ["CLEAN", "OK"], minScore: 60, noPumpFun: true, minLiqUsd: 20_000 }, exits: { slPct: 20, trailPct: 25, trailArmPct: 50, maxHoldMin: 24 * H }, sizeUsd: 100, enabled: true },
  { id: "s14", label: "Clean 20k+ TP100", note: "CLEAN with $20k+ liquidity, any launchpad, TP100 SL30, 24h", entry: { verdicts: ["CLEAN"], minLiqUsd: 20_000 }, exits: { tpPct: 100, slPct: 30, maxHoldMin: 24 * H }, sizeUsd: 100, enabled: true },
  // Теневая оценка v2 (score-v2.ts): вход по вердикту v2 при любом публичном. Пара к s1 и s14 для сравнения вперёд.
  { id: "s15", label: "V2 CLEAN TP100", note: "Shadow score v2 says CLEAN (any public verdict), TP100 SL30, 24h", entry: { verdictsV2: ["CLEAN"] }, exits: { tpPct: 100, slPct: 30, maxHoldMin: 24 * H }, sizeUsd: 100, enabled: true },
  { id: "s16", label: "V2 CLEAN hold 24h", note: "Baseline for v2: shadow score v2 says CLEAN, no stops, sold after 24h", entry: { verdictsV2: ["CLEAN"] }, exits: { maxHoldMin: 24 * H }, sizeUsd: 100, enabled: true },
];

// ---------- параметры симуляции ----------

const SAMPLE_MS = 60_000;
const FEE = 0.01; // 1% на каждую сторону
const SLIP_CAP = 0.15; // проскальзывание: размер / ликвидность, но не больше 15%
const RUG_LIQ = 500; // ликвидность ниже — пары как будто нет
const RUG_SAMPLES = 3;
const MAX_OPEN = 40; // на стратегию
const MAX_JUMP = 100; // цена ×100 за минуту — сбой данных, замер пропускаем
const REENTRY_MS = 24 * 3600_000; // тот же токен той же стратегией не раньше чем через сутки
const BUNDLE_PCT = 5;
const CACHE_MS = 30_000;

export const paperEnabled = () => process.env.PAPER_ENGINE !== "0";

// ---------- признаки входа (они же уходят в экспорт) ----------

export interface Features {
  verdict: Verdict;
  score: number | null;
  scoreV2: number | null; // теневая оценка v2; null — скан без v2
  verdictV2: VerdictV2 | null;
  ageMin: number | null;
  liqUsd: number | null;
  fdv: number | null;
  top1: number | null;
  top10: number | null;
  snipersPct: number | null;
  snipers: number | null;
  bundlePct: number | null; // крупнейший кластер, % эмиссии; 0 — кластеров нет
  freshPct: number | null;
  devHoldsPct: number | null;
  lp: string | null;
  mint: boolean | null;
  freeze: boolean | null;
  buys1h: number | null;
  sells1h: number | null;
  volume1h: number | null;
  change1h: number | null;
  socials: number | null;
  flags: string[];
}

const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);

export function featuresOf(r: ScanResult): Features {
  const m = r.market;
  return {
    verdict: r.verdict,
    score: r.score,
    scoreV2: r.v2?.scoreV2 ?? null,
    verdictV2: r.v2?.verdictV2 ?? null,
    ageMin: m?.ageHours != null ? Math.round(m.ageHours * 60) : null,
    liqUsd: num(m?.liquidityUsd),
    fdv: num(m?.fdv),
    top1: num(r.holders?.top1),
    top10: num(r.holders?.top10 ?? r.evm?.top10),
    snipersPct: num(r.snipers?.holdPct),
    snipers: num(r.snipers?.wallets),
    bundlePct: r.bundles ? Math.max(0, ...r.bundles.clusters.map((c) => c.pct)) : null,
    freshPct: num(r.bundles?.fresh.pct),
    devHoldsPct: num(r.dev?.holdsPct),
    lp: r.lp?.status ?? null,
    mint: r.holders ? r.holders.mintAuthority : null,
    freeze: r.holders ? r.holders.freezeAuthority : null,
    buys1h: num(m?.buys1h),
    sells1h: num(m?.sells1h),
    volume1h: num(m?.volume1h),
    change1h: num(m?.change1h),
    socials: num(m?.socials),
    flags: r.factors.filter((f) => f.impact < 0).map((f) => f.label),
  };
}

// Неизвестное значение фильтр не проходит: «мало снайперов» без данных о снайперах не доказано.
function matches(e: EntryRule, f: Features, chain: string, token: string): boolean {
  const verdicts = e.verdicts?.length ? e.verdicts : (["CLEAN", "OK", "RISKY", "DANGER"] as Verdict[]);
  if (!verdicts.includes(f.verdict)) return false;
  if (e.chains?.length && !e.chains.includes(chain)) return false;
  if (e.noPumpFun && chain === "solana" && token.endsWith("pump")) return false;
  const min = (v: number | null, lim?: number) => lim === undefined || (v !== null && v >= lim);
  const max = (v: number | null, lim?: number) => lim === undefined || (v !== null && v <= lim);
  if (!min(f.score, e.minScore) || !max(f.score, e.maxScore)) return false;
  if (e.verdictsV2?.length && (f.verdictV2 === null || !e.verdictsV2.includes(f.verdictV2))) return false;
  if (!min(f.scoreV2, e.minScoreV2)) return false;
  if (!min(f.ageMin, e.minAgeMin) || !max(f.ageMin, e.maxAgeMin)) return false;
  if (!min(f.liqUsd, e.minLiqUsd) || !max(f.liqUsd, e.maxLiqUsd)) return false;
  if (!min(f.fdv, e.minFdv) || !max(f.fdv, e.maxFdv)) return false;
  if (!max(f.top1, e.maxTop1Pct) || !max(f.top10, e.maxTop10Pct)) return false;
  if (!max(f.snipersPct, e.maxSnipersPct) || !max(f.freshPct, e.maxFreshPct) || !max(f.devHoldsPct, e.maxDevHoldsPct)) return false;
  if (e.noBundles && (f.bundlePct === null || f.bundlePct >= BUNDLE_PCT || f.flags.includes("Bundled"))) return false;
  if (e.lpSafe && !(f.lp === "burned" || f.lp === "locked" || f.lp === "curve")) return false;
  if (e.noMintFreeze && (f.mint !== false || f.freeze !== false)) return false;
  if (e.minBuySellRatio !== undefined && (f.buys1h === null || f.sells1h === null || f.buys1h / Math.max(1, f.sells1h) < e.minBuySellRatio)) return false;
  if (!min(f.volume1h, e.minVolume1h) || !min(f.socials, e.minSocials)) return false;
  if (e.excludeFlags?.some((x) => f.flags.includes(x))) return false;
  return true;
}

// ---------- база ----------

interface PosRow {
  id: number;
  strategy: string;
  token: string;
  chain: string;
  symbol: string;
  verdict: string;
  score: number | null;
  entry_at: number;
  entry_price: number;
  size: number;
  units: number; // сколько токенов куплено после комиссии и проскальзывания
  liq0: number;
  peak_price: number;
  peak_at: number;
  low_price: number | null;
  low_at: number | null;
  last_price: number;
  last_liq: number;
  last_at: number;
  missing: number;
  features: string;
}
export type ExitReason = "sl" | "tp" | "trail" | "time" | "rug" | "removed";
interface TradeRow {
  id: number;
  strategy: string;
  token: string;
  chain: string;
  symbol: string;
  verdict: string;
  score: number | null;
  entry_at: number;
  exit_at: number;
  entry_price: number;
  exit_price: number;
  size: number;
  proceeds: number;
  gross_pct: number;
  net_pct: number;
  pnl: number;
  peak_pct: number;
  reason: ExitReason;
  features: string;
}

const host = globalThis as unknown as { __crawlhivePaperDb?: boolean; __crawlhivePaper?: { started: boolean; busy: boolean; lastTick: number; lastErr?: string } };
const st = () => (host.__crawlhivePaper ??= { started: false, busy: false, lastTick: 0 });

function db() {
  const d = memDb();
  if (!d) return null;
  if (!host.__crawlhivePaperDb) {
    d.db.exec(`
      CREATE TABLE IF NOT EXISTS paper_positions (id INTEGER PRIMARY KEY AUTOINCREMENT, strategy TEXT NOT NULL, token TEXT NOT NULL, chain TEXT NOT NULL,
        symbol TEXT NOT NULL, verdict TEXT NOT NULL, score INTEGER, entry_at INTEGER NOT NULL, entry_price REAL NOT NULL, size REAL NOT NULL,
        units REAL NOT NULL, liq0 REAL NOT NULL, peak_price REAL NOT NULL, peak_at INTEGER NOT NULL, last_price REAL NOT NULL, last_liq REAL NOT NULL,
        last_at INTEGER NOT NULL, missing INTEGER NOT NULL DEFAULT 0, features TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS paper_positions_st ON paper_positions (strategy, token);
      CREATE TABLE IF NOT EXISTS paper_trades (id INTEGER PRIMARY KEY, strategy TEXT NOT NULL, token TEXT NOT NULL, chain TEXT NOT NULL,
        symbol TEXT NOT NULL, verdict TEXT NOT NULL, score INTEGER, entry_at INTEGER NOT NULL, exit_at INTEGER NOT NULL, entry_price REAL NOT NULL,
        exit_price REAL NOT NULL, size REAL NOT NULL, proceeds REAL NOT NULL, gross_pct REAL NOT NULL, net_pct REAL NOT NULL, pnl REAL NOT NULL,
        peak_pct REAL NOT NULL, reason TEXT NOT NULL, features TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS paper_trades_st ON paper_trades (strategy, exit_at);
      CREATE INDEX IF NOT EXISTS paper_trades_token ON paper_trades (strategy, token, entry_at);
    `);
    // Минимум цены и время пика/минимума: по истории (замер раз в 10 мин) не видно, что было раньше, тейк или стоп.
    for (const sql of [
      "ALTER TABLE paper_positions ADD COLUMN low_price REAL",
      "ALTER TABLE paper_positions ADD COLUMN low_at INTEGER",
      "ALTER TABLE paper_trades ADD COLUMN peak_at INTEGER",
      "ALTER TABLE paper_trades ADD COLUMN low_pct REAL",
      "ALTER TABLE paper_trades ADD COLUMN low_at INTEGER",
    ])
      try {
        d.db.exec(sql);
      } catch {
        // колонка уже есть
      }
    host.__crawlhivePaperDb = true;
  }
  return d.db;
}

const slip = (size: number, liq: number) => Math.min(SLIP_CAP, liq > 0 ? size / liq : SLIP_CAP);
const r2 = (n: number) => Math.round(n * 100) / 100;
const startedAt = () => {
  const d = memDb();
  const v = d ? kvGet(d, "paper_engine_started") : undefined;
  return v ? Number(v) : null;
};

// ---------- вход: зовётся из radar.ts, когда вердикт готов ----------

export function paperOnSignal(r: ScanResult) {
  if (!paperEnabled()) return;
  const price = Number(r.market?.priceUsd);
  const liq = Number(r.market?.liquidityUsd);
  if (!(price > 0) || !(liq > 0) || r.verdict === "TOO_EARLY") return;
  const d = db();
  if (!d) return;
  const f = featuresOf(r);
  const now = Date.now();
  for (const s of STRATEGIES) {
    if (!s.enabled || !matches(s.entry, f, r.chain, r.id)) continue;
    const open = d.prepare("SELECT COUNT(*) AS n FROM paper_positions WHERE strategy = ?").get(s.id) as { n: number };
    if (open.n >= MAX_OPEN) continue;
    if (d.prepare("SELECT 1 FROM paper_positions WHERE strategy = ? AND token = ?").get(s.id, r.id)) continue;
    if (d.prepare("SELECT 1 FROM paper_trades WHERE strategy = ? AND token = ? AND entry_at > ?").get(s.id, r.id, now - REENTRY_MS)) continue;
    // Покупка: 1% комиссии, остаток идёт по цене хуже на проскальзывание.
    const units = (s.sizeUsd * (1 - FEE)) / (price * (1 + slip(s.sizeUsd, liq)));
    d.prepare(
      `INSERT INTO paper_positions (strategy, token, chain, symbol, verdict, score, entry_at, entry_price, size, units, liq0, peak_price, peak_at, last_price, last_liq, last_at, missing, features)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    ).run(s.id, r.id, r.chain, r.symbol, r.verdict, r.score, now, price, s.sizeUsd, units, liq, price, now, price, liq, now, JSON.stringify(f));
    console.log(`[paper] open ${s.id} $${r.symbol} ${r.chain} ${r.verdict}${r.score != null ? ` ${r.score}` : ""} at $${price} liq $${Math.round(liq)}`);
  }
}

// ---------- выход ----------

function close(p: PosRow, price: number, liq: number, reason: ExitReason, now: number) {
  const d = db()!;
  const proceeds = reason === "rug" ? 0 : p.units * price * (1 - slip(p.size, liq)) * (1 - FEE);
  const pnl = proceeds - p.size;
  const t = {
    gross: reason === "rug" ? -100 : ((price - p.entry_price) / p.entry_price) * 100,
    net: (pnl / p.size) * 100,
    peak: ((p.peak_price - p.entry_price) / p.entry_price) * 100,
  };
  d.exec("BEGIN");
  try {
    d.prepare(
      `INSERT INTO paper_trades (id, strategy, token, chain, symbol, verdict, score, entry_at, exit_at, entry_price, exit_price, size, proceeds, gross_pct, net_pct, pnl, peak_pct, reason, features)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(p.id, p.strategy, p.token, p.chain, p.symbol, p.verdict, p.score, p.entry_at, now, p.entry_price, reason === "rug" ? 0 : price, p.size, r2(proceeds), r2(t.gross), r2(t.net), r2(pnl), r2(t.peak), reason, p.features);
    const low = p.low_price ?? p.entry_price;
    d.prepare("UPDATE paper_trades SET peak_at = ?, low_pct = ?, low_at = ? WHERE id = ?").run(p.peak_at, r2(((low - p.entry_price) / p.entry_price) * 100), p.low_at ?? p.entry_at, p.id);
    d.prepare("DELETE FROM paper_positions WHERE id = ?").run(p.id);
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
  console.log(`[paper] close ${p.strategy} $${p.symbol} ${reason} ${t.net >= 0 ? "+" : ""}${t.net.toFixed(1)}% ($${pnl.toFixed(2)}) after ${Math.round((now - p.entry_at) / 60_000)}m`);
}

// Правила по порядку: стоп, тейк, трейлинг, время. Цена выхода — фактический замер, а не уровень стопа:
// между минутными замерами мемкоин легко пролетает уровень, и честнее считать по реальной цене.
function exitFor(p: PosRow, s: StrategyConfig | undefined, price: number, now: number): ExitReason | null {
  if (!s) return "removed";
  const x = s.exits;
  const pct = ((price - p.entry_price) / p.entry_price) * 100;
  if (x.slPct !== undefined && pct <= -x.slPct) return "sl";
  if (x.tpPct !== undefined && pct >= x.tpPct) return "tp";
  if (x.trailPct !== undefined) {
    const peakPct = ((p.peak_price - p.entry_price) / p.entry_price) * 100;
    const fromPeak = ((price - p.peak_price) / p.peak_price) * 100;
    if (peakPct >= (x.trailArmPct ?? 0) && fromPeak <= -x.trailPct) return "trail";
  }
  if (now - p.entry_at >= x.maxHoldMin * 60_000) return "time";
  return null;
}

export async function paperTick() {
  const s = st();
  if (s.busy || !paperEnabled()) return 0;
  const d = db();
  if (!d) return 0;
  s.busy = true;
  try {
    const open = d.prepare("SELECT * FROM paper_positions").all() as unknown as PosRow[];
    if (!open.length) return 0;
    const now = Date.now();
    const byId = new Map(STRATEGIES.map((x) => [x.id, x]));
    // Один токен у нескольких стратегий запрашиваем один раз; bestPairs режет на пачки по 30 и берёт самую
    // ликвидную пару (после миграции с pump.fun цена живёт в новом пуле).
    const byChain = new Map<string, Set<string>>();
    for (const p of open) byChain.set(p.chain, (byChain.get(p.chain) ?? new Set()).add(p.token));
    const prices = new Map<string, PairInfo | null>();
    for (const [chain, ids] of byChain) {
      try {
        const pairs = await bestPairs(chain, [...ids]);
        for (const id of ids) prices.set(`${chain}:${id}`, pairs.get(id) ?? null);
      } catch (e) {
        // Сбой API — не повод считать пару пропавшей: просто пропускаем замер этой сети.
        s.lastErr = `${chain}: ${(e as Error).message}`;
        console.warn("[paper] dexscreener failed:", s.lastErr);
      }
    }
    const upd = d.prepare("UPDATE paper_positions SET peak_price = ?, peak_at = ?, last_price = ?, last_liq = ?, last_at = ?, missing = ? WHERE id = ?");
    for (const p of open) {
      const key = `${p.chain}:${p.token}`;
      if (!prices.has(key)) continue;
      const pair = prices.get(key);
      const price = Number(pair?.priceUsd);
      const liq = pair?.liquidity?.usd ?? 0;
      const strat = byId.get(p.strategy);
      try {
        if (!pair || !(price > 0) || liq < RUG_LIQ) {
          const missing = p.missing + 1;
          if (missing >= RUG_SAMPLES) close(p, 0, 0, "rug", now);
          else upd.run(p.peak_price, p.peak_at, p.last_price, p.last_liq, now, missing, p.id);
          continue;
        }
        if (price > p.last_price * MAX_JUMP) continue;
        if (price > p.peak_price) Object.assign(p, { peak_price: price, peak_at: now });
        if (price < (p.low_price ?? p.entry_price)) {
          Object.assign(p, { low_price: price, low_at: now });
          d.prepare("UPDATE paper_positions SET low_price = ?, low_at = ? WHERE id = ?").run(price, now, p.id);
        }
        const reason = exitFor(p, strat, price, now);
        if (reason) close(p, price, liq, reason, now);
        else upd.run(p.peak_price, p.peak_at, price, liq, now, 0, p.id);
      } catch (e) {
        console.warn("[paper] position", p.id, (e as Error).message);
      }
    }
    s.lastTick = now;
    cache = null;
    return open.length;
  } finally {
    s.busy = false;
  }
}

export function startPaperEngine() {
  const s = st();
  if (s.started || !paperEnabled()) return;
  const d = db();
  if (!d) {
    console.warn("[paper] engine off: SQLite unavailable");
    return;
  }
  s.started = true;
  const m = memDb()!;
  if (!kvGet(m, "paper_engine_started")) kvSet(m, "paper_engine_started", String(Date.now()));
  const n = (d.prepare("SELECT COUNT(*) AS n FROM paper_positions").get() as { n: number }).n;
  setInterval(() => paperTick().catch((e) => console.warn("[paper]", (e as Error).message)), SAMPLE_MS);
  console.log(`[paper] engine started, ${STRATEGIES.filter((x) => x.enabled).length} strategies, ${n} open positions resumed`);
}

// ---------- статистика для страницы ----------

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r1 = (n: number) => Math.round(n * 10) / 10;

// Нереализованный итог открытой позиции: как если бы продали по последнему замеру прямо сейчас.
const markPnl = (p: PosRow) => p.units * p.last_price * (1 - slip(p.size, p.last_liq)) * (1 - FEE) - p.size;

function compute() {
  const d = db();
  const now = Date.now();
  const base = { enabled: paperEnabled(), startedAt: startedAt(), lastTick: st().lastTick || null, fee: FEE, maxOpen: MAX_OPEN, sampleSec: SAMPLE_MS / 1000, updatedAt: now };
  if (!d) return { ...base, strategies: [], open: [], trades: [] };
  const trades = d.prepare("SELECT * FROM paper_trades ORDER BY exit_at").all() as unknown as TradeRow[];
  const open = d.prepare("SELECT * FROM paper_positions ORDER BY entry_at DESC").all() as unknown as PosRow[];
  const ids = [...new Set([...STRATEGIES.map((s) => s.id), ...trades.map((t) => t.strategy)])];
  const strategies = ids.map((id) => {
    const cfg = STRATEGIES.find((s) => s.id === id);
    const ts = trades.filter((t) => t.strategy === id);
    const op = open.filter((p) => p.strategy === id);
    const rets = ts.map((t) => t.net_pct);
    const wins = ts.filter((t) => t.pnl > 0);
    const gain = wins.reduce((a, t) => a + t.pnl, 0);
    const loss = -ts.filter((t) => t.pnl < 0).reduce((a, t) => a + t.pnl, 0);
    // Кривая и просадка по реализованному P&L в порядке закрытия.
    let eq = 0;
    let peak = 0;
    let dd = 0;
    const curve: [number, number][] = [];
    for (const t of ts) {
      eq += t.pnl;
      peak = Math.max(peak, eq);
      dd = Math.max(dd, peak - eq);
      curve.push([t.exit_at, r2(eq)]);
    }
    const step = Math.ceil(curve.length / 200) || 1;
    const reasons: Partial<Record<ExitReason, number>> = {};
    for (const t of ts) reasons[t.reason] = (reasons[t.reason] ?? 0) + 1;
    return {
      id,
      label: cfg?.label ?? id,
      note: cfg?.note ?? "Removed strategy, old trades kept",
      enabled: !!cfg?.enabled,
      entry: cfg?.entry ?? null,
      exits: cfg?.exits ?? null,
      sizeUsd: cfg?.sizeUsd ?? 100,
      trades: ts.length,
      open: op.length,
      wins: wins.length,
      winRate: ts.length ? r1((wins.length / ts.length) * 100) : null,
      pnl: r2(eq),
      openPnl: r2(op.reduce((a, p) => a + markPnl(p), 0)),
      invested: r2(ts.reduce((a, t) => a + t.size, 0)),
      avgRet: rets.length ? r1(rets.reduce((a, b) => a + b, 0) / rets.length) : null,
      medianRet: rets.length ? r1(median(rets)!) : null,
      profitFactor: loss > 0 ? Math.round((gain / loss) * 100) / 100 : null, // null: убыточных сделок нет (или сделок нет)
      maxDrawdown: r2(dd),
      avgHoldMin: ts.length ? Math.round(ts.reduce((a, t) => a + (t.exit_at - t.entry_at), 0) / ts.length / 60_000) : null,
      reasons,
      curve: curve.filter((_, i) => i % step === 0 || i === curve.length - 1),
    };
  });
  return {
    ...base,
    strategies,
    open: open.map((p) => ({
      id: p.id,
      strategy: p.strategy,
      token: p.token,
      chain: p.chain,
      symbol: p.symbol,
      verdict: p.verdict,
      score: p.score,
      entryAt: p.entry_at,
      entryPrice: p.entry_price,
      lastPrice: p.last_price,
      lastAt: p.last_at,
      liq: Math.round(p.last_liq),
      retPct: r1(((p.last_price - p.entry_price) / p.entry_price) * 100),
      peakPct: r1(((p.peak_price - p.entry_price) / p.entry_price) * 100),
      pnl: r2(markPnl(p)),
      missing: p.missing,
      closesAt: p.entry_at + (STRATEGIES.find((s) => s.id === p.strategy)?.exits.maxHoldMin ?? 0) * 60_000,
    })),
    trades: trades.slice(-100).reverse().map((t) => ({
      id: t.id,
      strategy: t.strategy,
      token: t.token,
      chain: t.chain,
      symbol: t.symbol,
      verdict: t.verdict,
      score: t.score,
      entryAt: t.entry_at,
      exitAt: t.exit_at,
      grossPct: t.gross_pct,
      netPct: t.net_pct,
      peakPct: t.peak_pct,
      pnl: t.pnl,
      reason: t.reason,
    })),
  };
}

export type PaperEngineData = ReturnType<typeof compute>;

let cache: { at: number; data: PaperEngineData } | null = null;
export function paperEngineStats(): PaperEngineData {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  cache = { at: Date.now(), data: compute() };
  return cache.data;
}

// Полный экспорт для разбора: каждая сделка с признаками входа и исходом, плюс открытые позиции и конфиги.
export function paperExport(since = 0) {
  const d = db();
  const parse = (s: string) => {
    try {
      return JSON.parse(s) as Features;
    } catch {
      return null;
    }
  };
  if (!d) return { enabled: paperEnabled(), startedAt: null, strategies: STRATEGIES, trades: [], open: [] };
  const trades = d.prepare("SELECT * FROM paper_trades WHERE exit_at >= ? ORDER BY exit_at").all(since) as unknown as TradeRow[];
  const open = d.prepare("SELECT * FROM paper_positions ORDER BY entry_at").all() as unknown as PosRow[];
  return {
    enabled: paperEnabled(),
    startedAt: startedAt(),
    exportedAt: Date.now(),
    costs: { feePerSide: FEE, slippage: "size / liquidity, capped", slipCap: SLIP_CAP, rugLiqUsd: RUG_LIQ, rugSamples: RUG_SAMPLES },
    strategies: STRATEGIES,
    trades: trades.map(({ features, ...t }) => ({ ...t, holdMin: Math.round((t.exit_at - t.entry_at) / 60_000), features: parse(features) })),
    open: open.map(({ features, ...p }) => ({ ...p, features: parse(features) })),
  };
}
