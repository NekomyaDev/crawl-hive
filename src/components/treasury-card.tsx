"use client";
// Счётчик казны на главной: сколько SOL и ETH (Robinhood Chain) собрано за спавны и продления и куда это пойдёт.
// Цифры с сервера: сумма проверенных on-chain платежей и живой баланс кошелька казны.
import { ExternalLink, Flame, Landmark } from "lucide-react";
import { useApi } from "@/lib/client/use-api";
import { cn } from "@/lib/utils";

export interface TreasuryInfo {
  sol: number;
  payments: number;
  balance: number | null;
  solUsd: number | null;
  address: string | null;
  cluster: string;
  buyback: boolean;
  eth: number; // ETH из проверенных платежей на Robinhood Chain
  ethAddress: string | null;
  ethBalance: number | null;
  ethUsd: number | null;
  templates: Record<string, number>;
}

export const solFmt = (n: number) => String(Number(n >= 100 ? n.toFixed(1) : n >= 1 ? n.toFixed(3) : n.toFixed(4)));

export function useTreasury() {
  return useApi<TreasuryInfo>("/api/treasury", 30_000).data;
}

// Фонд байбека — живой баланс кошелька казны (его видно в блокчейне); пока баланс не пришёл — сумма платежей.
export const buybackFund = (t: TreasuryInfo) => t.balance ?? t.sol;
export const buybackEth = (t: TreasuryInfo) => t.ethBalance ?? t.eth ?? 0;
// Весь фонд в долларах: SOL плюс ETH. null — цены ещё нет.
export function buybackUsd(t: TreasuryInfo): number | null {
  if (!t.solUsd) return null;
  const eth = t.ethAddress ? buybackEth(t) : 0;
  if (eth && !t.ethUsd) return null;
  return buybackFund(t) * t.solUsd + eth * (t.ethUsd ?? 0);
}
export const usdFmt = (n: number) => (n >= 1000 ? `$${Math.round(n).toLocaleString("en-US")}` : `$${n.toFixed(2)}`);

export function TreasuryCard({ className }: { className?: string }) {
  const t = useTreasury();
  if (t && !t.address) return null; // оплата не в SOL — счётчик не нужен
  const solscan = t?.address ? `https://solscan.io/account/${t.address}${t.cluster === "mainnet-beta" ? "" : `?cluster=${t.cluster}`}` : "#";
  const fund = t ? buybackFund(t) : null;
  const eth = t?.ethAddress ? buybackEth(t) : null;
  const total = t ? buybackUsd(t) : null;
  return (
    <div id="treasury" className={cn("ring-gradient scroll-mt-6 overflow-hidden rounded-2xl bg-panel/80", className)}>
      <div className="relative flex flex-col gap-5 p-5 md:flex-row md:items-center md:justify-between lg:p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-gradient-to-br from-honey/25 via-pink/15 to-transparent blur-3xl"
        />
        <div className="relative">
          <div className="mb-1 flex items-center gap-2 text-[11px] font-medium tracking-wider text-honey uppercase">
            <Flame className="size-3.5" /> Buyback fund · collected so far
          </div>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="num text-4xl font-bold text-gradient lg:text-5xl">{fund !== null ? solFmt(fund) : "…"}</span>
            <span className="text-lg font-semibold text-fg">SOL</span>
            {eth !== null && (
              <>
                <span className="text-lg text-muted">+</span>
                <span className="num text-4xl font-bold text-gradient lg:text-5xl">{solFmt(eth)}</span>
                <span className="text-lg font-semibold text-fg">ETH</span>
              </>
            )}
            {total !== null ? <span className="num text-lg text-muted">≈ {usdFmt(total)}</span> : null}
          </div>
          <p className="mt-1 max-w-md text-sm text-muted">
            Every SOL{eth !== null ? " and every ETH on Robinhood Chain" : ""} paid for spawns and renewals goes to the project treasury and{" "}
            <span className="text-fg">will be spent on buying back the project token</span> once it launches. The balance is live from the chain.
          </p>
        </div>
        <div className="relative flex shrink-0 flex-col gap-2 md:items-end">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-line bg-bg/60 px-4 py-3 md:text-right">
              <div className="flex items-center gap-1.5 text-[11px] tracking-wider text-muted uppercase md:justify-end">
                <Landmark className="size-3.5" /> From crawlers
              </div>
              <div className="num mt-0.5 text-xl font-semibold">{t ? `${solFmt(t.sol)} SOL` : "—"}</div>
              {eth !== null && <div className="num text-sm font-semibold text-muted">{solFmt(t?.eth ?? 0)} ETH</div>}
            </div>
            <div className="rounded-xl border border-line bg-bg/60 px-4 py-3 md:text-right">
              <div className="text-[11px] tracking-wider text-muted uppercase">Payments</div>
              <div className="num mt-0.5 text-xl font-semibold">{t?.payments ?? "—"}</div>
            </div>
          </div>
          <a href={solscan} target="_blank" rel="noreferrer" className="num inline-flex items-center gap-1 text-xs text-muted hover:text-honey">
            verify {t?.address ? `${t.address.slice(0, 6)}…${t.address.slice(-6)}` : ""} on Solscan <ExternalLink className="size-3" />
          </a>
          {t?.ethAddress && (
            <a href={`https://robin.etherscan.io/address/${t.ethAddress}`} target="_blank" rel="noreferrer" className="num inline-flex items-center gap-1 text-xs text-muted hover:text-honey">
              verify {t.ethAddress.slice(0, 6)}…{t.ethAddress.slice(-4)} on Robinhood Chain <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
