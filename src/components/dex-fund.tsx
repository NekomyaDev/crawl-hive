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

const AMOUNTS = [0.05, 0.1, 0.25, 0.5];

export function DexFund() {
  const { data, reload } = useApi<Fund>("/api/dexfund", 30000);
  const toast = useToast();
  const [busy, setBusy] = useState<number | null>(null);
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
    <div className="mt-4 overflow-hidden rounded-xl border border-honey/40 bg-gradient-to-br from-honey/10 via-panel to-pink/10 p-4">
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
          <div className="flex flex-wrap gap-2">
            {AMOUNTS.map((a) => (
              <button
                key={a}
                disabled={busy !== null}
                onClick={() => give(a)}
                className={cn("rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50", a === 0.1 ? "bg-honey text-black hover:bg-honey/90" : "border border-honey/50 text-honey hover:bg-honey/10")}
              >
                {busy === a ? "Confirm in Phantom…" : `${a} SOL`}
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
