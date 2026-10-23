"use client";
// Rug Feed: монеты, которые зарутали или рухнули после скана, свежие сверху. Сначала то, о чём сканер
// предупредил заранее (DANGER, RISKY, TOO_EARLY), промахи (CLEAN/OK) тоже в ленте, но приглушённо.
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { Skull } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardHeader, Stat } from "@/components/ui/card";
import { VerdictPill, pct } from "@/components/verdict";
import { useApi } from "@/lib/client/use-api";
import { cn, fmt, short, timeAgo } from "@/lib/utils";

type Win = "24h" | "7d" | "all";
interface Item {
  id: string;
  chain: string;
  symbol: string;
  name: string | null;
  verdict: string;
  score: number | null;
  model: "v1" | "v2";
  src: string;
  at: number;
  eventAt: number;
  hoursToRug: number | null;
  kind: "rug" | "dump";
  rugBy: "liq" | "gone" | null;
  lowPct: number | null;
  liqPulledPct: number | null;
  liq0: number;
  liqNow: number | null;
  peakPct: number | null;
  warned: boolean;
}
interface Stats {
  total: number;
  rugs: number;
  dumps: number;
  warned: number;
  missed: number;
  warnedPct: number | null;
  medianHoursToRug: number | null;
}
interface Data {
  updatedAt: number;
  chains: string[];
  stats: Record<string, Record<Win, Stats>>;
  items: Item[];
  minLiq0: number;
}

const DAY = 24 * 3600_000;
const WIN_MS: Record<Win, number> = { "24h": DAY, "7d": 7 * DAY, all: Infinity };
const WIN_LABEL: Record<Win, string> = { "24h": "24h", "7d": "7 days", all: "All time" };
const CHAIN_LABEL: Record<string, string> = { all: "All chains", solana: "Solana", robinhood: "Robinhood", bsc: "BSC", base: "Base" };

// Часы в короткую подпись: 25 мин, 3.4 ч, 2 д.
function dur(h: number | null) {
  if (h == null) return "-";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
  if (h < 48) return `${Math.round(h * 10) / 10}h`;
  return `${Math.round(h / 24)}d`;
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("rounded-md border px-2.5 py-1 text-xs transition-colors", on ? "border-danger/50 bg-danger/10 text-danger" : "border-line text-muted hover:text-fg")}
    >
      {children}
    </button>
  );
}

function What({ r }: { r: Item }) {
  if (r.kind === "rug")
    return (
      <span className="font-semibold text-danger">
        {r.rugBy === "gone" ? "rugged · pools gone" : `rugged · liquidity ${r.liqPulledPct != null ? `-${r.liqPulledPct}%` : "pulled"}`}
      </span>
    );
  return <span className="font-semibold text-danger">dumped {pct(r.lowPct)}</span>;
}

