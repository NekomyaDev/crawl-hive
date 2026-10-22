// Track Record: проверяем сканер реальностью. Каждый вердикт (скан пользователя, проверка безопасности
// краулера, Launch Radar, агент через MCP) запоминается вместе с ценой и ликвидностью на момент скана.
// Следующие 24 часа цену замеряем каждые 10 минут. Итог честный и без подбора примеров: какая доля токенов
// с каждым вердиктом рухнула (−50% от цены скана) или потеряла ликвидность (руг) за сутки.
import "server-only";
import { getMeta, setMeta } from "./store";
import { bestPairs, tokenPairs, type PairInfo } from "./crawl/dexscreener";

const KEY = "track";
const MAX = 4000;
const WINDOW_MS = 24 * 3600_000;
const SAMPLE_MS = 10 * 60_000;
const DUMP_PCT = -50; // рухнул: минимум за сутки на 50% ниже цены скана
const RUG_LIQ = 0.2; // руг: ликвидность по всем парам упала до 20% от исходной вместе с ценой, или пары исчезли
const RUG_CONFIRM = 2; // руг ставим только после двух таких замеров подряд
const DEAD_LIQ = 500; // во всех пулах меньше $500 — продать уже нечем, руг при любой цене
const DEEP_PER_RUN = 60; // перепроверок по всем парам за проход (лимит DexScreener 300 запросов в минуту)
const METHOD = 2; // версия метода замера: 2 — цена и ликвидность по всем парам токена
const PUBLIC_METHOD = 2; // какая модель дала публичный вердикт: 2 — оценка v2 (с 22.10); нет поля pv — старая v1

export type TrackVerdict = "CLEAN" | "OK" | "RISKY" | "DANGER" | "TOO_EARLY";

export interface TrackEntry {
  id: string; // адрес токена
  chain: string;
  symbol: string;
  verdict: TrackVerdict;
  score: number | null;
  src: "scan" | "crawler" | "radar" | "agent";
  at: number;
  price0: number;
  liq0: number;
  fdv0?: number; // капитализация на момент скана (для Replay: «$41k → $392k»)
  peakPct?: number;
  peakAt?: number; // когда был пик
  name?: string;
  lowPct?: number;
  lastPct?: number;
  liqNow?: number;
  sampledAt?: number;
  missing?: number; // сколько замеров подряд пара не находилась
  done?: boolean;
  dumped?: boolean;
  rugged?: boolean;
  // Метод v2 (поля необязательные, старые записи читаются как раньше):
  m?: number; // версия метода замера; нет поля — запись считалась старым методом по одной паре
  pair?: string; // основная пара DexScreener на последнем замере (по её смене ловим миграцию)
  rugHits?: number; // сколько замеров подряд выполняется условие руга
  rugBy?: "liq" | "gone"; // руг по обвалу ликвидности и цены или по исчезновению всех пар
  rc?: number; // когда старую запись перепроверили новым методом
  recheck?: "reopened" | "alive"; // reopened — свежий старый руг досчитан заново; alive — токен после «руга» жив
  // Оценка v2 (score-v2.ts) на момент скана, сырая, без потолков v1. С 22.10 по ней же считается публичный verdict.
  s2?: number;
  v2?: "CLEAN" | "OK" | "RISKY" | "DANGER";
  dw?: number; // кошельков с рухнувшей историей на момент скана
  a0?: number; // возраст пары в часах на момент скана (для базовой ставки «зоны ругов» в скане)
  // С 22.10: какая модель дала verdict, плюс v1 и теневая v3 рядом, чтобы сравнивать все три на одних монетах.
  pv?: number; // версия публичного вердикта (PUBLIC_METHOD); нет поля — verdict/score это v1
  s1?: number | null; // балл v1
  vv1?: TrackVerdict; // вердикт v1
  s3?: number; // теневая оценка v3 (score-v3.ts)
  v3?: "CLEAN" | "OK" | "RISKY" | "DANGER";
}

// Все записи Track Record (для разовых задач вроде поиска первого появления токена).
export const trackEntries = (): TrackEntry[] => all();

