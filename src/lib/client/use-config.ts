"use client";
// Публичный конфиг сервера: режим сжигания, кластер, минт. Грузится один раз на вкладку.
import { useEffect, useState } from "react";
import { api } from "./api";
import type { PublicConfig } from "../types";

let cached: Promise<PublicConfig> | null = null;

export function useConfig(): PublicConfig | null {
  const [cfg, setCfg] = useState<PublicConfig | null>(null);
  useEffect(() => {
    cached ??= api<PublicConfig>("/api/config").catch((e) => {
      cached = null;
      throw e;
    });
    cached.then(setCfg).catch(() => {});
  }, []);
  return cfg;
}

export function explorerTx(sig: string, cluster: string) {
  return `https://explorer.solana.com/tx/${sig}${cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`}`;
}
