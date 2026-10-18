"use client";
// Токен проекта на главной: живой график GeckoTerminal, карточка «CRAWLHIVE has a token» со статистикой
// сжиганий, строка с адресом контракта, ниже — байбек раз в 12 часов, под ним фонд казны.
// Пока TOKEN_MINT не задан, показываем «launching» без выдуманных цифр и адресов.
import { ArrowUpRight, ExternalLink, Flame, LineChart, Rocket } from "lucide-react";
import { BotOcto } from "@/components/bot-octo";
import { BuybackBurn } from "@/components/buyback-burn";
import { TreasuryCard, solFmt, usdFmt } from "@/components/treasury-card";
import { CopyButton, jupiterUrl, solscanAccount, solscanTx, tokFmt, type BuybackStats, type TokenInfo } from "@/components/token-shared";
import { useWallet } from "@/components/wallet-provider";
import { useApi } from "@/lib/client/use-api";
import { cn, timeAgo } from "@/lib/utils";

function priceFmt(n: number) {
  if (n >= 1) return `$${n.toFixed(3)}`;
  // Мелкие цены мемкоина: 4 значащие цифры, без экспоненты.
  return `$${n.toLocaleString("en-US", { maximumSignificantDigits: 4 })}`;
}

// Сеть точек и линий, как у роя на карте: фон карточки токена.
function WebLines({ className }: { className?: string }) {
  const pts: [number, number][] = [
    [20, 30], [90, 18], [160, 52], [230, 26], [300, 70], [60, 110], [140, 140], [220, 120], [290, 160], [30, 200], [110, 230], [200, 210], [280, 250],
  ];
  const links = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 2], [6, 7], [7, 3], [7, 8], [4, 8], [5, 9], [9, 10], [10, 6], [10, 11], [11, 7], [11, 12], [12, 8]];
  return (
    <svg viewBox="0 0 320 270" className={className} aria-hidden fill="none">
      {links.map(([a, b]) => (
        <line key={`${a}-${b}`} x1={pts[a][0]} y1={pts[a][1]} x2={pts[b][0]} y2={pts[b][1]} stroke="currentColor" strokeOpacity="0.35" strokeWidth="1" />
      ))}
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i % 3 ? 2.5 : 4} fill="currentColor" fillOpacity={i % 3 ? 0.6 : 0.9} />
      ))}
    </svg>
  );
}

function MarketStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-bg/60 px-3 py-2">
      <div className="text-[10px] tracking-wider text-muted uppercase">{label}</div>
      <div className={cn("num truncate text-base font-semibold", tone)}>{value}</div>
    </div>
  );
}