function all(): TrackEntry[] {
  try {
    return JSON.parse(getMeta(KEY) ?? "[]");
  } catch {
    return [];
  }
}
const save = (l: TrackEntry[]) => setMeta(KEY, JSON.stringify(l.slice(0, MAX)));

// Один токен — одна запись за окно: повторные сканы того же токена не накручивают статистику.
export function trackVerdict(r: {
  id: string;
  chain: string;
  symbol: string;
  verdict: TrackVerdict;
  score: number | null;
  name?: string;
  market?: { priceUsd?: number; liquidityUsd?: number; fdv?: number; ageHours?: number };
  v1?: { score: number | null; verdict: TrackVerdict };
  v2?: { scoreV2: number; verdictV2: NonNullable<TrackEntry["v2"]>; dumpWallets: number | null };
  v3?: { scoreV3: number; verdictV3: NonNullable<TrackEntry["v3"]> };
}, src: TrackEntry["src"]) {
  const price0 = Number(r.market?.priceUsd);
  const liq0 = Number(r.market?.liquidityUsd);
  if (!(price0 > 0) || !(liq0 > 0) || !["solana", "robinhood", "bsc", "base"].includes(r.chain)) return;
  const list = all();
  const now = Date.now();
  const prev = list.findIndex((e) => e.id === r.id && now - e.at < WINDOW_MS);
  // Настоящий вердикт вытесняет «слишком рано»: судить сканер по TOO_EARLY нечестно в обе стороны.
  if (prev >= 0) {
    if (list[prev].verdict !== "TOO_EARLY" || r.verdict === "TOO_EARLY") return;
    list.splice(prev, 1);
  }
  const fdv0 = Number(r.market?.fdv) > 0 ? Math.round(Number(r.market?.fdv)) : undefined;
  const age0 = r.market?.ageHours;
  list.unshift({ id: r.id, chain: r.chain, symbol: r.symbol, name: r.name?.slice(0, 40), verdict: r.verdict, score: r.score, src, at: now, price0, liq0, m: METHOD, ...(fdv0 ? { fdv0 } : {}), ...(age0 !== undefined && age0 >= 0 ? { a0: Math.round(age0 * 10) / 10 } : {}), ...v2Fields(r.v2), ...modelFields(r) });
  save(list);
}

const v2Fields = (v?: { scoreV2: number; verdictV2: NonNullable<TrackEntry["v2"]>; dumpWallets: number | null }) =>
  v ? { s2: v.scoreV2, v2: v.verdictV2, ...(v.dumpWallets !== null ? { dw: v.dumpWallets } : {}) } : {};

// Без r.v1 (базовый актив, сбой v2) публичный вердикт и есть v1: пишем его же в поля v1.
const modelFields = (r: { score: number | null; verdict: TrackVerdict; v1?: { score: number | null; verdict: TrackVerdict }; v3?: { scoreV3: number; verdictV3: NonNullable<TrackEntry["v3"]> } }) => ({
  pv: PUBLIC_METHOD,
  s1: r.v1 ? r.v1.score : r.score,
  vv1: r.v1?.verdict ?? r.verdict,
  ...(r.v3 ? { s3: r.v3.scoreV3, v3: r.v3.verdictV3 } : {}),
});

// Замер цены открытых записей. Сначала дешёвый пакетный запрос (по одной основной паре на токен, 30 адресов
// за раз); всё, что выглядит как обвал, руг или смена пары, перепроверяем по всем парам токена. Так исход
// следует за токеном через миграцию с кривой pump.fun на PumpSwap/Raydium и через переезд в другой пул:
// цена берётся из самой ликвидной пары, ликвидность суммируется по всем.
const sampling = globalThis as unknown as { __crawlhiveTrackBusy?: boolean };

export async function sampleTrack() {
  if (sampling.__crawlhiveTrackBusy) return 0;
  sampling.__crawlhiveTrackBusy = true;
  try {
    return await sampleOnce();
  } finally {
    sampling.__crawlhiveTrackBusy = false;
  }
}

