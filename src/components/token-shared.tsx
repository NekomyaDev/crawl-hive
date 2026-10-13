"use client";
// Общее для блока токена и блока байбека: типы ответов API, форматирование, ссылки, кнопка копирования.
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TokenInfo {
  configured: boolean;
  symbol: string;
  mint: string | null;
  treasury: string;
  decimals: number | null;
  supply: number | null;
  token2022: boolean | null;
  pump: boolean;
  market: {
    priceUsd: number | null;
    marketCap: number | null;
    fdv: number | null;
    liquidityUsd: number | null;
    change24h: number | null;
    volume24h: number | null;
    pairAddress: string | null;
    dexId: string | null;
    url: string | null;
    onCurve: boolean;
  } | null;
}

export interface BuybackRecord {
  sig: string;
  kind: "buyback" | "burn";
  sol: number;
  burned: number;
  bought: number;
  at: number;
}

export interface BuybackStats {
  configured: boolean;
  symbol: string;
  treasury: string;
  treasurySol: number | null;
  reserveSol: number;
  count: number;
  solSpent: number;
  burned: number;
  burnedPct: number;
  supply: number | null;
  last: BuybackRecord | null;
  items: BuybackRecord[];
  nextAt: number;
  owner?: { leftover: number; creatorFees: { sol: number; creator: string } | null };
}

// Количество токенов: у мемкоинов это миллионы и миллиарды.
export function tokFmt(n: number) {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export const solscanTx = (sig: string) => `https://solscan.io/tx/${sig}`;
export const solscanAccount = (a: string) => `https://solscan.io/account/${a}`;
export const jupiterUrl = (mint: string) => `https://jup.ag/swap/SOL-${mint}`;

export function CopyButton({ text, className, label }: { text: string; className?: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          },
          () => {},
        );
      }}
      className={cn("inline-flex shrink-0 items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-muted transition-colors hover:border-honey/60 hover:text-honey", className)}
      aria-label={`Copy ${label ?? "address"}`}
    >
      {done ? <Check className="size-3.5 text-lime" /> : <Copy className="size-3.5" />}
      {done ? "Copied" : "Copy"}
    </button>
  );
}
