// Спецификация краулера: значения по умолчанию и проверка. Общий модуль для клиента и сервера.
import { SIGNAL_KINDS, type CrawlerSpec, type SignalKind, type Source } from "./types";

export const SPEC_LIMITS = {
  instructions: 1200,
  keywords: 20,
  keywordLen: 60,
  horizonMin: [15, 1440] as const,
  hitThresholdPct: [5, 500] as const,
};

// Какие типы сигналов вообще умеет выдавать каждый источник.
export const KINDS_BY_SOURCE: Record<Source, SignalKind[]> = {
  x: ["kol_call", "mention_spike", "new_pair", "whale_buy"],
  telegram: ["kol_call", "mention_spike", "new_pair"],
  onchain: ["new_pair", "whale_buy", "mention_spike"],
  docs: ["doc_update"],
};

export const SIGNAL_KIND_LABEL: Record<SignalKind, string> = {
  mention_spike: "Mention spike",
  new_pair: "New pair",
  whale_buy: "Whale buy",
  kol_call: "KOL call",
  doc_update: "Docs update",
};

export function defaultSpec(source: Source): CrawlerSpec {
  return {
    instructions: "",
    keywords: [],
    excludeKeywords: [],
    signalKinds: [...KINDS_BY_SOURCE[source]],
    minConfidence: 0.5,
    onchain: { feeds: ["profiles", "boosts"], minLiquidityUsd: 5_000, minVolume1hUsd: 1_000, maxFdvUsd: 0, maxAgeHours: 24 },
    x: { imageUnderstanding: false },
    outcome: { horizonMin: 60, hitThresholdPct: 20 },
  };
}

function words(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  return [...new Set(arr.map((x) => String(x).trim()).filter(Boolean))]
    .slice(0, SPEC_LIMITS.keywords)
    .map((x) => x.slice(0, SPEC_LIMITS.keywordLen));
}

const num = (v: unknown, def: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

// Нормализует присланную спецификацию: обрезает лишнее, ставит значения по умолчанию.
// Бросает Error с понятным текстом, если спецификация противоречива.
export function normalizeSpec(input: Partial<CrawlerSpec> | undefined, source: Source): CrawlerSpec {
  const d = defaultSpec(source);
  const i = input ?? {};
  const allowed = KINDS_BY_SOURCE[source];
  const kinds = (Array.isArray(i.signalKinds) ? i.signalKinds : d.signalKinds).filter(
    (k): k is SignalKind => SIGNAL_KINDS.includes(k as SignalKind) && allowed.includes(k as SignalKind),
  );
  if (!kinds.length) throw new Error("Pick at least one signal type this source can produce");
  const feeds = (Array.isArray(i.onchain?.feeds) ? i.onchain!.feeds : d.onchain.feeds).filter((f) =>
    ["profiles", "boosts", "search"].includes(f),
  ) as CrawlerSpec["onchain"]["feeds"];
  const keywords = words(i.keywords);
  if (source === "onchain" && feeds.includes("search") && !keywords.length)
    throw new Error("The on-chain search feed needs at least one keyword");
  return {
    instructions: String(i.instructions ?? "").trim().slice(0, SPEC_LIMITS.instructions),
    keywords,
    excludeKeywords: words(i.excludeKeywords),
    signalKinds: [...new Set(kinds)],
    minConfidence: num(i.minConfidence, d.minConfidence, 0, 0.99),
    onchain: {
      feeds: feeds.length ? feeds : d.onchain.feeds,
      minLiquidityUsd: num(i.onchain?.minLiquidityUsd, d.onchain.minLiquidityUsd, 0, 1e9),
      minVolume1hUsd: num(i.onchain?.minVolume1hUsd, d.onchain.minVolume1hUsd, 0, 1e9),
      maxFdvUsd: num(i.onchain?.maxFdvUsd, d.onchain.maxFdvUsd, 0, 1e12),
      maxAgeHours: num(i.onchain?.maxAgeHours, d.onchain.maxAgeHours, 0, 24 * 30),
    },
    x: { imageUnderstanding: !!i.x?.imageUnderstanding },
    outcome: {
      horizonMin: Math.round(num(i.outcome?.horizonMin, d.outcome.horizonMin, ...SPEC_LIMITS.horizonMin)),
      hitThresholdPct: num(i.outcome?.hitThresholdPct, d.outcome.hitThresholdPct, ...SPEC_LIMITS.hitThresholdPct),
    },
  };
}
