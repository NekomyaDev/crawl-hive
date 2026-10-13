"use client";
// Launch Radar: свежие запуски, которые платформа сканирует сама. Всем — с задержкой; владельцы краулеров
// получают такие находки сразу, поэтому рядом всегда призыв запустить свой краулер.
import Link from "next/link";
import { Radar } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Stat } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { VerdictPill } from "@/components/verdict";
import { useApi } from "@/lib/client/use-api";
import { fmt, short, timeAgo } from "@/lib/utils";

interface Entry {
  id: string;
  chain: string;
  symbol: string;
  name: string;
  verdict: string;
  score: number | null;
  reason: string;
  flags: string[];
  liq: number;
  fdv: number;
  ageH: number | null;
  at: number;
}
interface Feed {
  items: Entry[];
  waiting: number;
  delayMin: number;
  day: { scanned: number; danger: number; clean: number };
}

const CHAIN = { solana: { t: "Solana", c: "text-violet border-violet/40" }, robinhood: { t: "Robinhood", c: "text-lime border-lime/40" } } as Record<string, { t: string; c: string }>;

export default function RadarPage() {
  const { data } = useApi<Feed>("/api/radar", 30000);
  const d = data?.day;
  return (
    <>
      <PageHeader
        title="Launch Radar"
        sub="Fresh launches on Solana and Robinhood Chain, scanned by the swarm on its own: holders, bundles, dev history, copycats. No one asked for these scans."
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Stat label="Scanned, 24h" value={d ? fmt(d.scanned) : "—"} tone="lime" icon={<Radar className="size-4" />} />
        <Stat label="Flagged DANGER" value={d ? `${d.scanned ? Math.round((d.danger / d.scanned) * 100) : 0}%` : "—"} hint={d ? `${d.danger} launches` : undefined} tone="coral" />
        <Stat label="Clean or OK" value={d ? `${d.scanned ? Math.round((d.clean / d.scanned) * 100) : 0}%` : "—"} hint={d ? `${d.clean} launches` : undefined} tone="teal" />
      </div>

      <Card className="mb-5 flex flex-wrap items-center justify-between gap-3 border-honey/30 bg-gradient-to-r from-honey/[0.07] to-transparent px-4 py-3">
        <div className="text-sm">
          <span className="font-semibold">{data?.waiting ?? 0} newer finds</span>
          <span className="text-muted"> are waiting out the {data?.delayMin ?? 10}-minute delay. Crawler owners get launches like these the second they appear, filtered to their own rules.</span>
        </div>
        <Link href="/spawn">
          <Button size="sm">Spawn a crawler</Button>
        </Link>
      </Card>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">
              <th className="px-4 py-2.5">Token</th>
              <th className="px-3 py-2.5">Age</th>
              <th className="px-3 py-2.5 text-right">Liquidity</th>
              <th className="px-3 py-2.5 text-right">FDV</th>
              <th className="px-3 py-2.5">Verdict</th>
              <th className="px-3 py-2.5">Why</th>
              <th className="px-4 py-2.5 text-right">Scanned</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((e) => (
              <tr key={e.id} className="border-b border-line/60 last:border-0 hover:bg-panel-2/50">
                <td className="px-4 py-2.5">
                  <Link href={`/scan/${e.id}`} className="font-semibold hover:text-honey">
                    ${e.symbol}
                  </Link>
                  <span className={`ml-2 rounded border px-1 text-[10px] ${CHAIN[e.chain]?.c ?? "border-line text-muted"}`}>{CHAIN[e.chain]?.t ?? e.chain}</span>
                  <div className="num text-[11px] text-muted">{short(e.id)}</div>
                </td>
                <td className="num px-3 py-2.5 text-muted">{e.ageH == null ? "—" : e.ageH < 1 ? `${Math.round(e.ageH * 60)}m` : `${e.ageH}h`}</td>
                <td className="num px-3 py-2.5 text-right">${fmt(e.liq)}</td>
                <td className="num px-3 py-2.5 text-right">${fmt(e.fdv)}</td>
                <td className="px-3 py-2.5">
                  <VerdictPill verdict={e.verdict} score={e.score} />
                </td>
                <td className="max-w-[260px] px-3 py-2.5 text-xs text-muted">
                  <div className="truncate" title={e.reason}>{e.reason}</div>
                  {!!e.flags.length && <div className="truncate text-[11px] text-danger/80">{e.flags.join(" · ")}</div>}
                </td>
                <td className="num px-4 py-2.5 text-right text-xs text-muted">{timeAgo(e.at)}</td>
              </tr>
            ))}
            {data && !data.items.length && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-muted">
                  The radar has just started. First launches show up here {data.delayMin} minutes after the scan.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      <p className="mt-3 text-xs text-muted">Every verdict here also goes into the <Link href="/track" className="text-honey hover:underline">Track Record</Link>: 24 hours later you can see whether it came true.</p>
    </>
  );
}
