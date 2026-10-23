// Конфиг личной бумажной стратегии холдера (Strategy builder, /paper/builder): подмножество EntryRule и ExitRule
// движка (paper-engine.ts). Без server-only: те же диапазоны и пресеты читает форма на клиенте, а сервер
// прогоняет через normalizeUserConfig всё, что пришло от пользователя и что лежит в базе. Только бумага.

export const USER_VERDICTS = ["CLEAN", "OK", "RISKY", "DANGER"] as const;
export type UserVerdict = (typeof USER_VERDICTS)[number];
export const USER_DELAYS = [0, 10, 30] as const;
export const USER_SIZE_USD = 100; // размер сделки фиксированный, как у стратегий проекта
export const USER_FAST_SLIP_PCT = 3; // быстрое исполнение: +3% проскальзывания на сторону, как у s28-s36
export const USER_NAME_MAX = 40;

// Диапазоны параметров: значения за краями зажимаются, а не отвергаются.
export const RANGES = {
  tpPct: [20, 1000],
  slPct: [5, 60],
  trailPct: [5, 80],
  trailArmPct: [0, 1000],
  partialAtPct: [10, 1000],
  partialSellPct: [10, 90],
  maxHoldMin: [30, 1440],
  liqUsd: [0, 100_000_000],
} as const;

export interface UserStrategyConfig {
  verdicts?: UserVerdict[]; // публичный v1, как у стратегий s1-s14
  verdictsV2?: UserVerdict[];
  verdictsV3?: UserVerdict[];
  minLiqUsd?: number;
  maxLiqUsd?: number;
  noPumpFun?: boolean;
  delayMin?: 0 | 10 | 30; // 10 и 30: подтверждённый вход со стандартным CONFIRM движка
  tpPct?: number;
  slPct?: number;
  trailPct?: number;
  trailArmPct?: number;
  partial?: { atPct: number; sellPct: number; breakeven?: boolean };
  maxHoldMin: number;
  fast?: boolean;
}

const clamp = (n: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, n));
const numOr = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const verdictList = (v: unknown): UserVerdict[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const out = USER_VERDICTS.filter((x) => v.includes(x));
  return out.length ? out : undefined;
};

// Из чего угодно делает допустимый конфиг: неизвестные поля выкидываются, числа зажимаются в RANGES.
// Ошибкой считается только конфиг без фильтра по вердикту (иначе это «купить всё подряд»), её возвращает userConfigError.
export function normalizeUserConfig(raw: unknown): UserStrategyConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const c: UserStrategyConfig = { maxHoldMin: Math.round(clamp(numOr(r.maxHoldMin) ?? 1440, RANGES.maxHoldMin)) };
  const v1 = verdictList(r.verdicts);
  const v2 = verdictList(r.verdictsV2);
  const v3 = verdictList(r.verdictsV3);
  if (v1) c.verdicts = v1;
  if (v2) c.verdictsV2 = v2;
  if (v3) c.verdictsV3 = v3;
  let minL = numOr(r.minLiqUsd);
  let maxL = numOr(r.maxLiqUsd);
  if (minL !== undefined) minL = Math.round(clamp(minL, RANGES.liqUsd));
  if (maxL !== undefined) maxL = Math.round(clamp(maxL, RANGES.liqUsd));
  if (minL && maxL && maxL < minL) [minL, maxL] = [maxL, minL];
  if (minL) c.minLiqUsd = minL;
  if (maxL) c.maxLiqUsd = maxL;
  if (r.noPumpFun === true) c.noPumpFun = true;
  const delay = numOr(r.delayMin);
  if (delay === 10 || delay === 30) c.delayMin = delay;
  const tp = numOr(r.tpPct);
  const sl = numOr(r.slPct);
  const trail = numOr(r.trailPct);
  if (tp !== undefined) c.tpPct = Math.round(clamp(tp, RANGES.tpPct));
  if (sl !== undefined) c.slPct = Math.round(clamp(Math.abs(sl), RANGES.slPct));
  if (trail !== undefined) {
    c.trailPct = Math.round(clamp(trail, RANGES.trailPct));
    const arm = numOr(r.trailArmPct);
    if (arm) c.trailArmPct = Math.round(clamp(arm, RANGES.trailArmPct));
  }
  const p = r.partial && typeof r.partial === "object" ? (r.partial as Record<string, unknown>) : null;
  const at = numOr(p?.atPct);
  const sell = numOr(p?.sellPct);
  if (p && at !== undefined && sell !== undefined) {
    c.partial = { atPct: Math.round(clamp(at, RANGES.partialAtPct)), sellPct: Math.round(clamp(sell, RANGES.partialSellPct)) };
    if (p.breakeven === true) c.partial.breakeven = true;
    // Тейк ниже уровня частичной фиксации сделал бы её недостижимой: такой тейк убираем.
    if (c.tpPct !== undefined && c.tpPct <= c.partial.atPct) delete c.tpPct;
  }
  if (r.fast === true) c.fast = true;
  return c;
}

