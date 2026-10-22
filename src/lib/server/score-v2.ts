// Теневая оценка v2: считается рядом с публичной, но вердикт на сайте пока не меняет. Нужна, чтобы проверить
// вперёд то, что нашёл бэктест 22.10 (3696 закрытых записей Track Record 13-21.10, проверка на свежих 30% по времени):
// публичный CLEAN на Launch Radar ругался в ~36% случаев, а сумма штрафов v1 почти не видит главного риска свежих
// запусков. Правила нарочно простые (аддитивные очки, мало правил), чтобы не подогнать их под одну неделю данных.
// Что видно по данным:
// - молодой токен (< 24 ч) с пулом от $20k: зона выпуска с pump.fun и «большого пула» на Robinhood, 50-90% ругов;
// - пул меньше $5k: ругов мало, но и роста нет (пик +50% у 4-8%), это мёртвые деньги;
// - пул от $100k у взрослого токена: ругов 6-20%, медиана около нуля;
// - pump.fun в целом 40-45% ругов, Solana вне pump.fun и BSC заметно спокойнее;
// - кошельки токена уже были на 3+ рухнувших токенах: 45% ругов против 24% (только свежая часть данных, память
//   кошельков в SQLite ведётся с 21.10, поэтому вес правила умеренный);
// - моложе 30 минут (TOO_EARLY): 80% ругов;
// - балл v1 полезен только грубо: 80+ лучше, ниже 60 хуже, внутри 60-90 немонотонен.
// LP, концентрация держателей, снайперы и бандлы в истории есть только за последние сутки: в очки не вошли.
// Жёсткие флаги (honeypot, открытый минт, заморозка, опасный байткод) ограничивают v2 вердиктом RISKY без бэктеста:
// это защита, а не подбор.
import "server-only";
import { memDb } from "./memory-db";
import { trackEntries, trackIndex } from "./track";
import type { ScanResult } from "./scan";

export type VerdictV2 = "CLEAN" | "OK" | "RISKY" | "DANGER";
export interface ScoreV2 {
  scoreV2: number; // 0-100, выше - безопаснее
  verdictV2: VerdictV2;
  reasonsV2: string[]; // по одному на сработавшее правило, со знаком очков
  dumpWallets: number | null; // кошельки токена, уже бывшие на рухнувших токенах; null - памяти нет
}

// Очки v2. Поменяли заметно - это уже v3: старые записи Track Record считались по этим числам.
export const V2 = {
  base: 60,
  pumpFun: -10,
  calmChain: 5, // Solana вне pump.fun и BNB Chain
  liqDead: -25, // < $5k
  liqMid: -5, // $20k-100k
  liqDeep: 10, // от $100k
  youngBigPool: -25, // моложе 24 ч и пул от $20k
  tooEarly: -30, // моложе 30 минут
  v1High: 10, // балл v1 от 80
  v1Low: -10, // балл v1 ниже 60
  dumpWallets: -15, // от DUMP_WALLETS кошельков с рухнувшей историей
  hardCap: 45, // потолок при жёстких флагах: не выше RISKY
  clean: 70,
  ok: 55,
  risky: 40,
} as const;
const DUMP_WALLETS = 3;
const HARD = ["Honeypot", "Mint open", "Freeze on"];

const verdictOf = (s: number): VerdictV2 => (s >= V2.clean ? "CLEAN" : s >= V2.ok ? "OK" : s >= V2.risky ? "RISKY" : "DANGER");
const norm = (a: string) => (a.startsWith("0x") ? a.toLowerCase() : a);
export const isPumpFun = (r: ScanResult) => r.chain === "solana" && (r.id.endsWith("pump") || r.launch?.factoryLabel === "pump.fun");

// Сколько кошельков этого токена (кроме фабрик и создателей пула) были на ДРУГИХ токенах, которые потом рухнули
// (−50% или руг по Track Record). Исходы берутся только уже известные на момент скана, так что заглядывания
// в будущее нет. Один индексный запрос; кэш на 10 минут на токен: радар и повторные сканы не бьют по базе.
const DUMP_TTL = 10 * 60_000;
const dumpCache = new Map<string, { at: number; n: number | null }>();
export function priorDumpWallets(token: string): number | null {
  const t = norm(token);
  const hit = dumpCache.get(t);
  if (hit && Date.now() - hit.at < DUMP_TTL) return hit.n;
  let n: number | null = null;
  const d = memDb();
  if (d)
    try {
      const rows = d.db
        .prepare(
          `SELECT b.wallet AS wallet, b.token AS token FROM wallet_roles a JOIN wallet_roles b ON b.wallet = a.wallet AND b.token <> a.token
           WHERE a.token = ? AND a.role NOT IN ('factory', 'pool') AND b.role NOT IN ('factory', 'pool')`,
        )
        .all(t) as { wallet: string; token: string }[];
      const idx = trackIndex();
      const bad = new Set<string>();
      for (const r of rows) if (idx.get(r.token)?.anyDumped) bad.add(r.wallet);
      n = bad.size;
    } catch (e) {
      console.warn("[score-v2] wallet memory:", (e as Error).message);
    }
  if (dumpCache.size > 5_000) dumpCache.clear();
  dumpCache.set(t, { at: Date.now(), n });
  return n;
}

