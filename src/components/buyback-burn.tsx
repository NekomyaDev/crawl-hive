"use client";
// «buyback & burn · crawler rewards»: таймер байбека раз в 12 часов со статистикой сжиганий и «Crawler of the day».
// Кнопки владельца видит только подписанный кошелёк казны (выплату — ещё и CREATOR_WALLET); сервер проверяет то же самое.
import { useEffect, useState } from "react";
import { DexFund } from "@/components/dex-fund";
import { ArrowUpRight, ChevronDown, ExternalLink, Flame, Loader2, Trophy } from "lucide-react";
import { BOT_URL } from "@/components/telegram-cta";
import { useWallet } from "@/components/wallet-provider";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { CopyButton, solscanAccount, solscanTx, tokFmt, type BuybackStats, type TokenInfo } from "@/components/token-shared";
import { solFmt } from "@/components/treasury-card";
import { useApi } from "@/lib/client/use-api";
import { runOwnerTx, type OwnerStep } from "@/lib/client/owner-tx";
import { post } from "@/lib/client/api";
import { cn, short } from "@/lib/utils";

const HALF_DAY = 12 * 3600_000;
const STEP_LABEL: Record<OwnerStep, string> = { prepare: "Building the route…", sign: "Confirm in Phantom…", confirm: "Verifying onchain…" };

const utc = (ts: number) => new Date(ts).toISOString().replace("T", " ").slice(0, 16) + " UTC";
const utcDay = (ts: number) => new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// Часы только на клиенте: при пререндере времени нет (null), иначе Next ругается и разметка не совпадёт.
function useNow(ms = 1000) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, ms);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [ms]);
  return now;
}

// Табло с перекидными цифрами: каждая цифра в своей плашке с линией сгиба посередине.
function FlipDigits({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-1 sm:gap-1.5" aria-label={value}>
      {value.split("").map((ch, i) =>
        ch === ":" ? (
          <span key={i} className="num px-0.5 text-2xl font-bold text-muted sm:text-3xl">
            :
          </span>
        ) : (
          <span
            key={i}
            className="num relative grid h-12 w-9 place-items-center overflow-hidden rounded-lg border border-line bg-gradient-to-b from-panel-2 to-bg text-3xl font-bold text-fg shadow-inner sm:h-14 sm:w-11 sm:text-4xl"
          >
            {ch}
            <span aria-hidden className="absolute inset-x-0 top-1/2 h-px bg-black/60" />
          </span>
        ),
      )}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] tracking-wider text-muted uppercase">{children}</div>;
}

// ---------- байбек ----------

