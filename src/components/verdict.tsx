// Общие мелочи для вердиктов сканера: цвет и плашка.
import { cn } from "@/lib/utils";

export const VERDICT_TONE: Record<string, string> = {
  CLEAN: "text-lime border-lime/40 bg-lime/[0.06]",
  OK: "text-lime border-lime/30",
  RISKY: "text-honey border-honey/40 bg-honey/[0.05]",
  DANGER: "text-danger border-danger/40 bg-danger/[0.06]",
  TOO_EARLY: "text-muted border-line",
};

export function VerdictPill({ verdict, score, className }: { verdict: string; score?: number | null; className?: string }) {
  return (
    <span className={cn("num inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-px text-[11px] font-semibold", VERDICT_TONE[verdict] ?? "text-muted border-line", className)}>
      {score != null && <span>{score}</span>}
      {verdict.replace("_", " ")}
    </span>
  );
}

export const pct = (n: number | null | undefined) => (n == null ? "—" : `${n > 0 ? "+" : ""}${Math.round(n)}%`);
