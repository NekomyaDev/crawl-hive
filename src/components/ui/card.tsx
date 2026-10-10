import { cn } from "@/lib/utils";
import type { HTMLAttributes, ReactNode } from "react";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border border-line bg-panel", className)} {...props} />;
}

export function CardHeader({ title, action, sub }: { title: ReactNode; action?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
      <div>
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export type Tone = "honey" | "teal" | "sky" | "violet" | "lime" | "pink" | "coral";

// Цвет плашки задаётся тоном: полоска сверху, лёгкая подложка и цвет значения.
const TONE: Record<Tone, { bar: string; bg: string; text: string }> = {
  honey: { bar: "from-honey to-coral", bg: "from-honey/10", text: "text-honey" },
  teal: { bar: "from-teal to-sky", bg: "from-teal/10", text: "text-teal" },
  sky: { bar: "from-sky to-violet", bg: "from-sky/10", text: "text-sky" },
  violet: { bar: "from-violet to-pink", bg: "from-violet/10", text: "text-violet" },
  lime: { bar: "from-lime to-teal", bg: "from-lime/10", text: "text-lime" },
  pink: { bar: "from-pink to-coral", bg: "from-pink/10", text: "text-pink" },
  coral: { bar: "from-coral to-honey", bg: "from-coral/10", text: "text-coral" },
};

export function Stat({
  label,
  value,
  hint,
  accent,
  tone,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  accent?: boolean;
  tone?: Tone;
  icon?: ReactNode;
}) {
  const t = tone ? TONE[tone] : null;
  return (
    <Card className={cn("relative overflow-hidden px-4 py-3", t && `bg-gradient-to-b ${t.bg} to-transparent`)}>
      {t && <div className={cn("absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r", t.bar)} />}
      <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-muted">
        {label}
        {icon && <span className={cn("opacity-80", t?.text)}>{icon}</span>}
      </div>
      <div className={cn("num mt-1 text-xl font-semibold", accent && "text-honey", t?.text)}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </Card>
  );
}