function OwnerBuyback({ stats, reload, due }: { stats: BuybackStats; reload: () => void; due: boolean }) {
  const toast = useToast();
  const [source, setSource] = useState<"sol" | "usdc">("sol");
  const usdcMax = stats.treasuryUsdc ?? 0;
  const max = source === "usdc" ? usdcMax : Math.max(0, (stats.treasurySol ?? 0) - stats.reserveSol - (stats.dexReserveSol ?? 0));
  const unit = source === "usdc" ? "USDC" : "SOL";
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("3");
  const [step, setStep] = useState<OwnerStep | null>(null);
  const [quote, setQuote] = useState<string>("");
  const [pendingSig, setPendingSig] = useState<string | null>(null);

  // Пришло время планового байбека — подставляем весь баланс казны минус резерв на комиссии.
  useEffect(() => {
    if (due && !amount && max > 0 && source === "sol") setAmount(String(Math.floor(max * 1e4) / 1e4));
  }, [due, max, amount, source]);

  const busy = step !== null;
  const run = async (kind: "buyback" | "burn") => {
    setQuote("");
    try {
      const { result } = await runOwnerTx<
        { transaction: string; quote?: { outTokens: number; minTokens: number; priceImpactPct: number; route: string[] }; tokens?: number },
        { record: { burned: number; sol: number; usdc?: number } }
      >(
        kind === "buyback" ? "/api/buyback/build" : "/api/buyback/burn",
        kind === "buyback" ? { amountSol: Number(amount), slippageBps: Math.round(Number(slippage) * 100), source } : {},
        "/api/buyback/confirm",
        {},
        (s, built, sig) => {
          setStep(s);
          if (sig) setPendingSig(sig);
          if (built?.quote)
            setQuote(`≈ ${tokFmt(built.quote.outTokens)} bought, ${tokFmt(built.quote.minTokens)} burned now · impact ${built.quote.priceImpactPct.toFixed(2)}% · ${built.quote.route.join(" → ")}`);
          else if (built?.tokens) setQuote(`Burning ${tokFmt(built.tokens)} leftover`);
        },
      );
      setPendingSig(null);
      toast(`Burned ${tokFmt(result.record.burned)} $${stats.symbol}${result.record.usdc ? ` for ${result.record.usdc} USDC` : result.record.sol ? ` for ${solFmt(result.record.sol)} SOL` : ""}`);
      setAmount("");
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setStep(null);
    }
  };

  // RPC может не успеть увидеть транзакцию: проверяем ещё раз по той же подписи.
  const retry = async () => {
    if (!pendingSig) return;
    setStep("confirm");
    try {
      const r = await post<{ record: { burned: number } }>("/api/buyback/confirm", { signature: pendingSig });
      toast(`Recorded: ${tokFmt(r.record.burned)} $${stats.symbol} burned`);
      setPendingSig(null);
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setStep(null);
    }
  };

  const leftover = stats.owner?.leftover ?? 0;
  return (
    <div className="mt-4 rounded-xl border border-honey/40 bg-honey/[0.06] p-3">
      <div className="mb-2 flex items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-honey">Owner · buy back & burn</span>
        <span className="num text-muted">treasury {stats.treasurySol !== null ? solFmt(stats.treasurySol) : "…"} SOL · {usdcMax.toFixed(2)} USDC</span>
      </div>
      <div className="mb-2 flex gap-1.5 text-xs">
        {(["sol", "usdc"] as const).map((s) => (
          <button key={s} type="button" disabled={busy} onClick={() => { setSource(s); setAmount(""); }} className={cn("rounded-md border px-2 py-1", source === s ? "border-honey text-honey" : "border-line text-muted hover:text-honey")}>
            {s === "sol" ? "SOL · spawns" : "USDC · x402 calls"}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <div className="flex min-w-0 flex-1 items-center rounded-lg border border-line bg-bg px-3">
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(",", "."))}
            placeholder="0.00"
            className="num h-9 w-full min-w-0 bg-transparent text-sm outline-none"
            aria-label={`Amount in ${unit}`}
          />
          <span className="text-xs text-muted">{unit}</span>
        </div>
        <div className="flex items-center rounded-lg border border-line bg-bg px-2" title="Slippage">
          <input
            inputMode="decimal"
            value={slippage}
            onChange={(e) => setSlippage(e.target.value.replace(",", "."))}
            className="num h-9 w-9 bg-transparent text-right text-sm outline-none"
            aria-label="Slippage percent"
          />
          <span className="text-xs text-muted">% slip</span>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {(source === "usdc" ? [1, 5, 10] : [0.1, 0.5, 1]).map((v) => (
          <button key={v} type="button" disabled={busy || v > max} onClick={() => setAmount(String(v))} className="rounded-md border border-line px-2 py-1 text-xs text-muted hover:border-honey/60 hover:text-honey disabled:opacity-40">
            {v}
          </button>
        ))}
        <button type="button" disabled={busy || max <= 0} onClick={() => setAmount(String(Math.floor(max * 1e4) / 1e4))} className="rounded-md border border-line px-2 py-1 text-xs text-muted hover:border-honey/60 hover:text-honey disabled:opacity-40">
          {source === "usdc" ? "Max" : `Max (−${+(stats.reserveSol + (stats.dexReserveSol ?? 0)).toFixed(3)})`}
        </button>
      </div>
      <Button className="mt-3 w-full" disabled={busy || !(Number(amount) > 0)} onClick={() => run("buyback")}>
        {step ? <Loader2 className="size-4 animate-spin" /> : <Flame className="size-4" />}
        {step ? STEP_LABEL[step] : `Buy back & burn ${Number(amount) > 0 ? `${amount} ${unit}` : ""}`}
      </Button>
      {quote && <div className="num mt-2 text-[11px] text-muted">{quote}</div>}
      {pendingSig && !busy && (
        <button type="button" onClick={retry} className="mt-2 text-xs text-honey hover:underline">
          Sent but not verified yet. Verify again
        </button>
      )}
      {leftover > 0 && (
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3 text-xs">
          <span className="text-muted">
            Leftover in treasury: <span className="num text-fg">{tokFmt(leftover)}</span>
          </span>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => run("burn")}>
            Burn leftover
          </Button>
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted">One transaction: Jupiter swap, then the guaranteed minimum is burned. Anything above the minimum stays as leftover to burn.</p>
    </div>
  );
}

// Откуда деньги казны: спавны (SOL), вызовы ИИ-агентов по x402 (USDC) и сбор на DEX. Источники приходят разными
// транзакциями со своими memo, поэтому в сети не смешиваются; у каждой оплаты x402 ссылка на Solscan.
function Revenue({ rev }: { rev: NonNullable<BuybackStats["revenue"]> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 rounded-xl border border-line bg-bg/60 px-3 py-2.5">
      <Label>Treasury revenue by source</Label>
      <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
        <div>
          <div className="num text-base font-semibold">{solFmt(rev.spawns.sol)} SOL</div>
          <div className="text-[11px] text-muted">crawler spawns & renewals · {rev.spawns.payments} payments</div>
        </div>
        <div>
          <div className="num text-base font-semibold text-teal">${rev.x402.usdc.toFixed(2)} USDC</div>
          <div className="text-[11px] text-muted">
            AI agents over x402 · {rev.x402.calls} paid calls{rev.x402.calls24h ? ` · ${rev.x402.calls24h} today` : ""}
          </div>
        </div>
        {rev.dexFund && (
          <div>
            <div className="num text-base font-semibold text-pink">{solFmt(rev.dexFund.sol)} SOL</div>
            <div className="text-[11px] text-muted">DEX fund · held for DexScreener, not burned</div>
          </div>
        )}
      </div>
      <div className="mt-1.5 text-[11px] text-muted">
        x402 USDC joins the same buyback cycle as its own line{rev.x402.burnedFromUsdc ? `: ${rev.x402.burnedFromUsdc} USDC turned into burns so far` : ""}.
      </div>
      {rev.x402.recent.length > 0 && (
        <>
          <button type="button" onClick={() => setOpen((x) => !x)} className="mt-1.5 inline-flex items-center gap-1 text-xs text-teal hover:underline">
            x402 settlements <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
          </button>
          {open && (
            <ul className="mt-1 divide-y divide-line text-[11px]">
              {rev.x402.recent.map((c) => (
                <li key={c.tx} className="flex items-center justify-between gap-2 py-1">
                  <span className="num">
                    ${c.usd} · {c.route}
                  </span>
                  <a href={solscanTx(c.tx)} target="_blank" rel="noreferrer" className="num inline-flex items-center gap-1 text-muted hover:text-teal">
                    {utc(c.at)} <ExternalLink className="size-3" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function BuybackCard({ token, stats, reload }: { token: TokenInfo | null; stats: BuybackStats | null; reload: () => void }) {
  const { address, signedIn, signIn } = useWallet();
  const now = useNow();
  const [all, setAll] = useState(false);
  const nextAt = now === null ? (stats?.nextAt ?? null) : stats?.nextAt && stats.nextAt > now ? stats.nextAt : Math.floor(now / HALF_DAY) * HALF_DAY + HALF_DAY;
  const left = now !== null && nextAt !== null ? Math.max(0, Math.floor((nextAt - now) / 1000)) : null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const clock = left === null ? "--:--:--" : `${pad(Math.floor(left / 3600))}:${pad(Math.floor((left % 3600) / 60))}:${pad(left % 60)}`;
  const symbol = token?.symbol ?? "CRAWLHIVE";
  const last = stats?.last ?? null;
  // Плановое окно наступило, а байбека с его начала ещё не было.
  const paused = !!stats?.paused;
  const due = !paused && !!stats?.configured && nextAt !== null && (!last || last.at < nextAt - HALF_DAY);
  const isOwner = !!stats && address === stats.treasury;
  const list = stats?.items ?? [];

  return (
    <div id="buyback" className="relative flex scroll-mt-6 flex-col overflow-hidden rounded-2xl border border-line bg-panel p-5 lg:p-6">
      <div aria-hidden className="pointer-events-none absolute -top-20 -right-16 size-60 rounded-full bg-gradient-to-br from-coral/20 via-honey/10 to-transparent blur-3xl" />
      <div className="relative">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <Flame className="size-5 text-honey" /> buyback & burn
          </h3>
          <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", paused ? "border-honey/60 text-honey" : "border-line text-muted")}>{paused ? "paused" : "every 12 hours"}</span>
        </div>

        {paused ? (
          <div className="mt-4 rounded-xl border-2 border-honey/50 bg-honey/[0.07] px-4 py-3">
            <div className="text-lg font-bold text-honey">⏸ Burns paused</div>
            <p className="mt-1 text-sm text-fg/85">
              The person who paid for the ${symbol} DexScreener profile moved that payment to another token, and the profile was deleted. Until a new one is live, every SOL the treasury earns goes to the DexScreener profile. Burns resume right after.
            </p>
            <a href="#dexfund" className="dex-cta mt-2 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-honey to-pink px-3 py-1 text-xs font-extrabold text-black">
              🚀 Help fund the profile
            </a>
          </div>
        ) : (
          <>
            <div className="mt-4">
              <Label>Next buyback</Label>
              <div className="mt-1.5">
                <FlipDigits value={clock} />
              </div>
              <div className="num mt-1.5 text-xs text-muted">{nextAt !== null ? utc(nextAt) : "\u00a0"}</div>
            </div>

            <p className="mt-4 text-sm text-fg/80">
              Every 12 hours everything the treasury earned buys ${symbol} on the market: SOL from crawler spawns and USDC from AI agents paying per scan over x402. The bought tokens are burned in the same transaction. The supply only goes down.
            </p>
          </>
        )}

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl border border-line bg-bg/60 px-3 py-2.5">
            <Label>Last buyback</Label>
            {last ? (
              <>
                <div className="num mt-0.5 text-lg font-semibold text-honey">{tokFmt(last.burned)} burned</div>
                <div className="num text-xs text-muted">
                  {last.usdc ? `${last.usdc} USDC (x402)` : `${solFmt(last.sol)} SOL`} · {utc(last.at)}
                </div>
                <a href={solscanTx(last.sig)} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted hover:text-honey">
                  tx {short(last.sig)} <ExternalLink className="size-3" />
                </a>
              </>
            ) : (
              <div className="mt-0.5 text-sm text-muted">{stats?.configured ? "First one at the next window" : "Starts after launch"}</div>
            )}
          </div>
          <div className="rounded-xl border border-line bg-bg/60 px-3 py-2.5">
            <Label>Total burned</Label>
            <div className="num mt-0.5 text-lg font-semibold">{stats ? tokFmt(stats.burned) : "—"}</div>
            <div className="num text-xs text-lime">{stats ? `${stats.burnedPct ? stats.burnedPct.toFixed(stats.burnedPct < 0.01 ? 4 : 2) : "0.00"}% of supply` : ""}</div>
            <div className="num text-xs text-muted">{stats ? `${solFmt(stats.solSpent)} SOL${stats.usdcSpent ? ` + ${stats.usdcSpent} USDC` : ""} spent · ${stats.count} buybacks` : ""}</div>
          </div>
        </div>

        {stats?.revenue && <Revenue rev={stats.revenue} />}

        <div className="mt-3 space-y-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted">Buys from</span>
            <a href={stats ? solscanAccount(stats.treasury) : "#"} target="_blank" rel="noreferrer" className="num text-fg hover:text-honey">
              {stats ? short(stats.treasury) : "…"}
            </a>
            {stats && <CopyButton text={stats.treasury} label="treasury address" />}
          </div>
          <div className="text-muted">
            Burned onchain with the SPL burn instruction: tokens are destroyed and the supply drops, there is no dead wallet.
            {token?.mint && (
              <>
                {" "}
                <a href={solscanAccount(token.mint)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-honey hover:underline">
                  Check the supply <ExternalLink className="size-3" />
                </a>
              </>
            )}
          </div>
        </div>

        {list.length > 0 && (
          <div className="mt-3">
            <button type="button" onClick={() => setAll((x) => !x)} className="inline-flex items-center gap-1 text-sm text-honey hover:underline">
              All buybacks ({list.length}) <ChevronDown className={cn("size-4 transition-transform", all && "rotate-180")} />
            </button>
            {all && (
              <ul className="mt-2 max-h-72 divide-y divide-line overflow-y-auto rounded-xl border border-line bg-bg/40">
                {list.map((r) => (
                  <li key={r.sig} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                    <span className="num min-w-0 truncate">
                      <span className="text-honey">{tokFmt(r.burned)}</span> burned
                      <span className="text-muted">{r.kind !== "buyback" ? " · leftover" : r.usdc ? ` · ${r.usdc} USDC · x402` : ` · ${solFmt(r.sol)} SOL`}</span>
                    </span>
                    <a href={solscanTx(r.sig)} target="_blank" rel="noreferrer" className="num inline-flex shrink-0 items-center gap-1 text-muted hover:text-honey">
                      {utc(r.at)} <ExternalLink className="size-3" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {isOwner && stats?.configured && !signedIn && (
          <Button variant="outline" className="mt-4 w-full" onClick={() => signIn().catch(() => {})}>
            Sign in with the treasury wallet to run buybacks
          </Button>
        )}
        {isOwner && signedIn && stats?.configured && <OwnerBuyback stats={stats} reload={reload} due={due} />}
      </div>
    </div>
  );
}

// ---------- Crawler of the day ----------

interface BoardRow {
  crawlerId: string;
  name: string;
  owner: string;
  points: number;
  hits: number;
  signals: number;
  hitRate: number;
  eligible: boolean | null;
}
interface DaySnapshot {
  day: string;
  winner: BoardRow | null;
  top: BoardRow[];
  decidedAt: number;
  paid?: { sol: number; tx: string; at: number; by: string };
}
interface Rewards {
  board: { day: string; endsAt: number; preview: boolean; minHold: number; top: BoardRow[]; crawlers: number };
  last: DaySnapshot | null;
  yesterday: DaySnapshot | null;
  history: DaySnapshot[];
  payers: string[];
  creatorFees?: { sol: number; creator: string } | null;
}

const STEPS = [
  { n: "01", title: "Spawn", text: "Spawn a crawler and point it at your sources." },
  { n: "02", title: "Get scored", text: "Every signal is checked against the real price after it fires. The day closes at 00:00 UTC." },
  { n: "03", title: "Win", text: "The crawler with the best hits of the day wins, if its owner holds $CRAWLHIVE. A rug call costs points." },
];

function PayWinner({ snap, fees, reload }: { snap: DaySnapshot; fees?: { sol: number } | null; reload: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<OwnerStep | null>(null);
  const pay = async () => {
    try {
      await runOwnerTx<{ transaction: string }, DaySnapshot>("/api/rewards/build", { day: snap.day, amountSol: Number(amount) }, "/api/rewards/confirm", { day: snap.day }, (s) => setStep(s));
      toast(`Paid ${amount} SOL to ${short(snap.winner!.owner)}`);
      setAmount("");
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setStep(null);
    }
  };
  return (
    <div className="mt-4 rounded-xl border border-lime/40 bg-lime/[0.05] p-3">
      <div className="mb-2 text-xs font-semibold text-lime">
        Owner · pay the winner of {utcDay(Date.parse(`${snap.day}T00:00:00Z`))}
      </div>
      <div className="flex gap-2">
        <div className="flex min-w-0 flex-1 items-center rounded-lg border border-line bg-bg px-3">
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(",", "."))} placeholder="50% of the day's fees" className="num h-9 w-full min-w-0 bg-transparent text-sm outline-none" aria-label="Reward in SOL" />
          <span className="text-xs text-muted">SOL</span>
        </div>
        <Button disabled={step !== null || !(Number(amount) > 0)} onClick={pay}>
          {step ? <Loader2 className="size-4 animate-spin" /> : <Trophy className="size-4" />}
          {step ? STEP_LABEL[step] : "Pay winner"}
        </Button>
      </div>
      {fees && (
        <div className="num mt-2 text-[11px] text-muted">
          Unclaimed pump.fun creator fees: {solFmt(fees.sol)} SOL (the creator vault, shared by all coins of that creator). Half: {solFmt(fees.sol / 2)} SOL.
        </div>
      )}
    </div>
  );
}

function CrawlerOfDay() {
  const { address, signedIn } = useWallet();
  const { data: r, reload } = useApi<Rewards>(`/api/rewards?v=${signedIn ? address : ""}`, 60_000);
  const last = r?.last ?? null;
  const unpaid = [r?.yesterday, last].find((s) => s?.winner && !s.paid) ?? null;
  const isPayer = !!r && signedIn && r.payers.includes(address);
  const firstCrown = r ? r.board.endsAt : null;
  return (
    <div className="relative flex flex-col overflow-hidden rounded-2xl border border-line bg-panel p-5 lg:p-6">
      <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-16 size-64 rounded-full bg-gradient-to-tr from-lime/15 via-teal/10 to-transparent blur-3xl" />
      <div className="relative">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <Trophy className="size-5 text-lime" /> Crawler of the day
          </h3>
          <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">$CRAWLHIVE holders</span>
        </div>

        <div className="mt-4 flex items-end gap-3">
          <span className="num bg-gradient-to-br from-lime to-teal bg-clip-text text-6xl leading-none font-bold text-transparent">50%</span>
          <span className="pb-1 text-sm text-fg/80">of the day&apos;s creator fees go to the owner of the best crawler</span>
        </div>

        <ol className="mt-4 grid gap-2 sm:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n} className="rounded-xl border border-line bg-bg/60 px-3 py-2.5">
              <div className="num text-xs text-lime">{s.n}</div>
              <div className="text-sm font-semibold">{s.title}</div>
              <div className="mt-0.5 text-xs text-muted">{s.text}</div>
            </li>
          ))}
        </ol>

        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between">
            <Label>Today&apos;s top 3{r?.board.preview ? " · preview" : ""}</Label>
            <span className="num text-[11px] text-muted">{r ? `closes ${utc(r.board.endsAt).slice(11)}` : ""}</span>
          </div>
          {r && r.board.top.length > 0 ? (
            <ul className="divide-y divide-line rounded-xl border border-line bg-bg/40">
              {r.board.top.map((row, i) => (
                <li key={row.crawlerId} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={cn("num w-4 shrink-0 text-xs", i === 0 ? "text-lime" : "text-muted")}>{i + 1}</span>
                    <span className="truncate font-medium">{row.name}</span>
                    <span className="num shrink-0 text-xs text-muted">{short(row.owner)}</span>
                  </span>
                  <span className="num shrink-0 text-xs">
                    <span className={cn("font-semibold", row.points > 0 ? "text-lime" : row.points < 0 ? "text-danger" : "text-muted")}>{row.points} pts</span>
                    <span className="text-muted"> · {Math.round(row.hitRate * 100)}%</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-xl border border-dashed border-line px-3 py-3 text-sm text-muted">No signals scored today yet. The first 2x call takes the lead.</div>
          )}
          {r?.board.preview && <div className="mt-1 text-[11px] text-muted">Preview: the holder check turns on when $CRAWLHIVE is live.</div>}
        </div>

        <div className="mt-3 rounded-xl border border-line bg-bg/60 px-3 py-2.5">
          <Label>Last winner</Label>
          {last?.winner ? (
            <div className="mt-0.5 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">
                <span className="font-semibold">{last.winner.name}</span> <span className="num text-xs text-muted">{short(last.winner.owner)} · {last.winner.points} pts · {utcDay(Date.parse(`${last.day}T00:00:00Z`))}</span>
              </span>
              {last.paid ? (
                <a href={solscanTx(last.paid.tx)} target="_blank" rel="noreferrer" className="num inline-flex items-center gap-1 text-xs text-lime hover:underline">
                  paid {solFmt(last.paid.sol)} SOL <ExternalLink className="size-3" />
                </a>
              ) : (
                <span className="text-xs text-muted">payout pending</span>
              )}
            </div>
          ) : (
            <div className="mt-0.5 text-sm text-muted">{firstCrown ? `The first winner is crowned on ${utcDay(firstCrown)}, 00:00 UTC.` : "…"}</div>
          )}
        </div>

        {isPayer && unpaid && <PayWinner snap={unpaid} fees={r?.creatorFees} reload={reload} />}

        <div className="mt-4 flex flex-wrap gap-2">
          <a href="/track" className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-sm hover:border-lime/60 hover:text-lime">
            Full details <ArrowUpRight className="size-3.5" />
          </a>
          <a href={BOT_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-sm hover:border-lime/60 hover:text-lime">
            Open @crawlhivebot <ArrowUpRight className="size-3.5" />
          </a>
        </div>
        <p className="mt-3 text-[11px] text-muted">Not financial advice. Rewards are paid manually by the project and can change.</p>
      </div>
    </div>
  );
}

export function BuybackBurn({ token, stats, reload }: { token: TokenInfo | null; stats: BuybackStats | null; reload: () => void }) {
  return (
    <div className="mt-8">
      <h2 className="mb-4 text-2xl font-bold tracking-tight sm:text-3xl">
        buyback & burn <span className="text-muted">·</span> <span className="text-gradient">crawler rewards</span>
      </h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <BuybackCard token={token} stats={stats} reload={reload} />
        <CrawlerOfDay />
      </div>
      <DexFund />
    </div>
  );
}
