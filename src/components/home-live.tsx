"use client";
// Живой блок главной под Instant Crawl: свежие сканы, счётчики за сутки, лог роя, сжигания $CRAWLHIVE,
// лента выкаток и входы в Gem Hunter и Auto Trading. Только настоящие данные; нет данных, честное «пока пусто».
import Link from "next/link";
import { ArrowRight, Database, Flame, Gem, LineChart, Radar, Rocket, ShieldAlert, Terminal } from "lucide-react";
import { Card, CardHeader, Stat } from "@/components/ui/card";
import { VerdictPill } from "@/components/verdict";
import { solscanTx, tokFmt, type BuybackStats } from "@/components/token-shared";
import { useApi } from "@/lib/client/use-api";
import { CHAIN_LABEL } from "@/lib/scan-share";
import { CHANGELOG } from "@/lib/changelog";
import { cn, fmt, short, timeAgo } from "@/lib/utils";
import type { Signal } from "@/lib/types";

interface RecentScan {
  id: string;
  chain: string;
  symbol: string;
  score: number | null;
  verdict: string;
  at: number;
}
interface HomeStats {
  scans24h: number;
  coinsTracked: number;
  rugsFlagged: number;
}
interface UserBurns {
  count: number;
  total: number;
  items: { sig: string; tokens: number; at: number }[];
}

const CHAIN_SHORT: Record<string, string> = { solana: "SOL", robinhood: "RH", bsc: "BNB", base: "BASE" };
const sym = (s: string) => (s ? `$${s.replace(/^\$/, "").slice(0, 12)}` : "$?");
const clock = (t: number) => new Date(t).toISOString().slice(11, 19);

function CrawlerLog({ scans, signals }: { scans: RecentScan[] | null; signals: Signal[] }) {
  const lines = [
    ...(scans ?? []).map((s) => ({
      key: `scan-${s.id}-${s.at}`,
      ts: s.at,
      who: "scanner",
      text: `${sym(s.symbol)} ${CHAIN_SHORT[s.chain] ?? s.chain} ${short(s.id)}`,
      tail: `${s.verdict.replace("_", " ")}${s.score != null ? ` ${s.score}` : ""}`,
      tone: s.verdict === "DANGER" ? "text-danger" : s.verdict === "RISKY" ? "text-honey" : s.verdict === "TOO_EARLY" ? "text-muted" : "text-lime",
    })),
    ...signals
      .filter((s) => s.live)
      .map((s) => ({
        key: `sig-${s.id}`,
        ts: s.ts,
        who: s.crawlerName.slice(0, 18),
        text: `${s.kind.replace("_", " ")}${s.ticker ? ` $${s.ticker}` : ""}`,
        tail: s.redacted ? "private" : `conf ${Math.round(s.confidence * 100)}%`,
        tone: "text-sky",
      })),
  ]
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 8);
  return (
    <Card className="flex min-w-0 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-xs text-muted">
        <Terminal className="size-3.5 text-teal" />
        <span className="num">tail -f crawler.log</span>
        <span className="ml-auto size-1.5 animate-pulse rounded-full bg-lime" />
      </div>
      <div className="num min-h-[140px] flex-1 space-y-0.5 bg-bg/60 px-3 py-2 text-[11px] leading-5">
        {lines.map((l) => (
          <div key={l.key} className="flex min-w-0 gap-2">
            <span className="shrink-0 text-muted">{clock(l.ts)}</span>
            <span className="w-[4.5rem] shrink-0 truncate text-violet">{l.who}</span>
            <span className="min-w-0 flex-1 truncate">{l.text}</span>
            <span className={cn("shrink-0", l.tone)}>{l.tail}</span>
          </div>
        ))}
        {!lines.length && <div className="text-muted">waiting for events…</div>}
      </div>
      <div className="border-t border-line px-4 py-1.5 text-[10px] text-muted">Real scans and live crawler signals, times in UTC. Signal details stay private to their owner.</div>
    </Card>
  );
}

