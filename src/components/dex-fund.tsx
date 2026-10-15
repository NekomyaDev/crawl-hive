"use client";
// Сбор на DEX: любой с Phantom одной кнопкой скидывается на оплату профиля $CRAWLHIVE в DexScreener.
// Сервер собирает перевод на казну с memo, Phantom подписывает и отправляет, сервер засчитывает взнос по сети.
import { useState } from "react";
import { Rocket } from "lucide-react";
import { useApi } from "@/lib/client/use-api";
import { api, post } from "@/lib/client/api";
import { phantom } from "@/components/wallet-provider";
import { useToast } from "@/components/ui/toast";
import { cn, short, timeAgo } from "@/lib/utils";

interface Fund {
  goalUsd: number;
  solUsd: number | null;
  raisedSol: number;
  raisedUsd: number | null;
  backers: number;
  paid: boolean;
  treasury: string;
  recent: { wallet: string; sol: number; at: number; sig: string }[];
}

const AMOUNTS = [0.05, 0.1, 0.25, 0.5, 1];

export function DexFund() {
  const { data, reload } = useApi<Fund>("/api/dexfund", 30000);
  const toast = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  const [pick, setPick] = useState(0.1);
  if (!data) return null;
  const pct = data.raisedUsd != null ? Math.min(100, (data.raisedUsd / data.goalUsd) * 100) : 0;
  const leftSol = data.solUsd && data.raisedUsd != null ? Math.max(0, (data.goalUsd - data.raisedUsd) / data.solUsd) : null;

  const give = async (sol: number) => {
    const p = phantom();
    if (!p) return toast("Open the site in a browser with Phantom");
    setBusy(sol);
    try {
      const { publicKey } = await p.connect();
      const built = await api<{ transaction: string }>(`/api/dexfund?build=${sol}&wallet=${publicKey.toString()}`);
      const { Transaction } = await import("@solana/web3.js");
      const tx = Transaction.from(Uint8Array.from(atob(built.transaction), (c) => c.charCodeAt(0)));
      const { signature } = await p.signAndSendTransaction(tx);
      // Транзакция доходит до RPC сервера не сразу: пробуем засчитать несколько раз.
      let err = "";
      for (let i = 0; i < 5; i++) {
        try {
          await post("/api/dexfund", { signature });
          err = "";
          break;
        } catch (e) {
          err = (e as Error).message;
          if (!/not found/i.test(err)) break;
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
      if (err) throw new Error(err);
      toast(`Thank you! ${sol} SOL added to the DEX fund 🐙`);
      reload();
    } catch (e) {
      const m = (e as Error).message ?? "";
      toast(/reject|cancel|denied|4001/i.test(m) ? "You cancelled in Phantom" : m);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div id="dexfund" className="mt-4 scroll-mt-20 overflow-hidden rounded-xl border-2 border-honey/50 bg-gradient-to-br from-honey/10 via-panel to-pink/10 p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Rocket className="size-4 text-honey" /> {data.paid ? "$CRAWLHIVE is DEX paid ✓" : "Get $CRAWLHIVE DEX paid"}
        </span>
        <span className="num text-xs text-muted">
          {data.backers} backer{data.backers === 1 ? "" : "s"}
        </span>
      </div>
      {data.paid ? (
        <p className="text-sm text-muted">The DexScreener profile is paid. Thank you, hive! Everything sent from now on goes to buyback & burn.</p>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted">
            Chip in for the DexScreener profile (Enhanced Token Info, ${data.goalUsd}): logo, banner, links and socials on every chart. SOL goes to the project treasury and is held for the
            profile; anything above the goal goes to buyback & burn.
          </p>
          <div className="mb-1 h-3 overflow-hidden rounded-full bg-line/60">
            <div className="h-full rounded-full bg-gradient-to-r from-honey to-pink transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="num mb-3 flex justify-between text-xs">
            <span>
              <span className="font-semibold text-honey">${data.raisedUsd != null ? data.raisedUsd.toFixed(0) : "—"}</span> <span className="text-muted">of ${data.goalUsd} · {data.raisedSol.toFixed(3)} SOL</span>
            </span>
            {leftSol != null && <span className="text-muted">{leftSol.toFixed(2)} SOL to go</span>}
          </div>
          <button
            disabled={busy !== null}
            onClick={() => give(pick)}
            className="dex-cta mb-2 flex h-16 w-full items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-honey via-coral to-pink text-xl font-extrabold text-black shadow-[0_0_40px_rgba(255,176,32,.45)] transition-transform hover:scale-[1.015] active:scale-[.99] disabled:opacity-60"
          >
            {busy !== null ? "Confirm in Phantom…" : <>🚀 Donate {pick} SOL to get DEX paid</>}
          </button>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {AMOUNTS.map((a) => (
              <button
                key={a}
                disabled={busy !== null}
                onClick={() => setPick(a)}
                className={cn("num rounded-lg px-3 py-1 text-sm font-semibold transition-colors disabled:opacity-50", a === pick ? "bg-honey/20 text-honey ring-1 ring-honey" : "text-muted hover:text-honey")}
              >
                {a} SOL
              </button>
            ))}
          </div>
        </>
      )}
      {data.recent.length > 0 && (
        <ul className="mt-3 space-y-0.5 text-[11px] text-muted">
          {data.recent.slice(0, 4).map((g) => (
            <li key={g.sig}>
              <a href={`https://solscan.io/tx/${g.sig}`} target="_blank" rel="noreferrer" className="num hover:text-honey">
                {short(g.wallet)} · {g.sol} SOL · {timeAgo(g.at)}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Кнопка «помоги с DEX» для бокового меню и шапки: ведёт к карточке сбора, прячется, когда профиль оплачен.
export function DexFundButton({ compact }: { compact?: boolean }) {
  const { data } = useApi<Fund>("/api/dexfund", 60000);
  if (!data || data.paid) return null;
  const pct = data.raisedUsd != null ? Math.min(100, (data.raisedUsd / data.goalUsd) * 100) : 0;
  if (compact)
    return (
      <a href="/#dexfund" className="rounded-md bg-gradient-to-r from-honey to-pink px-2 py-1 text-[11px] font-extrabold text-black">
        🚀 DEX
      </a>
    );
  return (
    <a href="/#dexfund" className="dex-cta mt-2 block rounded-xl bg-gradient-to-r from-honey via-coral to-pink p-[2px] shadow-[0_0_24px_rgba(255,107,157,.35)]">
      <span className="block rounded-[10px] bg-bg/85 px-3 py-2.5 transition-colors hover:bg-bg/70">
        <span className="flex items-center gap-2 text-sm font-extrabold text-white">🚀 Get us DEX paid</span>
        <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-line/70">
          <span className="block h-full rounded-full bg-gradient-to-r from-honey to-pink" style={{ width: `${Math.max(pct, 3)}%` }} />
        </span>
        <span className="num mt-1 block text-[10px] text-muted">
          ${data.raisedUsd != null ? data.raisedUsd.toFixed(0) : "0"} of ${data.goalUsd} · donate SOL
        </span>
      </span>
    </a>
  );
}
