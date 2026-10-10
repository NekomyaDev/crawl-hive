import { cn } from "@/lib/utils";
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

export function Label({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <span className="text-xs font-medium text-fg/90">{children}</span>
      {hint && <span className="text-[11px] text-muted">{hint}</span>}
    </div>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-9 w-full rounded-lg border border-line bg-panel-2 px-3 text-sm outline-none placeholder:text-muted/60 focus:border-honey/60",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm outline-none placeholder:text-muted/60 focus:border-honey/60",
        className,
      )}
      {...props}
    />
  );
}

// Набор переключателей-«чипов». multi=false ведёт себя как radio.
export function Chips<T extends string>({
  options,
  value,
  onChange,
  render,
  className,
}: {
  options: readonly T[];
  value: T[];
  onChange: (v: T[]) => void;
  render?: (o: T) => ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button
            key={o}
            type="button"
            onClick={() => onChange(on ? value.filter((v) => v !== o) : [...value, o])}
            className={cn(
              "rounded-lg border px-2.5 py-1 text-xs transition-colors",
              on ? "border-honey/60 bg-honey/10 text-honey" : "border-line text-muted hover:text-fg",
            )}
          >
            {render ? render(o) : o}
          </button>
        );
      })}
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  render,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  render?: (o: T) => ReactNode;
}) {
  return (
    <div className="inline-flex flex-wrap rounded-lg border border-line bg-panel-2 p-0.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs transition-colors",
            value === o ? "bg-panel text-fg shadow" : "text-muted hover:text-fg",
          )}
        >
          {render ? render(o) : o}
        </button>
      ))}
    </div>
  );
}
