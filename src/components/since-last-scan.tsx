// Память токена: что изменилось с прошлого скана (вердикт, оценка, ликвидность, доли, LP, Larpcheck).
import { timeAgo, cn } from "@/lib/utils";

export interface SinceData {
  prevAt: number;
  changes: { label: string; from: string; to: string; tone: "bad" | "good" | "info" }[];
}

const TONE = { bad: "text-danger", good: "text-lime", info: "text-sky" } as const;
const ARROW = { bad: "▼", good: "▲", info: "●" } as const;

export function SinceLastScan({ s, className }: { s?: SinceData | null; className?: string }) {
  if (!s?.changes.length) return null;
  return (
    <div className={cn("rounded-xl border border-violet/40 bg-violet/[0.06] px-4 py-3 text-sm", className)}>
      <div className="mb-1.5 text-xs font-bold tracking-wide text-violet uppercase">🧠 Since last scan · {timeAgo(s.prevAt)}</div>
      <ul className="space-y-1">
        {s.changes.map((c) => (
          <li key={c.label} className="flex flex-wrap items-center gap-2">
            <span className={cn("text-xs", TONE[c.tone])}>{ARROW[c.tone]}</span>
            <span className="font-medium">{c.label}</span>
            <span className="num text-muted">{c.from}</span>
            <span className="text-muted">→</span>
            <span className={cn("num font-semibold", TONE[c.tone])}>{c.to}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
