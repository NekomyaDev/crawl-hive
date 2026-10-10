"use client";
// Счётчик казны на главной: сколько SOL собрано за спавны и продления и куда он пойдёт.
// Цифры с сервера: сумма проверенных on-chain платежей и живой баланс кошелька казны.
import { ExternalLink, Flame, Landmark } from "lucide-react";
import { useApi } from "@/lib/client/use-api";
import { cn } from "@/lib/utils";

export interface TreasuryInfo {
  sol: number;
  payments: number;
  balance: number | null;
  address: string | null;
  cluster: string;
  buyback: boolean;
  templates: Record<string, number>;
}

const solFmt = (n: number) => (n >= 100 ? n.toFixed(1) : n >= 1 ? n.toFixed(3) : n.toFixed(4));

export function useTreasury() {
  return useApi<TreasuryInfo>("/api/treasury", 30_000).data;
}

export function TreasuryCard({ className }: { className?: string }) {
  const t = useTreasury();
  if (t && !t.address) return null; // оплата не в SOL — счётчик не нужен
  const solscan = t?.address ? `https://solscan.io/account/${t.address}${t.cluster === "mainnet-beta" ? "" : `?cluster=${t.cluster}`}` : "#";
  return (
    <div className={cn("ring-gradient overflow-hidden rounded-2xl bg-panel/80", className)}>
      <div className="relative flex flex-col gap-5 p-5 md:flex-row md:items-center md:justify-between lg:p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-gradient-to-br from-honey/25 via-pink/15 to-transparent blur-3xl"
        />
        <div className="relative">
          <div className="mb-1 flex items-center gap-2 text-[11px] font-medium tracking-wider text-honey uppercase">
            <Flame className="size-3.5" /> Buyback treasury
          </div>
          <div className="flex items-baseline gap-2">
            <span className="num text-4xl font-bold text-gradient lg:text-5xl">{t ? solFmt(t.sol) : "…"}</span>
            <span className="text-lg font-semibold text-fg">SOL</span>
          </div>
          <p className="mt-1 max-w-md text-sm text-muted">
            collected from {t?.payments ?? 0} crawler {t?.payments === 1 ? "payment" : "payments"}. Every SOL paid for spawns and renewals goes to the project treasury and{" "}
            <span className="text-fg">will be used to buy back the project token</span> once it launches.
          </p>
        </div>
        <div className="relative flex shrink-0 flex-col gap-2 md:items-end">
          <div className="rounded-xl border border-line bg-bg/60 px-4 py-3 md:text-right">
            <div className="flex items-center gap-1.5 text-[11px] tracking-wider text-muted uppercase md:justify-end">
              <Landmark className="size-3.5" /> Treasury wallet balance
            </div>
            <div className="num mt-0.5 text-xl font-semibold">{t?.balance != null ? `${solFmt(t.balance)} SOL` : "—"}</div>
          </div>
          <a href={solscan} target="_blank" rel="noreferrer" className="num inline-flex items-center gap-1 text-xs text-muted hover:text-honey">
            {t?.address ? `${t.address.slice(0, 6)}…${t.address.slice(-6)}` : ""} on Solscan <ExternalLink className="size-3" />
          </a>
        </div>
      </div>
    </div>
  );
}
