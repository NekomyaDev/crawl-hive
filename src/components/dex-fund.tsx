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

interface Level {
  id: string;
  title: string;
  note: string;
  usd: number;
  status: "live" | "funded" | "open" | "next";
  haveUsd: number;
}
interface Fund {
  level: Level;
  levels: Level[];
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
  const lv = data.level;
  const pct = Math.min(100, (lv.haveUsd / lv.usd) * 100);
  const leftSol = data.solUsd ? Math.max(0, (lv.usd - lv.haveUsd) / data.solUsd) : null;
  const allDone = lv.status === "live" || lv.status === "funded";
  // Вся оставшаяся сумма с запасом 3% на движение цены SOL, округлённая вверх до 0.01.
  const fullSol = leftSol != null ? Math.ceil(leftSol * 1.03 * 100) / 100 : null;

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
          <Rocket className="size-4 text-honey" /> {data.paid ? `$CRAWLHIVE is DEX paid ✓ · next: ${lv.title}` : "Get $CRAWLHIVE DEX paid"}
        </span>
        <span className="num text-xs text-muted">
          {data.backers} backer{data.backers === 1 ? "" : "s"}
        </span>
      </div>
      {(
        <>
          <p className="mb-3 text-sm text-muted">
            {data.paid ? (
              <>The DexScreener profile is paid, thank you hive! Now we climb the next level: <b className="text-fg">{lv.title}</b> ({lv.note}, ${lv.usd}).</>
            ) : (
              <>Chip in for the DexScreener profile (Enhanced Token Info, ${lv.usd}): logo, banner, links and socials on every chart.</>
            )}{" "}
            SOL goes to the project treasury and is held for DEX only, apart from buybacks. When a level is funded we buy it on DexScreener and the fund moves to the next one.
          </p>
          <div className="mb-1 h-3 overflow-hidden rounded-full bg-line/60">
            <div className="h-full rounded-full bg-gradient-to-r from-honey to-pink transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="num mb-3 flex justify-between text-xs">
            <span>
              <span className="font-semibold text-honey">${lv.haveUsd.toFixed(0)}</span> <span className="text-muted">of ${lv.usd} for {lv.title} · {data.raisedSol.toFixed(3)} SOL raised in total</span>
            </span>
            {leftSol != null && <span className="text-muted">{leftSol.toFixed(2)} SOL to go</span>}
          </div>
          <button
            disabled={busy !== null}
            onClick={() => give(pick)}
            className="dex-cta mb-2 flex h-16 w-full items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-honey via-coral to-pink text-xl font-extrabold text-black shadow-[0_0_40px_rgba(255,176,32,.45)] transition-transform hover:scale-[1.015] active:scale-[.99] disabled:opacity-60"
          >
            {busy === pick ? "Confirm in Phantom…" : <>🚀 Donate {pick} SOL {data.paid ? `for ${lv.title}` : "to get DEX paid"}</>}
          </button>
          {!allDone && fullSol != null && fullSol >= 0.01 && (
            <button
              disabled={busy !== null}
              onClick={() => give(fullSol)}
              className="mb-2 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border-2 border-honey bg-honey/10 text-base font-extrabold text-honey transition-colors hover:bg-honey/20 disabled:opacity-60"
            >
              {busy === fullSol ? "Confirm in Phantom…" : <>💎 Pay it all: {fullSol} SOL for {lv.title}</>}
            </button>
          )}
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
          <ol className="mt-3 grid gap-1.5 sm:grid-cols-5">
            {data.levels.map((l, i) => (
              <li
                key={l.id}
                className={cn(
                  "rounded-lg border px-2 py-1.5 text-[11px]",
                  l.status === "live" ? "border-lime/50 bg-lime/10 text-lime" : l.status === "funded" ? "border-teal/50 bg-teal/10 text-teal" : l.id === lv.id ? "border-honey bg-honey/10 text-honey" : "border-line text-muted",
                )}
              >
                <div className="font-semibold">
                  {i + 1}. {l.title}
                </div>
                <div className="num">{l.status === "live" ? "✓ live on DEX" : l.status === "funded" ? "✓ funded" : `$${l.usd}`}</div>
              </li>
            ))}
          </ol>
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

// Кнопка «помоги с DEX» для бокового меню и шапки: ведёт к карточке сбора и показывает текущий уровень.
export function DexFundButton({ compact }: { compact?: boolean }) {
  const { data } = useApi<Fund>("/api/dexfund", 60000);
  if (!data) return null;
  const pct = Math.min(100, (data.level.haveUsd / data.level.usd) * 100);
  if (compact)
    return (
      <a href="/#dexfund" className="rounded-md bg-gradient-to-r from-honey to-pink px-2 py-1 text-[11px] font-extrabold text-black">
        🚀 DEX
      </a>
    );
  return (
    <a href="/#dexfund" className="dex-cta mt-2 block rounded-xl bg-gradient-to-r from-honey via-coral to-pink p-[2px] shadow-[0_0_24px_rgba(255,107,157,.35)]">
      <span className="block rounded-[10px] bg-bg/85 px-3 py-2.5 transition-colors hover:bg-bg/70">
        <span className="flex items-center gap-2 text-sm font-extrabold text-white">🚀 {data.paid ? `DEX: ${data.level.title}` : "Get us DEX paid"}</span>
        <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-line/70">
          <span className="block h-full rounded-full bg-gradient-to-r from-honey to-pink" style={{ width: `${Math.max(pct, 3)}%` }} />
        </span>
        <span className="num mt-1 block text-[10px] text-muted">
          ${data.level.haveUsd.toFixed(0)} of ${data.level.usd} · donate SOL
        </span>
      </span>
    </a>
  );
}
