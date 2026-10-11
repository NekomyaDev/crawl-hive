"use client";
// Чем платит подключённый кошелёк: Phantom — SOL (или токен проекта после запуска), кошелёк EVM — ETH на Robinhood Chain.
import { useWallet } from "@/components/wallet-provider";
import { CREDITS } from "../economy";
import type { Tier } from "../types";
import { fmt } from "../utils";
import { useConfig } from "./use-config";

export function usePay() {
  const cfg = useConfig();
  const { mode } = useWallet();
  const eth = mode === "evm" && !!cfg?.eth;
  const unit = eth ? "ETH" : cfg?.payment === "sol" ? "SOL" : cfg?.payment === "token" ? (cfg.symbol ?? "token") : CREDITS;
  const transfer = eth || cfg?.payment === "sol"; // перевод монеты, а не сжигание
  return {
    cfg,
    eth,
    unit,
    // Без on-chain оплаты (локальная разработка) спавн идёт за внутренние credits.
    simulated: cfg?.payment === "simulated" && !eth,
    price: (t: Tier): number | undefined => (eth ? cfg?.eth?.prices[t] : cfg?.prices[t]),
    fmtPrice: (n: number | undefined) => (n === undefined ? "…" : transfer ? `${n}` : fmt(n)),
    signLabel: eth ? "Confirm in your wallet…" : "Confirm in Phantom…",
  };
}