function Chart({ t }: { t: TokenInfo | null }) {
  const m = t?.market;
  const pool = m?.pairAddress;
  const change = m?.change24h ?? null;
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-panel">
      <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4">
        <MarketStat label="Price" value={m?.priceUsd ? priceFmt(m.priceUsd) : "-"} />
        <MarketStat label="Market cap" value={m?.marketCap ?? m?.fdv ? usdFmt((m?.marketCap ?? m?.fdv)!) : "-"} />
        <MarketStat label={m?.onCurve ? "Liquidity · curve" : "Liquidity"} value={m?.liquidityUsd ? usdFmt(m.liquidityUsd) : m?.onCurve ? "pump.fun" : "-"} />
        <MarketStat
          label="24h"
          value={change === null ? "-" : `${change > 0 ? "+" : ""}${change.toFixed(1)}%`}
          tone={change === null ? undefined : change >= 0 ? "text-lime" : "text-danger"}
        />
      </div>
      <div className="relative aspect-[4/3] min-h-[320px] w-full border-t border-line sm:aspect-[16/10] lg:aspect-auto lg:flex-1 lg:min-h-[420px]">
        {t?.configured && pool ? (
          <iframe
            title={`$${t.symbol} price chart`}
            src={`https://www.geckoterminal.com/solana/pools/${pool}?embed=1&info=0&swaps=0&grayscale=0&light_chart=0`}
            loading="lazy"
            allow="clipboard-write"
            referrerPolicy="strict-origin-when-cross-origin"
            className="absolute inset-0 size-full"
          />
        ) : (
          <div className="hive-bg absolute inset-0 grid place-items-center p-6 text-center">
            <div>
              <div className="mx-auto mb-3 grid size-12 place-items-center rounded-xl bg-honey/15 text-honey">
                {t?.configured ? <LineChart className="size-6" /> : <Rocket className="size-6" />}
              </div>
              {t?.configured ? (
                <>
                  <div className="font-semibold">The chart is warming up</div>
                  <p className="mt-1 max-w-xs text-sm text-muted">Chart services index a new pool within minutes. Until then:</p>
                  <div className="mt-3 flex flex-wrap justify-center gap-2">
                    {t.pump && (
                      <a href={`https://pump.fun/coin/${t.mint}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-sm hover:border-honey/60 hover:text-honey">
                        Chart on pump.fun <ArrowUpRight className="size-3.5" />
                      </a>
                    )}
                    <a href={`https://dexscreener.com/solana/${t.mint}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-sm hover:border-honey/60 hover:text-honey">
                      DexScreener <ArrowUpRight className="size-3.5" />
                    </a>
                  </div>
                </>
              ) : (
                <>
                  <div className="font-semibold">${t?.symbol ?? "CRAWLHIVE"} is launching</div>
                  <p className="mt-1 max-w-xs text-sm text-muted">The live chart appears here the moment the token is live. Only the address published on this site is the real one.</p>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TokenCard({ t, s }: { t: TokenInfo | null; s: BuybackStats | null }) {
  const symbol = t?.symbol ?? "CRAWLHIVE";
  const live = !!t?.configured && !!t.mint;
  return (
    <div className="ring-gradient relative flex flex-col overflow-hidden rounded-2xl bg-panel/90 p-5 lg:p-6">
      <WebLines className="pointer-events-none absolute -right-10 -bottom-6 w-[340px] text-honey/40" />
      <div aria-hidden className="pointer-events-none absolute -top-6 -right-6 rotate-12 opacity-[0.13]">
        <BotOcto size={170} />
      </div>
      <div aria-hidden className="pointer-events-none absolute -top-24 -left-16 size-64 rounded-full bg-gradient-to-br from-honey/20 via-pink/10 to-transparent blur-3xl" />
      <div className="relative">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-honey/40 bg-honey/10 px-2.5 py-1 text-[11px] font-medium text-honey">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-honey opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-honey" />
          </span>
          {live ? `$${symbol} · live on Solana` : `$${symbol} · launching`}
        </div>
        <h3 className="text-2xl font-bold tracking-tight sm:text-3xl">
          CRAWLHIVE <span className="text-gradient">has a token</span>
        </h3>
        <p className="mt-2 text-sm text-fg/80">
          Every SOL that comes into the treasury from crawler spawns goes to buybacks, and every token we buy back is burned in the same transaction. The supply only shrinks. Every burn is tracked live on this site and verifiable onchain.
        </p>

        {live ? (
          <a
            href={jupiterUrl(t!.mint!)}
            target="_blank"
            rel="noreferrer"
            className="tg-shine relative mt-4 inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-honey to-coral px-5 py-3 text-base font-bold text-black shadow-lg shadow-honey/20 transition-transform hover:-translate-y-0.5 sm:w-auto"
          >
            Trade ${symbol} <ArrowUpRight className="size-5" />
          </a>
        ) : (
          <div className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-honey/40 px-5 py-3 text-sm text-honey sm:w-auto">
            <Rocket className="size-4" /> Launching now. The contract address will appear right here.
          </div>
        )}

        <div className="mt-5 grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-line bg-bg/60 px-3 py-2">
            <div className="text-[10px] tracking-wider text-muted uppercase">SOL spent</div>
            <div className="num text-lg font-semibold">{s ? solFmt(s.solSpent) : "-"}</div>
          </div>
          <div className="rounded-xl border border-line bg-bg/60 px-3 py-2">
            <div className="text-[10px] tracking-wider text-muted uppercase">Burned</div>
            <div className="num text-lg font-semibold text-honey">{s ? tokFmt(s.burned) : "-"}</div>
          </div>
          <div className="rounded-xl border border-line bg-bg/60 px-3 py-2">
            <div className="text-[10px] tracking-wider text-muted uppercase">Of supply</div>
            <div className="num text-lg font-semibold text-lime">{s ? `${s.burnedPct >= 0.01 || !s.burnedPct ? s.burnedPct.toFixed(2) : "<0.01"}%` : "-"}</div>
          </div>
        </div>

        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between text-[11px] tracking-wider text-muted uppercase">
            <span className="flex items-center gap-1.5">
              <Flame className="size-3.5 text-honey" /> Latest burns
            </span>
            {s && s.items.length > 0 && (
              <a href="#buyback" className="normal-case tracking-normal text-honey hover:underline">
                all {s.items.length}
              </a>
            )}
          </div>
          {s && s.items.length > 0 ? (
            <ul className="divide-y divide-line rounded-xl border border-line bg-bg/40">
              {s.items.slice(0, 4).map((r) => (
                <li key={r.sig} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="num min-w-0 truncate">
                    <span className="text-honey">{tokFmt(r.burned)}</span> <span className="text-muted">burned</span>
                    {r.kind === "buyback" && <span className="text-muted"> · {solFmt(r.sol)} SOL</span>}
                  </span>
                  <a href={solscanTx(r.sig)} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs text-muted hover:text-honey">
                    {timeAgo(r.at)} <ExternalLink className="size-3" />
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-xl border border-dashed border-line px-3 py-3 text-sm text-muted">
              {live ? "The first buyback and burn shows up here with its Solscan link." : "Buybacks start right after launch, every 12 hours."}
            </div>
          )}
        </div>
        <p className="mt-4 text-[11px] text-muted">Not financial advice. Crypto tokens are volatile and can lose all value.</p>
      </div>
    </div>
  );
}

function ContractRow({ t }: { t: TokenInfo | null }) {
  if (!t?.configured || !t.mint) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-line bg-panel/60 px-4 py-3 text-sm">
        <span className="text-muted">Contract:</span>
        <span className="text-fg/80">not published yet.</span>
        <span className="text-muted">Ignore any address you see elsewhere until it appears here.</span>
      </div>
    );
  }
  const links = [
    { href: solscanAccount(t.mint), label: "Solscan" },
    { href: `https://dexscreener.com/solana/${t.mint}`, label: "DexScreener" },
    ...(t.pump ? [{ href: `https://pump.fun/coin/${t.mint}`, label: "pump.fun" }] : []),
  ];
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-panel px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-sm text-muted">Contract:</span>
        <span className="num min-w-0 truncate text-sm font-medium" title={t.mint}>
          {t.mint}
        </span>
        <CopyButton text={t.mint} label="contract address" />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {links.map((l) => (
          <a key={l.label} href={l.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted hover:text-honey">
            {l.label} <ExternalLink className="size-3" />
          </a>
        ))}
      </div>
    </div>
  );
}

export function TokenSection() {
  const { address, signedIn } = useWallet();
  const { data: t } = useApi<TokenInfo>("/api/token", 60_000);
  // Адрес в пути: после входа кошельком казны ответ приходит с данными для владельца.
  const buyback = useApi<BuybackStats>(`/api/buyback?v=${signedIn ? address : ""}`, 30_000);
  return (
    <section id="treasury" className="mb-8 scroll-mt-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
          the <span className="text-gradient">token</span>
        </h2>
        <span className="num text-sm text-muted">${t?.symbol ?? "CRAWLHIVE"} · Solana</span>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Chart t={t} />
        <TokenCard t={t} s={buyback.data} />
      </div>
      <div className="mt-4">
        <ContractRow t={t} />
      </div>
      <BuybackBurn token={t} stats={buyback.data} reload={buyback.reload} />
      <TreasuryCard className="mt-4" />
    </section>
  );
}