async function sampleOnce() {
  const list = all();
  const now = Date.now();
  const open = list.filter((e) => !e.done && now - (e.sampledAt ?? e.at) >= SAMPLE_MS - 30_000);
  const touched: TrackEntry[] = [];
  let deepLeft = DEEP_PER_RUN;
  const deep = async (e: TrackEntry): Promise<Snap | null | undefined> => {
    if (deepLeft <= 0) return undefined;
    deepLeft--;
    try {
      return snapOf(e.id, await tokenPairs(e.chain, e.id));
    } catch (err) {
      console.warn("[track] token pairs failed:", (err as Error).message);
      return undefined;
    }
  };
  const byChain = new Map<string, TrackEntry[]>();
  for (const e of open) byChain.set(e.chain, [...(byChain.get(e.chain) ?? []), e]);
  for (const [chain, entries] of byChain) {
    let pairs: Awaited<ReturnType<typeof bestPairs>>;
    try {
      pairs = await bestPairs(chain, entries.map((e) => e.id));
    } catch (e) {
      console.warn("[track] dexscreener failed:", (e as Error).message);
      continue;
    }
    for (const e of entries) {
      const main = pairs.get(e.id);
      let s = snapOf(e.id, main ? [main] : []);
      const pctOf = (x: Snap) => Math.round(((x.price - e.price0) / e.price0) * 1000) / 10;
      const rugCond = (x: Snap) => (x.liq < e.liq0 * RUG_LIQ && pctOf(x) <= DUMP_PCT) || x.liq < Math.min(DEAD_LIQ, e.liq0 * RUG_LIQ);
      // Перепроверяем по всем парам только то, что меняет исход: пары нет, условие руга, первый обвал
      // ниже −50% или DexScreener сменил основную пару (миграция с кривой, переезд в другой пул).
      const mainPair = main?.pairAddress;
      const switched = !!mainPair && !!e.pair && mainPair !== e.pair;
      if (!s || rugCond(s) || (!e.dumped && pctOf(s) <= DUMP_PCT) || switched) {
        const d = await deep(e);
        // Перепроверить не удалось (лимит или сбой) — замер откладываем, а не пишем непроверенный обвал.
        if (d === undefined) continue;
        s = d;
      }
      e.sampledAt = now;
      touched.push(e);
      if (!s) {
        // Ни одной пары даже в полном списке: три замера подряд (30 минут) — DexScreener снимает с листинга
        // токены с вытащенной ликвидностью. Пустой ответ бывает и случайно, поэтому одного раза мало.
        e.missing = (e.missing ?? 0) + 1;
        if (e.missing >= 3) Object.assign(e, { rugged: true, dumped: true, rugBy: "gone", lowPct: -100, lastPct: -100 });
      } else {
        e.missing = 0;
        const pct = pctOf(s);
        if (e.peakPct === undefined || pct > e.peakPct) e.peakAt = now;
        e.peakPct = Math.max(e.peakPct ?? pct, pct);
        e.lowPct = Math.min(e.lowPct ?? pct, pct);
        e.lastPct = pct;
        e.liqNow = Math.round(s.liq);
        e.pair = mainPair ?? s.pair;
        if (e.lowPct <= DUMP_PCT) e.dumped = true;
        // Руг: ликвидность по всем парам сейчас ниже 20% исходной и цена сейчас (а не когда-то за сутки) ниже
        // −50%, либо пулы почти пусты при любой цене. Подтверждаем двумя замерами подряд: один кривой ответ
        // DexScreener не должен навсегда записывать токен в руги.
        e.rugHits = rugCond(s) ? (e.rugHits ?? 0) + 1 : 0;
        if (e.rugHits >= RUG_CONFIRM) Object.assign(e, { rugged: true, dumped: true, rugBy: "liq" });
      }
      if (now - e.at >= WINDOW_MS || e.rugged) e.done = true;
    }
  }
  // Разовая перепроверка записей, посчитанных старым методом (см. recheckLegacy).
  for (const e of list) {
    if (deepLeft <= 0) break;
    if (e.m || e.rc || e.rugBy || !e.rugged) continue;
    const r = await recheckLegacy(e, now, deep);
    if (r) touched.push(e);
  }
  if (touched.length) saveMerged(touched);
  return touched.length;
}