export function scoreV2(r: ScanResult, dumpWallets: number | null = priorDumpWallets(r.id)): ScoreV2 {
  let s: number = V2.base;
  const reasons: string[] = [];
  const add = (pts: number, why: string) => {
    s += pts;
    reasons.push(`${pts > 0 ? "+" : ""}${pts} ${why}`);
  };
  const liq = r.market?.liquidityUsd ?? 0;
  const age = r.market?.ageHours;
  const early = r.verdict === "TOO_EARLY" || (age !== undefined && age < 0.5);
  const young = early || (age !== undefined && age < 24);

  if (isPumpFun(r)) add(V2.pumpFun, "pump.fun launch");
  else if (r.chain === "solana" || r.chain === "bsc") add(V2.calmChain, r.chain === "bsc" ? "BNB Chain" : "Solana outside pump.fun");
  if (liq < 5_000) add(V2.liqDead, "pool under $5k");
  else if (liq >= 100_000) add(V2.liqDeep, "pool of $100k or more");
  else if (liq >= 20_000) add(V2.liqMid, "pool of $20k to $100k");
  if (young && liq >= 20_000) add(V2.youngBigPool, "under a day old with a $20k+ pool");
  if (early) add(V2.tooEarly, "under 30 minutes old");
  if (r.score !== null && r.verdict !== "TOO_EARLY") {
    if (r.score >= 80) add(V2.v1High, `v1 score ${r.score}`);
    else if (r.score < 60) add(V2.v1Low, `v1 score ${r.score}`);
  }
  if (dumpWallets !== null && dumpWallets >= DUMP_WALLETS) add(V2.dumpWallets, `${dumpWallets} wallets were on tokens that dumped`);
  s = Math.max(0, Math.min(100, s));
  const hard = r.factors.find((f) => HARD.includes(f.label))?.label ?? (r.xray?.findings.some((f) => f.severity === "high") ? "High risk contract power" : undefined);
  if (hard && s > V2.hardCap) {
    reasons.push(`capped at ${V2.hardCap}: ${hard.toLowerCase()}`);
    s = V2.hardCap;
  }
  return { scoreV2: s, verdictV2: verdictOf(s), reasonsV2: reasons, dumpWallets };
}

// Не роняем скан из-за теневой оценки: ошибка тут - просто нет v2.
export function safeScoreV2(r: ScanResult): ScoreV2 | undefined {
  try {
    return scoreV2(r);
  } catch (e) {
    console.warn("[score-v2]", (e as Error).message);
    return undefined;
  }
}

// ---------- «Зона ругов» для скана: живая базовая ставка из Track Record ----------
// Доля ругов среди закрытых записей (прошли сутки) того же места запуска, моложе 24 ч на момент скана и с пулом
// той же корзины. Возраст берём из записи (a0, пишется с 22.10), для старых записей - из времени выпуска в памяти
// токенов. Ложные руги (после «руга» токен жив) ругами не считаем. Пересчёт всех корзин раз в 30 минут.
const ZONE_TTL = 30 * 60_000;
export const ZONE_MIN_N = 30; // меньше записей - процент не показываем, только общий текст
const DAY = 24 * 3600_000;
type Zone = { n: number; rugged: number };
let zoneCache: { at: number; m: Map<string, Zone> } | null = null;

const venueOf = (chain: string, id: string) => (chain === "solana" && id.endsWith("pump") ? "pump" : chain);
const liqBucket = (liq: number) => (liq >= 100_000 ? "deep" : liq >= 20_000 ? "mid" : null);

function zones(): Map<string, Zone> {
  if (zoneCache && Date.now() - zoneCache.at < ZONE_TTL) return zoneCache.m;
  const m = new Map<string, Zone>();
  const now = Date.now();
  const d = memDb();
  const launchAt = d?.db.prepare("SELECT launched_at FROM launches WHERE token = ?");
  for (const e of trackEntries()) {
    if (!e.done || now - e.at < DAY) continue;
    const b = liqBucket(e.liq0);
    if (!b) continue;
    let age = e.a0;
    if (age === undefined && launchAt)
      try {
        const t = (launchAt.get(norm(e.id)) as { launched_at: number | null } | undefined)?.launched_at;
        if (t && t <= e.at) age = (e.at - t) / 3600_000;
      } catch {
        // память недоступна - запись без возраста просто пропускаем
      }
    if (age === undefined || age >= 24) continue;
    const k = `${venueOf(e.chain, e.id)}|${b}`;
    const z = m.get(k) ?? { n: 0, rugged: 0 };
    z.n++;
    if (e.rugged && e.recheck !== "alive") z.rugged++;
    m.set(k, z);
  }
  zoneCache = { at: now, m };
  return m;
}

// Базовая ставка для токена из скана: null, если он не в зоне (взрослый или пул меньше $20k).
export function rugZone(r: ScanResult): { n: number; pct: number; venue: string; pool: string } | null {
  const liq = r.market?.liquidityUsd ?? 0;
  const age = r.market?.ageHours;
  const b = liqBucket(liq);
  if (!b || !(r.verdict === "TOO_EARLY" || (age !== undefined && age < 24))) return null;
  const venue = isPumpFun(r) ? "pump" : r.chain;
  let z: Zone | undefined;
  try {
    z = zones().get(`${venue}|${b}`);
  } catch (e) {
    console.warn("[score-v2] rug zone:", (e as Error).message);
  }
  const NAME: Record<string, string> = { pump: "pump.fun", solana: "Solana", robinhood: "Robinhood Chain", bsc: "BNB Chain", base: "Base" };
  return { n: z?.n ?? 0, pct: z?.n ? Math.round((z.rugged / z.n) * 100) : 0, venue: NAME[venue] ?? venue, pool: b === "deep" ? "$100k+" : "$20k to $100k" };
}
