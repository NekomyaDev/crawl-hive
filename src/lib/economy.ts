// Параметры экономики сети. Часть из них меняется через governance (kind: "params").
import type { Tier } from "./types";

export const TOKEN = "$CRAWL";

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

// Фаза 1 (до запуска токена): спавн оплачивается в SOL. Фаза 2: сжигание $CRAWL по TIERS.burn.
// Переключается переменной PAYMENT_TOKEN=sol|crawl.
export const TIER_PRICE_SOL: Record<Tier, number> = {
  larva: 0.05,
  worker: 0.2,
  soldier: 0.75,
  queen: 2.5,
};

// Куда уходит SOL, если не задан SPAWN_SOL_RECIPIENT: incinerator, с него вывести нельзя — это сжигание.
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
