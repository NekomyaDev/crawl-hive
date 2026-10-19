// Карточка «второе мнение» от Larpcheck: их вердикт о проекте за токеном, оценка, вывод и штамп монеты.
// Ссылка на их проверку обязательна по их условиям.
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export interface LarpLineData {
  verdict: string;
  score: number | null;
  headline?: string | null;
  coin?: { word: string; score: number | null };
  url: string;
}

const colorOf = (v: string) => (/SCAM|LARP/.test(v) ? "var(--danger)" : /REAL/.test(v) && !/PARTLY/.test(v) ? "var(--lime)" : "var(--honey)");
const coinColor = (w: string) => (/RIG|SCAM|BAD/.test(w) ? "var(--danger)" : /OK|FAIR|GOOD/.test(w) ? "var(--lime)" : "var(--honey)");

export function LarpLine({ l, className }: { l: LarpLineData; className?: string }) {
  const c = colorOf(l.verdict);
  return (
    <div className={cn("overflow-hidden rounded-xl border bg-panel-2/60", className)} style={{ borderColor: `color-mix(in srgb, ${c} 45%, transparent)`, boxShadow: `0 0 30px color-mix(in srgb, ${c} 12%, transparent)` }}>
      <div className="flex items-center justify-between border-b border-line px-4 py-2 text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">
        <span>Second opinion · project check</span>
        <span className="text-fg">Larpcheck</span>
      </div>
      <div className="flex gap-4 p-4">
        <div className="grid size-16 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(${c} ${(l.score ?? 0) * 3.6}deg, rgba(255,255,255,0.07) 0)` }}>
          <div className="grid size-13 place-items-center rounded-full bg-panel">
            <span className="num text-xl font-bold" style={{ color: c }}>
              {l.score ?? "?"}
            </span>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xl font-black tracking-tight" style={{ color: c }}>
              {l.verdict}
            </span>
            {l.coin && (
              <span className="rounded-md border px-1.5 py-0.5 text-[11px] font-bold" style={{ color: coinColor(l.coin.word), borderColor: `color-mix(in srgb, ${coinColor(l.coin.word)} 45%, transparent)` }}>
                coin: {l.coin.word}
                {l.coin.score != null ? ` ${l.coin.score}` : ""}
              </span>
            )}
          </div>
          {l.headline && <p className="mt-1.5 text-sm leading-relaxed text-fg/90">{l.headline}</p>}
          <a href={l.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-panel">
            Full check on Larpcheck <ExternalLink className="size-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}