// Записи до исправления метода (без поля m) считались по одной паре и по минимуму цены за сутки: руг ставился,
// если хоть раз цена была −50%, а основная пара в какой-то замер оказалась бедной (миграция, переезд в другой
// пул, пыльная пара). Свежие такие руги (окно ещё открыто) переоткрываем и досчитываем новым методом.
// Старые не переписываем — прошлых замеров уже не восстановить; только помечаем, если токен сейчас жив
// (суммарная ликвидность не ниже половины исходной и цена не ниже −50%): такой «руг» почти наверняка ложный.
async function recheckLegacy(e: TrackEntry, now: number, deep: (e: TrackEntry) => Promise<Snap | null | undefined>) {
  if (now - e.at < WINDOW_MS && (e.missing ?? 0) < 3) {
    Object.assign(e, { rugged: false, done: false, rugHits: 0, rc: now, recheck: "reopened" as const });
    e.dumped = (e.lowPct ?? 0) <= DUMP_PCT;
    return true;
  }
  const s = await deep(e);
  if (s === undefined) return false;
  e.rc = now;
  const alive = !!s && s.liq >= e.liq0 * 0.5 && s.price >= e.price0 * 0.5;
  if (alive) e.recheck = "alive";
  return true;
}

// Снимок по парам токена: цена из самой ликвидной пары, ликвидность суммой по всем. Пары, где токен
// стоит котируемым (quote), пропускаем: priceUsd в них — цена другого токена.
interface Snap {
  price: number;
  liq: number;
  pair: string;
}
function snapOf(id: string, pairs: PairInfo[]): Snap | null {
  const mine = pairs.filter((p) => p.baseToken?.address?.toLowerCase() === id.toLowerCase() && Number(p.priceUsd) > 0);
  if (!mine.length) return null;
  const liqOf = (p: PairInfo) => p.liquidity?.usd ?? 0;
  const best = mine.reduce((a, b) => (liqOf(b) > liqOf(a) ? b : a));
  return { price: Number(best.priceUsd), liq: mine.reduce((n, p) => n + liqOf(p), 0), pair: best.pairAddress };
}

// Пока шли запросы к DexScreener, могли добавиться новые вердикты: пишем свои записи поверх свежего журнала,
// а не весь старый список, иначе новые записи терялись бы.
function saveMerged(touched: TrackEntry[]) {
  const key = (e: TrackEntry) => `${e.id}|${e.at}`;
  const upd = new Map(touched.map((e) => [key(e), e]));
  save(all().map((e) => upd.get(key(e)) ?? e));
}

// ---------- для страницы ----------

