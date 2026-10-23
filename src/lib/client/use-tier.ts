"use client";
// Тариф того, кто смотрит страницу: из /api/tier по токену сессии. Не вошёл, значит Free.
// Адрес в пути только для того, чтобы useApi перечитал тариф после входа или смены кошелька (сервер его не читает).
import { useWallet } from "@/components/wallet-provider";
import type { TierApi } from "@/components/pricing-client";
import { tierAtLeast, type Tier } from "@/lib/tier-gate";
import { useApi } from "./use-api";

export function useViewerTier() {
  const { address, signedIn } = useWallet();
  const { data } = useApi<TierApi>(signedIn ? `/api/tier?w=${address}` : "/api/tier", 300_000);
  const mine = signedIn && data?.wallet === address;
  const tier: Tier = mine ? data!.tier : "free";
  // Вошёл, но тариф ещё не пришёл: не показываем замок раньше времени.
  const loading = signedIn && !mine;
  return { data, tier, loading, signedIn, at: (min: Tier) => tierAtLeast(tier, min) };
}
