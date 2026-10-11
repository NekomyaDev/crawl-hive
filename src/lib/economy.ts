// Параметры экономики сети. Часть из них меняется через governance (kind: "params").
import type { Tier } from "./types";

// Внутренняя валюта приложения: баланс, награды, маркет, голосования. Токена проекта пока нет.
export const CREDITS = "credits";

// Сколько нужно сжечь за спавн краулера каждого тира и что тир даёт.
export const TIERS: Record<
  Tier,
  { burn: number; label: string; maxTargets: number; minFrequency: number; rewardBoost: number }
> = {
  larva: { burn: 1_000, label: "Larva", maxTargets: 3, minFrequency: 30, rewardBoost: 1 },
  worker: { burn: 5_000, label: "Worker", maxTargets: 8, minFrequency: 10, rewardBoost: 1.15 },
  soldier: { burn: 25_000, label: "Soldier", maxTargets: 20, minFrequency: 5, rewardBoost: 1.35 },
  queen: { burn: 100_000, label: "Queen", maxTargets: 50, minFrequency: 1, rewardBoost: 1.75 },
};

export const TIER_ORDER: Tier[] = ["larva", "worker", "soldier", "queen"];

// Фаза 1 (до запуска токена): спавн оплачивается в SOL. Фаза 2: сжигание токена проекта по TIERS.burn.
// Переключается переменной PAYMENT_TOKEN=sol|token.
export const TIER_PRICE_SOL: Record<Tier, number> = {
  larva: 0.05,
  worker: 0.2,
  soldier: 0.75,
  queen: 2.5,
};

// Те же тиры в ETH для оплаты на Robinhood Chain (примерно те же доллары при ETH ≈ 23 SOL, 11.10.2026).
// Переопределяется SPAWN_PRICE_ETH.
export const TIER_PRICE_ETH: Record<Tier, number> = {
  larva: 0.002,
  worker: 0.008,
  soldier: 0.03,
  queen: 0.1,
};

// Спавн и каждое продление дают столько дней работы. Переопределяется CRAWLER_TERM_DAYS.
export const CRAWLER_TERM_DAYS = 30;

// X через Grok платный за каждый прогон, поэтому дешёвые тиры ходят в X реже, чем позволяет их частота.
export const X_MIN_INTERVAL_MIN: Record<Tier, number> = { larva: 120, worker: 60, soldier: 30, queen: 15 };

// Казна проекта: SOL за спавны в фазе 1 копится здесь; после запуска токена проекта пойдёт на его выкуп
// (решение владельца, 10.10.2026; токена пока нет, тикер не выбран).
// Переопределяется SPAWN_SOL_RECIPIENT, например на incinerator для чистого сжигания.
export const BUYBACK_TREASURY = "DgCogtUuki6MZzypK1dKHYWfHLMUnKkNUBQwo6rWTGUJ";
export const SOL_INCINERATOR = "1nc1nerator11111111111111111111111111111111";

// Новый демо-кошелёк получает стартовый баланс, чтобы можно было пощупать спавн.
export const DEMO_AIRDROP = 250_000;

// Эмиссия наград за эпоху делится между активными краулерами пропорционально репутации.
export const EPOCH_SEC = 600;
export const EPOCH_REWARD = 50_000;

// Комиссия маркетплейса: сжигается, а не уходит команде.
export const MARKET_FEE_BURN = 0.025;

// Минимальный баланс, чтобы создать предложение в governance.
export const PROPOSAL_MIN_BALANCE = 10_000;