export interface VerdictStats {
  verdict: TrackVerdict;
  tracked: number; // всего с этим вердиктом
  settled: number; // прошли сутки или руг — исход известен
  dumped: number; // рухнули на 50%+ или руг
  rugged: number;
  suspectRugs: number; // из rugged: старые руги, после которых токен жив (recheck "alive") — почти наверняка ложные
  medianPeak: number | null;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const VERDICTS: TrackVerdict[] = ["CLEAN", "OK", "RISKY", "DANGER", "TOO_EARLY"];
// Итог считаем только после полных суток с момента скана: руги закрываются раньше, и иначе
// в первые часы «закрытыми» оказывались бы почти одни руги — ложные 100% в обе стороны.
const settledAt = (e: TrackEntry, now: number) => !!e.done && now - e.at >= WINDOW_MS;

function statsBy(list: TrackEntry[]): VerdictStats[] {
  const now = Date.now();
  return VERDICTS.map((v): VerdictStats => {
    const xs = list.filter((e) => e.verdict === v);
    const settled = xs.filter((e) => settledAt(e, now));
    return {
      verdict: v,
      tracked: xs.length,
      settled: settled.length,
      dumped: settled.filter((e) => e.dumped).length,
      rugged: settled.filter((e) => e.rugged).length,
      suspectRugs: settled.filter((e) => e.rugged && e.recheck === "alive").length,
      medianPeak: median(settled.map((e) => e.peakPct ?? 0)),
    };
  });
}

// Когда публичный вердикт переключили на v2: первая запись с pv. null — новых записей ещё нет.
function switchAt(list: TrackEntry[]) {
  let at: number | null = null;
  for (const e of list) if (e.pv && (at === null || e.at < at)) at = e.at;
  return at;
}

// По умолчанию (by, total, since) только вердикты после переключения на v2 (записи с pv): старые вердикты
// другой модели не смешиваем. Период до переключения (v1) отдельно в old, всё вместе в allTime: нужно там,
// где модель не важна (TOO_EARLY одинаков в обеих, базовая доля сливов в Brain).
export function trackStats() {
  const list = all();
  const pub = list.filter((e) => e.pv);
  const prev = list.filter((e) => !e.pv);
  const by = statsBy(pub);
  const byOld = statsBy(prev);
  const firstAt = (xs: TrackEntry[]) => (xs.length ? xs[xs.length - 1].at : null);
  // «Мы предупреждали»: DANGER/RISKY, которые потом рухнули. «Пропустили»: CLEAN/OK, которые всё равно рухнули.
  const view = (e: TrackEntry) => ({
    id: e.id,
    chain: e.chain,
    symbol: e.symbol,
    verdict: e.verdict,
    score: e.score,
    src: e.src,
    at: e.at,
    peakPct: e.peakPct ?? null,
    lowPct: e.lowPct ?? null,
    lastPct: e.lastPct ?? null,
    done: !!e.done,
    dumped: !!e.dumped,
    rugged: !!e.rugged,
  });
  const warned = list.filter((e) => (e.verdict === "DANGER" || e.verdict === "RISKY") && e.dumped).slice(0, 12).map(view);
  const missed = list.filter((e) => (e.verdict === "CLEAN" || e.verdict === "OK") && e.dumped).slice(0, 12).map(view);
  const recent = list.slice(0, 40).map(view);
  return {
    since: firstAt(pub),
    total: pub.length,
    by,
    model: "v2" as const,
    switchAt: switchAt(list),
    old: { model: "v1" as const, since: firstAt(prev), until: switchAt(list), total: prev.length, by: byOld },
    allTime: { since: firstAt(list), total: list.length, by: statsBy(list) },
    // Старые имена полей для страницы: byPublic = by, totalPublic = total.
    byPublic: by,
    byOld,
    totalPublic: pub.length,
    warned,
    missed,
    recent,
    windowHours: 24,
    dumpPct: DUMP_PCT,
  };
}

// ---------- какая оценка права: v1, v2 и v3 на одних и тех же монетах ----------
// Только закрытые записи (прошли сутки). «С переключения» — записи с pv, где у монеты есть все три оценки;
// «за всё время» — где есть хотя бы поле модели: v1 есть у всех, v2 с 21-22.10, v3 только с 22.10.
// Ложные руги (после «руга» токен жив) ругами не считаем.
type ModelVerdict = "CLEAN" | "OK" | "RISKY" | "DANGER" | "TOO_EARLY";
export interface CompareRow {
  verdict: ModelVerdict;
  n: number;
  rugRate: number | null;
  dumpRate: number | null;
  peak50Rate: number | null; // доля с пиком от +50% за сутки
  medianLast: number | null; // медиана цены через сутки, % от цены скана
}
const MODELS = {
  v1: (e: TrackEntry): ModelVerdict | undefined => e.vv1 ?? (e.pv ? undefined : e.verdict),
  v2: (e: TrackEntry): ModelVerdict | undefined => e.v2,
  v3: (e: TrackEntry): ModelVerdict | undefined => e.v3,
};
type Model = keyof typeof MODELS;

function compareRows(list: TrackEntry[], model: Model): CompareRow[] {
  const rate = (a: number, n: number) => (n ? Math.round((a / n) * 1000) / 10 : null);
  return VERDICTS.flatMap((v) => {
    const xs = list.filter((e) => MODELS[model](e) === v);
    if (!xs.length && v === "TOO_EARLY") return [];
    return [
      {
        verdict: v,
        n: xs.length,
        rugRate: rate(xs.filter((e) => e.rugged && e.recheck !== "alive").length, xs.length),
        dumpRate: rate(xs.filter((e) => e.dumped).length, xs.length),
        peak50Rate: rate(xs.filter((e) => (e.peakPct ?? 0) >= 50).length, xs.length),
        medianLast: median(xs.flatMap((e) => (e.lastPct != null ? [e.lastPct] : []))),
      },
    ];
  });
}

export function trackCompare() {
  const now = Date.now();
  const list = all();
  const settled = list.filter((e) => settledAt(e, now));
  const models = Object.keys(MODELS) as Model[];
  const table = (xs: TrackEntry[]) => Object.fromEntries(models.map((m) => [m, compareRows(xs.filter((e) => MODELS[m](e) !== undefined), m)])) as Record<Model, CompareRow[]>;
  // С переключения сравниваем строго на одних монетах: у записи есть вердикты всех трёх моделей.
  const since = settled.filter((e) => e.pv && models.every((m) => MODELS[m](e) !== undefined));
  return {
    switchAt: switchAt(list),
    windowHours: WINDOW_MS / 3600_000,
    dumpPct: DUMP_PCT,
    open: list.filter((e) => e.pv && !settledAt(e, now)).length,
    sinceSwitch: { settled: since.length, models: table(since) },
    allTime: { settled: settled.length, models: table(settled) },
  };
}

// Запись по токену для скана, сделанного в момент `at` (бот «через 24 часа» спрашивает, чем кончилось).
export function trackEntry(id: string, at: number) {
  return all().find((e) => e.id === id && Math.abs(e.at - at) < WINDOW_MS);
}

// Вердикты, записанные в окне [from, to): их отпечатки уходят в блокчейн (proof.ts).
export function trackBetween(from: number, to: number) {
  return all().filter((e) => e.at >= from && e.at < to);
}

// ---------- Replay: витрина попаданий, но честная ----------
// Gem Replay — CLEAN/OK, которые за сутки выросли хотя бы вдвое; Rug Replay — DANGER, которые потом рухнули на 90%+
// или потеряли ликвидность. Рядом всегда счётчики промахов: сколько CLEAN/OK всё равно рухнули.
const MAX_SANE_PCT = 4900; // больше ×50 за сутки — почти всегда ошибка цены на момент скана
const MIN_LIQ0 = 2000;

export function replayFeed() {
  const list = all();
  const now = Date.now();
  const sane = (e: TrackEntry) => e.liq0 >= MIN_LIQ0 && (e.peakPct ?? 0) <= MAX_SANE_PCT;
  const good = (e: TrackEntry) => e.verdict === "CLEAN" || e.verdict === "OK";
  const view = (e: TrackEntry) => ({
    id: e.id,
    chain: e.chain,
    symbol: e.symbol,
    name: e.name ?? null,
    verdict: e.verdict,
    score: e.score,
    src: e.src,
    at: e.at,
    fdv0: e.fdv0 ?? null,
    multiple: e.peakPct != null ? Math.round((1 + e.peakPct / 100) * 10) / 10 : null,
    hoursToPeak: e.peakAt ? Math.round(((e.peakAt - e.at) / 3600_000) * 10) / 10 : null,
    lowPct: e.lowPct ?? null,
    rugged: !!e.rugged,
  });
  const gems = list.filter((e) => good(e) && sane(e) && (e.peakPct ?? 0) >= 100).sort((a, b) => (b.peakPct ?? 0) - (a.peakPct ?? 0));
  const rugs = list.filter((e) => e.verdict === "DANGER" && e.liq0 >= MIN_LIQ0 && (e.rugged || (e.lowPct ?? 0) <= -90));
  const settledGood = list.filter((e) => good(e) && e.done && now - e.at >= WINDOW_MS);
  const settledDanger = list.filter((e) => e.verdict === "DANGER" && e.done && now - e.at >= WINDOW_MS);
  return {
    gems: gems.slice(0, 60).map(view),
    rugs: rugs.slice(0, 60).map(view),
    stats: {
      good: settledGood.length,
      goodDoubled: settledGood.filter((e) => sane(e) && (e.peakPct ?? 0) >= 100).length,
      goodDumped: settledGood.filter((e) => e.dumped).length,
      danger: settledDanger.length,
      dangerDumped: settledDanger.filter((e) => e.dumped).length,
      gems: gems.length,
      rugs: rugs.length,
    },
  };
}

// Исходы токенов по адресам (для памяти кошельков: сколько из «их» токенов потом рухнули).
export function trackOutcomes(): Map<string, { dumped: boolean; rugged: boolean; done: boolean }> {
  const m = new Map<string, { dumped: boolean; rugged: boolean; done: boolean }>();
  for (const e of all()) {
    const prev = m.get(e.id);
    m.set(e.id, { dumped: !!e.dumped || !!prev?.dumped, rugged: !!e.rugged || !!prev?.rugged, done: !!e.done || !!prev?.done });
  }
  return m;
}

// Последняя запись Track Record по каждому токену (EVM в нижнем регистре) — для Brain API. Кэш на 30 с:
// пакетный запрос по сотне кошельков не должен разбирать весь журнал на каждый токен.
let indexCache: { at: number; m: Map<string, TrackEntry & { anyDumped: boolean; anyRugged: boolean }> } | null = null;
export function trackIndex() {
  if (indexCache && Date.now() - indexCache.at < 30_000) return indexCache.m;
  const m = new Map<string, TrackEntry & { anyDumped: boolean; anyRugged: boolean }>();
  for (const e of all()) {
    const k = e.id.startsWith("0x") ? e.id.toLowerCase() : e.id;
    const prev = m.get(k);
    if (!prev) m.set(k, { ...e, anyDumped: !!e.dumped, anyRugged: !!e.rugged });
    else {
      prev.anyDumped ||= !!e.dumped;
      prev.anyRugged ||= !!e.rugged;
    }
  }
  indexCache = { at: Date.now(), m };
  return m;
}

// Для ежедневного контента: лучшее попадание CLEAN/OK и самый наглядный пойманный DANGER за окно.
export function dayHighlights(fromMs: number) {
  const list = all().filter((e) => e.at >= fromMs);
  const sane = (e: TrackEntry) => e.liq0 >= MIN_LIQ0 && (e.peakPct ?? 0) <= MAX_SANE_PCT;
  const gem = list.filter((e) => (e.verdict === "CLEAN" || e.verdict === "OK") && sane(e) && (e.peakPct ?? 0) >= 100).sort((a, b) => (b.peakPct ?? 0) - (a.peakPct ?? 0))[0];
  const rug = list.filter((e) => e.verdict === "DANGER" && e.liq0 >= MIN_LIQ0 && (e.rugged || (e.lowPct ?? 0) <= -80)).sort((a, b) => (a.lowPct ?? 0) - (b.lowPct ?? 0))[0];
  const view = (e?: TrackEntry) =>
    e && { id: e.id, chain: e.chain, symbol: e.symbol, name: e.name ?? null, verdict: e.verdict, score: e.score, src: e.src, at: e.at, fdv0: e.fdv0 ?? null, peakPct: e.peakPct ?? null, lowPct: e.lowPct ?? null, rugged: !!e.rugged, hoursToPeak: e.peakAt ? Math.round(((e.peakAt - e.at) / 3600_000) * 10) / 10 : null };
  const by: Record<string, number> = {};
  for (const e of list) by[e.src] = (by[e.src] ?? 0) + 1;
  return { gem: view(gem), rug: view(rug), verdicts: list.length, bySource: by };
}
