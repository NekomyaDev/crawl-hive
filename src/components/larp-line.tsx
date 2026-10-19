// Строка «второе мнение» от Larpcheck: их вердикт о проекте за токеном. Ссылка на их проверку обязательна по их условиям.
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export interface LarpLineData {
  verdict: string;
  score: number | null;
  headline?: string | null;
  coin?: { word: string; score: number | null };
  url: string;
}

const tone = (v: string) => (/SCAM|^LARP|LIKELY LARP/.test(v) ? "text-danger border-danger/40" : /REAL/.test(v) && !/PARTLY/.test(v) ? "text-lime border-lime/40" : "text-honey border-honey/40");

export function LarpLine({ l, className }: { l: LarpLineData; className?: string }) {
  return (
    <a href={l.url} target="_blank" rel="noreferrer" className={cn("flex items-center gap-3 rounded-lg border border-line bg-panel-2/60 px-3 py-2.5 text-sm transition-colors hover:bg-panel-2", className)}>
      <span className="text-xs font-semibold tracking-wide text-muted uppercase">Second opinion</span>
      <span className="font-semibold">Larpcheck</span>
      <span className={cn("rounded-md border px-1.5 py-0.5 text-xs font-bold", tone(l.verdict))}>
        {l.verdict}
        {l.score != null ? ` ${l.score}` : ""}
      </span>
      {l.headline && <span className="min-w-0 flex-1 truncate text-muted">{l.headline}</span>}
      <ExternalLink className="ml-auto size-3.5 shrink-0 text-muted" />
    </a>
  );
}
