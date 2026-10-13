// Contract X-Ray: что владелец токена может сделать с держателями (по байткоду EVM или расширениям Token-2022)
// и что делает сайт проекта с кошельком посетителя. Общий блок для главной, страницы скана и мини-аппа.
import { cn } from "@/lib/utils";

export interface XRayFinding {
  label: string;
  note: string;
  severity: "high" | "medium" | "low";
  detail?: string;
}
export interface XRayView {
  kind: "evm" | "solana";
  summary: string;
  findings: XRayFinding[];
  site?: { host: string; wallet: boolean; error?: string; findings: XRayFinding[] };
}

const SEV: Record<XRayFinding["severity"], string> = {
  high: "border-danger/40 text-danger",
  medium: "border-honey/40 text-honey",
  low: "border-line text-muted",
};
const DOT: Record<XRayFinding["severity"], string> = { high: "bg-danger", medium: "bg-honey", low: "bg-muted" };

function Rows({ items }: { items: XRayFinding[] }) {
  return (
    <ul className="space-y-1">
      {items.map((f) => (
        <li key={f.label} className="flex items-start gap-2">
          <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", DOT[f.severity])} />
          <span className="min-w-0">
            <span className={cn("font-medium", f.severity === "low" ? "text-fg/80" : SEV[f.severity].split(" ")[1])}>{f.label}</span>
            <span className="text-muted">: {f.note}</span>
            {f.detail && <span className="num block truncate text-[10px] text-muted/80">{f.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function XRayPanel({ x, className }: { x: XRayView; className?: string }) {
  const sorted = (l: XRayFinding[]) => [...l].sort((a, b) => "hml".indexOf(a.severity[0]) - "hml".indexOf(b.severity[0]));
  const bad = x.findings.some((f) => f.severity === "high") || x.site?.findings.some((f) => f.severity === "high");
  return (
    <div className={cn("rounded-lg border bg-panel-2/60 p-3 text-xs", bad ? "border-danger/40" : "border-line", className)}>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">🩻 Contract X-Ray</span>
        <span className="text-[10px] text-muted">{x.summary}</span>
      </div>
      {x.findings.length ? (
        <Rows items={sorted(x.findings)} />
      ) : (
        <p className="text-lime">{x.kind === "evm" ? "No owner powers found in the bytecode." : "No harmful token extensions."}</p>
      )}
      {x.site && (
        <div className="mt-2 border-t border-line pt-2">
          <div className="mb-1 font-semibold">
            🌐 Site <span className="num font-normal text-muted">{x.site.host}</span>
          </div>
          {x.site.error ? (
            <p className="text-muted">Site unreachable, not checked.</p>
          ) : x.site.findings.length ? (
            <Rows items={sorted(x.site.findings)} />
          ) : (
            <p className="text-lime">{x.site.wallet ? "Connects a wallet, but asks for nothing suspicious." : "No wallet requests, no drainer code."}</p>
          )}
        </div>
      )}
    </div>
  );
}
