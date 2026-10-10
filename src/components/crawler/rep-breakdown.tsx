import { REP_WEIGHTS, reputationBreakdown } from "@/lib/reputation";
import type { PublicCrawler } from "@/lib/types";
import { RepScore } from "@/components/ui/badge";

const ROWS: { key: keyof typeof REP_WEIGHTS; label: string; hint: string }[] = [
  { key: "quality", label: "Signal quality", hint: "share of signals that played out" },
  { key: "uptime", label: "Uptime", hint: "time online since spawn" },
  { key: "volume", label: "Data volume", hint: "log-scaled, spam doesn't pay" },
  { key: "stake", label: "Stake", hint: "how much the owner burned" },
];

export function RepBreakdown({ crawler }: { crawler: PublicCrawler }) {
  const b = reputationBreakdown(crawler);
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-muted">Reputation</span>
        <RepScore rep={crawler.reputation} className="text-2xl" />
      </div>
      {ROWS.map((r) => (
        <div key={r.key}>
          <div className="flex justify-between text-xs">
            <span>
              {r.label} <span className="text-muted">· {Math.round(REP_WEIGHTS[r.key] * 100)}%</span>
            </span>
            <span className="num text-muted">{Math.round(b[r.key] * 100)}%</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel-2">
            <div className="h-full rounded-full bg-honey" style={{ width: `${Math.round(b[r.key] * 100)}%` }} />
          </div>
          <div className="mt-0.5 text-[10px] text-muted">{r.hint}</div>
        </div>
      ))}
    </div>
  );
}