// Сжигания ручные, без расписания: только итог, последнее сжигание и ссылка на транзакцию. Никакого отсчёта.
function BurnPanel() {
  const { data: b } = useApi<BuybackStats & { userBurned?: number }>("/api/buyback", 60_000);
  const { data: u } = useApi<UserBurns>("/api/user-burn", 60_000);
  if (b && !b.configured) return null;
  const buyLast = b?.items.find((x) => x.burned > 0) ?? null;
  const userLast = u?.items[0] ?? null;
  const last =
    buyLast && (!userLast || buyLast.at >= userLast.at)
      ? { amount: buyLast.burned, at: buyLast.at, sig: buyLast.sig, what: buyLast.kind === "buyback" ? "buyback & burn" : "treasury burn" }
      : userLast
        ? { amount: userLast.tokens, at: userLast.at, sig: userLast.sig, what: "burned for Pro or Brain" }
        : null;
  const total = b ? b.burned + (b.userBurned ?? u?.total ?? 0) : null;
  return (
    <Card className="relative overflow-hidden p-4">
      <div className="pointer-events-none absolute -top-14 -right-14 size-36 rounded-full bg-coral/30 opacity-50 blur-3xl" />
      <div className="relative flex items-center gap-2 text-sm font-semibold">
        <Flame className="size-4 text-coral" /> $CRAWLHIVE burned
      </div>
      <div className="relative num mt-1 text-2xl font-bold text-coral">{total === null ? "-" : tokFmt(total)}</div>
      <div className="relative text-xs text-muted">
        {b ? (
          <>
            {b.count} buyback{b.count === 1 ? "" : "s"}
            {u ? ` · ${u.count} user burn${u.count === 1 ? "" : "s"}` : ""}
            {b.burnedPct > 0 ? ` · ${b.burnedPct.toFixed(2)}% of supply` : ""}
          </>
        ) : (
          "…"
        )}
      </div>
      <div className="relative mt-3 rounded-lg border border-line bg-bg/60 px-3 py-2 text-xs">
        {last ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-muted">Last burn</span>
            <span className="num font-semibold">{tokFmt(last.amount)}</span>
            <span className="text-muted">{last.what}</span>
            <span className="text-muted">· {timeAgo(last.at)}</span>
            <a href={solscanTx(last.sig)} target="_blank" rel="noreferrer" className="ml-auto text-honey hover:underline">
              tx
            </a>
          </div>
        ) : (
          <span className="text-muted">{b ? "No burns yet." : "Loading…"}</span>
        )}
      </div>
      <div className="relative mt-2 text-[11px] text-muted">
        Every burn is signed by hand in Phantom: the server never holds the treasury key.{" "}
        <a href="#treasury" className="text-honey hover:underline">
          Treasury
        </a>
      </div>
    </Card>
  );
}

function ShippedStrip() {
  return (
    <section className="min-w-0">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <Rocket className="size-4 text-pink" /> Shipped
        <span className="text-xs font-normal text-muted">{CHANGELOG.length} recent updates, newest first</span>
      </div>
      <ol className="flex snap-x gap-3 overflow-x-auto pb-2">
        {CHANGELOG.map((c, i) => {
          const body = (
            <>
              <span className="num text-[11px] text-muted">{c.date}</span>
              <span className="mt-0.5 line-clamp-3 text-xs font-semibold">{c.title}</span>
            </>
          );
          const cls = "flex h-full w-48 flex-col rounded-xl border border-line bg-panel px-3 py-2.5 transition-colors";
          return (
            <li key={`${c.date}-${c.title}`} className="relative shrink-0 snap-start">
              <span className="absolute top-3 right-3 size-1.5 rounded-full" style={{ background: ["#ffb020", "#f472b6", "#5eead4", "#60a5fa", "#c084fc", "#b6f23a", "#ff6a3d"][i % 7] }} />
              {c.href ? (
                c.href.startsWith("http") ? (
                  <a href={c.href} target="_blank" rel="noreferrer" className={cn(cls, "hover:border-honey/40")}>
                    {body}
                  </a>
                ) : (
                  <Link href={c.href} className={cn(cls, "hover:border-honey/40")}>
                    {body}
                  </Link>
                )
              ) : (
                <div className={cls}>{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function FeatureCard({ href, icon, title, text, tone }: { href: string; icon: React.ReactNode; title: string; text: string; tone: string }) {
  return (
    <Link href={href} className="group relative flex items-center gap-3 overflow-hidden rounded-xl border border-line bg-panel p-4 transition-colors hover:border-honey/40">
      <div className={cn("pointer-events-none absolute -top-16 -right-16 size-40 rounded-full opacity-40 blur-3xl", tone)} />
      <div className="relative grid size-10 shrink-0 place-items-center rounded-lg bg-bg/60">{icon}</div>
      <div className="relative min-w-0 flex-1">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs text-muted">{text}</div>
      </div>
      <ArrowRight className="relative size-4 shrink-0 text-honey transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

export function HomeLive({ signals }: { signals: Signal[] }) {
  const { data: scans } = useApi<RecentScan[]>("/api/scan/recent", 20_000);
  const { data: st } = useApi<HomeStats>("/api/stats", 60_000);
  return (
    <section className="mb-8 grid min-w-0 gap-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat tone="teal" icon={<Radar className="size-3.5" />} label="Scanned 24h" value={st ? fmt(st.scans24h) : "-"} hint="unique tokens with a live pool" />
        <Stat tone="violet" icon={<Database className="size-3.5" />} label="Coins tracked" value={st ? fmt(st.coinsTracked) : "-"} hint="on the Track Record" />
        <Stat
          tone="pink"
          icon={<ShieldAlert className="size-3.5" />}
          label="Rugs flagged"
          value={st ? fmt(st.rugsFlagged) : "-"}
          hint={
            <Link href="/track" className="hover:text-honey">
              DANGER or RISKY before the rug
            </Link>
          }
        />
      </div>

      {/* Список свежих сканов уже есть в InstantCrawl выше, здесь только лог и сжигания. */}
      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <CrawlerLog scans={scans} signals={signals} />
        <BurnPanel />
      </div>

      <ShippedStrip />

      <div className="grid gap-3 sm:grid-cols-2">
        <FeatureCard href="/hunt" tone="bg-pink" icon={<Gem className="size-5 text-pink" />} title="Gem Hunter" text="Find gems with the scanner, win the day. For $CRAWLHIVE holders." />
        <FeatureCard href="/paper" tone="bg-teal" icon={<LineChart className="size-5 text-teal" />} title="Auto Trading (paper)" text="The swarm trades every Launch Radar verdict with paper money, live. No real trades." />
      </div>
    </section>
  );
}