export function userConfigError(c: UserStrategyConfig): string | null {
  if (!c.verdicts && !c.verdictsV2 && !c.verdictsV3) return "Pick at least one verdict (v1, v2 or v3)";
  return null;
}

export const cleanStrategyName = (n: unknown) =>
  String(n ?? "")
    .replace(/[<>&"\u2013\u2014]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, USER_NAME_MAX);

const usdShort = (n: number) => (n >= 1_000_000 ? `$${n / 1_000_000}M` : n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`);
const hold = (m: number) => (m % 60 ? `${m}m` : `${m / 60}h`);

// Описание правил одной строкой, для списка и подсказок.
export function describeUserConfig(c: UserStrategyConfig): string {
  const parts = [
    c.verdicts && `v1 ${c.verdicts.join("/")}`,
    c.verdictsV2 && `v2 ${c.verdictsV2.join("/")}`,
    c.verdictsV3 && `v3 ${c.verdictsV3.join("/")}`,
    c.minLiqUsd && c.maxLiqUsd ? `liq ${usdShort(c.minLiqUsd)}-${usdShort(c.maxLiqUsd)}` : c.minLiqUsd ? `liq ${usdShort(c.minLiqUsd)}+` : c.maxLiqUsd ? `liq under ${usdShort(c.maxLiqUsd)}` : null,
    c.noPumpFun && "no pump.fun",
    c.delayMin && `buy ${c.delayMin}m after scan if confirmed`,
    c.tpPct !== undefined && `TP +${c.tpPct}%`,
    c.slPct !== undefined && `SL -${c.slPct}%`,
    c.partial && `sell ${c.partial.sellPct}% at +${c.partial.atPct}%${c.partial.breakeven ? ", then stop at entry" : ""}`,
    c.trailPct !== undefined && `trail ${c.trailPct}%${c.trailArmPct ? ` after +${c.trailArmPct}%` : ""}`,
    `max ${hold(c.maxHoldMin)}`,
    c.fast && "fast fills",
  ];
  return parts.filter(Boolean).join(" · ");
}

// Пресеты формы: повторяют лучшие на сегодня стратегии проекта (s12, s19, скальп на CLEAN и OK).
export const USER_PRESETS: { id: string; name: string; note: string; config: UserStrategyConfig }[] = [
  {
    id: "deep",
    name: "Deep pools",
    note: "CLEAN, OK or RISKY with $100k+ liquidity, TP100 SL20, 24h. Like S12.",
    config: { verdicts: ["CLEAN", "OK", "RISKY"], minLiqUsd: 100_000, tpPct: 100, slPct: 20, maxHoldMin: 1440 },
  },
  {
    id: "v2confirmed",
    name: "v2 CLEAN confirmed",
    note: "Score v2 says CLEAN, buy 10 min after the scan if the pool is still there, TP100 SL30, 24h. Like S19.",
    config: { verdictsV2: ["CLEAN"], delayMin: 10, tpPct: 100, slPct: 30, maxHoldMin: 1440 },
  },
  {
    id: "scalp",
    name: "Scalp",
    note: "CLEAN or OK with $20k+ liquidity, quick TP30 SL15, max 2h, fast fills.",
    config: { verdicts: ["CLEAN", "OK"], minLiqUsd: 20_000, tpPct: 30, slPct: 15, maxHoldMin: 120, fast: true },
  },
];
