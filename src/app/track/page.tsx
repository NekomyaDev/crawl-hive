"use client";
// Track Record: сбылись ли вердикты. Каждый скан сутки сверяется с реальной ценой; показываем и попадания,
// и промахи — без этого страница ничего не стоит.
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Card, CardHeader, Stat } from "@/components/ui/card";
import { VerdictPill, pct } from "@/components/verdict";
import { ProofCard } from "@/components/proof-card";
import { useApi } from "@/lib/client/use-api";
import { cn, fmt, short, timeAgo } from "@/lib/utils";

interface Row {
  id: string;
  chain: string;
  symbol: string;
  verdict: string;
  score: number | null;
  src: string;
  at: number;
  peakPct: number | null;
  lowPct: number | null;
  lastPct: number | null;
  done: boolean;
  dumped: boolean;
  rugged: boolean;
}
interface By {
  verdict: string;
  tracked: number;
  settled: number;
  dumped: number;
  rugged: number;
  medianPeak: number | null;
}
interface Data {
  since: number | null;
  total: number;
  by: By[];
  warned: Row[];
  missed: Row[];
  recent: Row[];
  windowHours: number;
  dumpPct: number;
  signals: { scored: number; hits: number; medianPeak: number | null; recent: { crawlerId: string; crawlerName: string; kind: string; ts: number; status: string; peakPct: number | null; changePct: number | null; jev: number | null }[] };
}

const SRC: Record<string, string> = { scan: "user scan", crawler: "crawler", radar: "radar", agent: "agent" };
const share = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);

function Outcome({ r }: { r: Row }) {
  if (r.rugged) return <span className="font-semibold text-danger">rugged</span>;
  if (r.dumped) return <span className="font-semibold text-danger">dumped {pct(r.lowPct)}</span>;
  if (!r.done) return <span className="text-muted">watching… {pct(r.lastPct)}</span>;
  return <span className="text-lime">held · peak {pct(r.peakPct)}</span>;
}

function Rows({ rows, empty }: { rows: Row[]; empty: string }) {
  if (!rows.length) return <p className="px-4 py-6 text-center text-sm text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line/60">
      {rows.map((r) => (
        <li key={r.id + r.at} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
          <span className="min-w-0">
            <Link href={`/scan/${r.id}`} className="font-semibold hover:text-honey">${r.symbol}</Link>
            <span className="num ml-2 text-[11px] text-muted">{short(r.id)} · {SRC[r.src] ?? r.src} · {timeAgo(r.at)}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2 text-xs">
            <VerdictPill verdict={r.verdict} score={r.score} />
            <Outcome r={r} />
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function TrackPage() {
  const { data } = useApi<Data>("/api/track", 60000);
  const by = new Map((data?.by ?? []).map((b) => [b.verdict, b]));
  const group = (vs: string[]) => {
    const xs = vs.map((v) => by.get(v)).filter(Boolean) as By[];
    return { settled: xs.reduce((n, b) => n + b.settled, 0), dumped: xs.reduce((n, b) => n + b.dumped, 0), tracked: xs.reduce((n, b) => n + b.tracked, 0) };
  };
  const bad = group(["DANGER"]);
  const good = group(["CLEAN", "OK"]);
  const sig = data?.signals;

  return (
    <>
      <PageHeader
        title="Track Record"
        sub={`Every verdict is checked against the real price for ${data?.windowHours ?? 24} hours after the scan. A token counts as dumped when it falls ${Math.abs(data?.dumpPct ?? 50)}% below the scan price or its liquidity is pulled. Hits and misses, nothing hidden, and every record is committed to Solana.`}
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Verdicts tracked" value={data ? fmt(data.total) : "-"} hint={data?.since ? `since ${new Date(data.since).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "starting now"} tone="honey" />
        <Stat label="DANGER that dumped" value={share(bad.dumped, bad.settled) == null ? "-" : `${share(bad.dumped, bad.settled)}%`} hint={`${bad.dumped} of ${bad.settled} settled`} tone="coral" />
        <Stat label="CLEAN / OK that dumped" value={share(good.dumped, good.settled) == null ? "-" : `${share(good.dumped, good.settled)}%`} hint={`${good.dumped} of ${good.settled} settled`} tone="teal" />
        <Stat
          label="Crawler signals hit"
          value={sig?.scored ? `${share(sig.hits, sig.scored)}%` : "-"}
          hint={sig ? `${sig.hits} of ${sig.scored} · median peak ${pct(sig.medianPeak)}` : undefined}
          tone="lime"
        />
      </div>

      <ProofCard />

      <Card className="mb-5">
        <CardHeader title="By verdict" sub="Settled = 24 hours passed since the scan, rugs included. The gap between DANGER and CLEAN is what the scanner is worth." />
        <div className="space-y-3 p-4">
          {(data?.by ?? []).map((b) => {
            const s = share(b.dumped, b.settled);
            return (
              <div key={b.verdict} className="grid grid-cols-[92px_1fr_auto] items-center gap-3 text-sm">
                <VerdictPill verdict={b.verdict} />
                <div className="h-2.5 overflow-hidden rounded-full bg-line/60">
                  <div className={cn("h-full rounded-full", b.verdict === "DANGER" ? "bg-danger" : b.verdict === "RISKY" ? "bg-honey" : b.verdict === "TOO_EARLY" ? "bg-muted" : "bg-lime")} style={{ width: `${s ?? 0}%` }} />
                </div>
                <span className="num w-56 text-right text-xs text-muted">
                  {s == null ? "no settled yet" : `${s}% dumped`} · {b.settled}/{b.tracked} settled
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="mb-5 grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="We warned you" sub="DANGER or RISKY, and then it dumped" />
          <Rows rows={data?.warned ?? []} empty="Nothing settled yet." />
        </Card>
        <Card>
          <CardHeader title="We missed" sub="CLEAN or OK, and it dumped anyway. Shown on purpose." />
          <Rows rows={data?.missed ?? []} empty="No misses yet." />
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader title="Latest verdicts" sub="From user scans, crawler safety checks, Launch Radar and agents" />
          <Rows rows={data?.recent ?? []} empty="The first verdicts show up here as soon as someone scans a token." />
        </Card>
        <Card>
          <CardHeader title="Crawler signals" sub="Private signals: tickers hidden, outcomes public" />
          <ul className="divide-y divide-line/60">
            {(sig?.recent ?? []).map((r) => (
              <li key={r.crawlerId + r.ts} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                <span className="min-w-0">
                  <Link href={`/crawler/${r.crawlerId}`} className="hover:text-honey">{r.crawlerName}</Link>
                  <span className="ml-2 text-[11px] text-muted">{timeAgo(r.ts)}{r.jev != null ? ` · ⚡ Jev ${Math.round(r.jev * 100)}%` : ""}</span>
                </span>
                <span className={cn("num shrink-0 text-xs font-semibold", r.status === "hit" ? "text-lime" : "text-danger")}>
                  {r.status} {r.status === "hit" ? `peak ${pct(r.peakPct)}` : pct(r.changePct)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