function RugRow({ r }: { r: Item }) {
  return (
    <li className={cn("px-4 py-3 text-sm", r.warned ? "bg-danger/[0.03]" : "opacity-70")}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="flex min-w-0 items-center gap-2">
          <Link href={`/scan/${r.id}`} className="truncate font-semibold hover:text-honey">${r.symbol}</Link>
          <span className="num text-[11px] text-muted">{CHAIN_LABEL[r.chain] ?? r.chain} · {short(r.id)}</span>
          {r.warned ? (
            <span className="whitespace-nowrap rounded bg-lime/15 px-1.5 py-px text-[10px] font-bold tracking-wide text-lime">WE WARNED</span>
          ) : (
            <span className="whitespace-nowrap rounded border border-line px-1.5 py-px text-[10px] font-semibold tracking-wide text-muted">MISSED</span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs">
          <VerdictPill verdict={r.verdict} score={r.score} />
          <What r={r} />
        </span>
      </div>
      <div className="num mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted">
        <span>scanned {timeAgo(r.at)}</span>
        {r.kind === "rug" && <span>rug {dur(r.hoursToRug)} after scan</span>}
        <span>low {pct(r.lowPct)}</span>
        <span>peak before {r.peakPct != null ? pct(r.peakPct) : "none"}</span>
        <span>liquidity ${fmt(r.liq0)} → {r.liqNow != null ? `$${fmt(r.liqNow)}` : "-"}</span>
        <span>score {r.model}</span>
      </div>
    </li>
  );
}

export default function RugsPage() {
  const { data } = useApi<Data>("/api/rugs", 60000);
  const [chain, setChain] = useState("all");
  const [win, setWin] = useState<Win>("7d");
  const [warnedOnly, setWarnedOnly] = useState(false);

  const st = data?.stats[chain];
  const cur = st?.[win];
  const rows = useMemo(() => {
    // Время берём из ответа сервера: Date.now() в клиентском компоненте ломает пререндер (cacheComponents).
    const now = data?.updatedAt ?? 0;
    return (data?.items ?? []).filter((r) => (chain === "all" || r.chain === chain) && now - r.eventAt < WIN_MS[win] && (!warnedOnly || r.warned));
  }, [data, chain, win, warnedOnly]);

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Skull className="size-7 text-danger" /> Rug Feed
          </span>
        }
        sub="Coins that rugged or dumped after someone scanned them, live from the Track Record. A rug means liquidity was pulled with the price, or every pool vanished. A dump means the price fell 50% below the scan price within 24 hours. We show the verdict we gave before it happened."
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Flagged before it happened"
          value={cur?.warnedPct != null ? `${cur.warnedPct}%` : "-"}
          hint={cur ? `${cur.warned} of ${cur.total} were DANGER, RISKY or TOO EARLY · ${WIN_LABEL[win].toLowerCase()}` : undefined}
          tone="lime"
        />
        <Stat label="Rugs and dumps, 24h" value={st ? fmt(st["24h"].total) : "-"} hint={st ? `${st["24h"].rugs} rugs · ${st["24h"].warned} warned in advance` : undefined} tone="coral" />
        <Stat label="Rugs and dumps, 7 days" value={st ? fmt(st["7d"].total) : "-"} hint={st ? `${st["7d"].rugs} rugs · ${st["7d"].warned} warned in advance` : undefined} tone="pink" />
        <Stat label="Median scan to rug" value={dur(cur?.medianHoursToRug ?? null)} hint={cur ? `over ${cur.rugs} confirmed rugs · ${WIN_LABEL[win].toLowerCase()}` : undefined} tone="honey" />
      </div>

      <Card>
        <CardHeader
          title="Latest rugs and dumps"
          sub={data ? `Newest first · updates every minute · last update ${timeAgo(data.updatedAt)}` : "Loading…"}
        />
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          {["all", ...(data?.chains ?? [])].map((c) => (
            <Chip key={c} on={chain === c} onClick={() => setChain(c)}>{CHAIN_LABEL[c] ?? c}</Chip>
          ))}
          <span className="mx-1 hidden h-4 w-px bg-line sm:block" />
          {(["24h", "7d", "all"] as Win[]).map((w) => (
            <Chip key={w} on={win === w} onClick={() => setWin(w)}>{WIN_LABEL[w]}</Chip>
          ))}
          <span className="mx-1 hidden h-4 w-px bg-line sm:block" />
          <Chip on={warnedOnly} onClick={() => setWarnedOnly(!warnedOnly)}>We warned only</Chip>
        </div>
        {!data ? (
          <p className="px-4 py-6 text-center text-sm text-muted">Loading the feed…</p>
        ) : rows.length ? (
          <ul className="divide-y divide-line/60">
            {rows.map((r) => (
              <RugRow key={r.id + r.at} r={r} />
            ))}
          </ul>
        ) : (
          <p className="px-4 py-6 text-center text-sm text-muted">No rugs or dumps here for this filter. Quiet is good.</p>
        )}
      </Card>

      <p className="mt-4 text-[11px] text-muted">
        Misses are shown on purpose: CLEAN or OK coins that rugged anyway stay in the feed, just dimmed. One row per token, latest scan. Coins under ${fmt(data?.minLiq0 ?? 1000)} starting liquidity are left out. Full method on the <Link href="/track" className="hover:text-honey underline">Track Record</Link> page.
      </p>
    </>
  );
}
