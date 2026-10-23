// Карточка «Combined with Larpcheck»: общий вердикт CrawlHive x Larpcheck (combined-score.ts), обе части и главные причины.
// Видна всем. Вердикт Larpcheck показываем только со ссылкой на их проверку (их условие).
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CombinedData {
  score: number;
  verdict: "CLEAN" | "OK" | "RISKY" | "DANGER";
  parts: {
    crawlhive: { score: number; verdict: string };
    larpcheck: { verdict: string; score: number | null; coin?: string; url: string } | null;
  };
  reasons: string[];
  coverage: "crawlhive + larpcheck" | "crawlhive only";
}

const LARPCHECK_URL = "https://larpcheck.app";
const COLOR: Record<CombinedData["verdict"], string> = { CLEAN: "var(--lime)", OK: "var(--teal)", RISKY: "var(--honey)", DANGER: "var(--danger)" };
const larpColor = (v: string) => (/SCAM|LARP/.test(v) ? "var(--danger)" : /REAL/.test(v) && !/PARTLY/.test(v) ? "var(--lime)" : "var(--honey)");

export function CombinedScoreCard({ c, className }: { c: CombinedData; className?: string }) {
  const col = COLOR[c.verdict];
  const l = c.parts.larpcheck;
  return (
    <div className={cn("overflow-hidden rounded-xl border bg-panel-2/60", className)} style={{ borderColor: `color-mix(in srgb, ${col} 45%, transparent)` }}>
      <div className="flex items-center justify-between border-b border-line px-4 py-2 text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">
        <span>Combined with Larpcheck</span>
        <span className="text-fg">CrawlHive x Larpcheck</span>
      </div>
      <div className="flex flex-wrap items-center gap-4 p-4">
        <div className="flex items-baseline gap-2">
          <span className="num text-3xl font-black" style={{ color: col }}>
            {c.score}
          </span>
          <span className="text-xl font-black tracking-tight" style={{ color: col }}>
            {c.verdict}
          </span>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-md border border-line px-2 py-1">
            <span className="text-muted">On-chain (CrawlHive) </span>
            <b>
              {c.parts.crawlhive.verdict.replace("_", " ")} {c.parts.crawlhive.score}
            </b>
          </span>
          {l ? (
            <a href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 hover:bg-panel">
              <span className="text-muted">Project (Larpcheck) </span>
              <b style={{ color: larpColor(l.verdict) }}>
                {l.verdict}
                {l.score != null ? ` ${l.score}` : ""}
              </b>
              <ExternalLink className="size-3" />
            </a>
          ) : (
            <span className="rounded-md border border-dashed border-line px-2 py-1 text-muted">No Larpcheck check yet: CrawlHive only</span>
          )}
        </div>
      </div>
      {c.reasons.length > 0 && (
        <ul className="space-y-0.5 px-4 pb-3 text-sm">
          {c.reasons.slice(0, 3).map((x) => (
            <li key={x} className="text-fg/90">
              • {x}
            </li>
          ))}
        </ul>
      )}
      <div className="border-t border-line px-4 py-1.5 text-[11px] text-muted">
        <a href={LARPCHECK_URL} target="_blank" rel="noreferrer" className="hover:text-fg">
          Larpcheck by Galt
        </a>{" "}
        checks the project, CrawlHive checks the chain. CrawlHive hard flags always win.
      </div>
    </div>
  );
}
