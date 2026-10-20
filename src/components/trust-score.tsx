// Третий вердикт: общий trust score CrawlHive и Larpcheck (60% ончейн, 40% проект) с потолками на скам.
import { cn } from "@/lib/utils";

export interface TrustData {
  score: number;
  verdict: "TRUSTED" | "MIXED" | "CAUTION" | "AVOID";
  why: string;
}

const COLOR: Record<TrustData["verdict"], string> = { TRUSTED: "var(--lime)", MIXED: "var(--teal)", CAUTION: "var(--honey)", AVOID: "var(--danger)" };

export function TrustScore({ t, className }: { t: TrustData; className?: string }) {
  const c = COLOR[t.verdict];
  return (
    <div className={cn("overflow-hidden rounded-xl border bg-panel-2/60", className)} style={{ borderColor: `color-mix(in srgb, ${c} 45%, transparent)` }}>
      <div className="flex items-center justify-between border-b border-line px-4 py-2 text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">
        <span>🤝 Trust score</span>
        <span className="text-fg">CrawlHive × Larpcheck</span>
      </div>
      <div className="flex items-center gap-4 p-4">
        <div className="grid size-16 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(${c} ${t.score * 3.6}deg, rgba(255,255,255,0.07) 0)` }}>
          <div className="grid size-13 place-items-center rounded-full bg-panel">
            <span className="num text-xl font-bold" style={{ color: c }}>
              {t.score}
            </span>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xl font-black tracking-tight" style={{ color: c }}>
            {t.verdict}
          </div>
          <p className="mt-0.5 text-sm text-fg/90">{t.why}</p>
          <p className="mt-1 text-[11px] text-muted">60% on-chain (CrawlHive) · 40% project (Larpcheck). If either side flags a scam, the score can&apos;t look safe.</p>
        </div>
      </div>
    </div>
  );
}
