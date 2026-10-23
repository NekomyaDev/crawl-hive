// Раскладка балла на странице скана: строки правил v2 (их сумма равна баллу) и флаги краулеров v1.
// Строки v2 считает сервер (score-v2.ts только серверный), сюда приходят готовые.
import { cn } from "@/lib/utils";

export interface FactorLine {
  key: string;
  impact: number | null; // null - флаг без своих очков в балле
  label: string;
  note: string;
  hint?: string;
  v1?: number; // очки этого флага в старой оценке v1, только для цвета и подсказки
}

export function ScanFactors({ lines, factors, className = "mt-4" }: { lines: FactorLine[] | null; factors: { label: string; impact: number; note: string }[]; className?: string }) {
  if (lines)
    return (
      <ul className={cn("divide-y divide-line rounded-lg border border-line text-sm", className)}>
        {lines.map((l) => (
          <li key={l.key} className="flex items-center gap-3 px-3 py-2" title={l.hint}>
            <span className={cn("num w-10 shrink-0 text-right font-semibold", l.key === "base" ? "text-muted" : l.impact === null ? ((l.v1 ?? 0) < 0 ? "text-danger" : (l.v1 ?? 0) > 0 ? "text-lime" : "text-honey") : l.impact < 0 ? "text-danger" : "text-lime")}>
              {l.impact === null ? "!" : l.key !== "base" && l.impact > 0 ? `+${l.impact}` : l.impact}
            </span>
            <span className="font-medium">{l.label}</span>
            {l.note && <span className="min-w-0 truncate text-muted">{l.note}</span>}
          </li>
        ))}
      </ul>
    );
  if (!factors.length) return <p className={cn("text-sm text-lime", className)}>No red flags found by the crawlers.</p>;
  return (
    <ul className={cn("divide-y divide-line rounded-lg border border-line text-sm", className)}>
      {[...factors]
        .sort((a, b) => a.impact - b.impact)
        .map((f) => (
          <li key={f.label} className="flex items-center gap-3 px-3 py-2">
            {/* Нулевой вес: предупреждение без влияния на балл, показываем «!» вместо 0. */}
            <span className={cn("num w-10 shrink-0 text-right font-semibold", f.impact < 0 ? "text-danger" : f.impact === 0 ? "text-honey" : "text-lime")}>
              {f.impact > 0 ? `+${f.impact}` : f.impact === 0 ? "!" : f.impact}
            </span>
            <span className="font-medium">{f.label}</span>
            <span className="min-w-0 truncate text-muted">{f.note}</span>
          </li>
        ))}
    </ul>
  );
}

// Короткие главные флаги для всех тарифов: до трёх самых тяжёлых минусов (флаги краулеров и правила v2),
// только названия, без очков и раскладки.
export function TopFlags({ items, className }: { items: { label: string; impact: number }[]; className?: string }) {
  const seen = new Set<string>();
  const top = items
    .filter((f) => f.impact < 0)
    .sort((a, b) => a.impact - b.impact)
    .filter((f) => !seen.has(f.label) && !!seen.add(f.label))
    .slice(0, 3);
  if (!top.length) return <p className={cn("text-sm text-lime", className)}>No red flags found by the crawlers.</p>;
  return (
    <div className={cn("flex flex-wrap gap-1.5 text-xs", className)}>
      {top.map((f) => (
        <span key={f.label} className="rounded-md border border-danger/40 px-2 py-1 text-danger">
          {f.label}
        </span>
      ))}
    </div>
  );
}
