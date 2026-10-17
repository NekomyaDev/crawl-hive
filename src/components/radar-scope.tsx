"use client";
// Радар-экран для Launch Radar и Narrative Radar: вращающийся луч, кольца, метки находок. Чем ближе метка
// к центру, тем она свежее (или горячее). Клик по метке выделяет её карточку на странице.
import { cn } from "@/lib/utils";

export interface Blip {
  id: string;
  label: string;
  r: number; // 0 — центр, 1 — край
  img?: string;
  glyph?: string;
  color: string; // css-цвет обводки и свечения
}

// Угол из id: метка не прыгает между обновлениями.
function angleOf(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 3600) / 10;
}

export function RadarScope({ blips, active, onPick, tone = "var(--lime)", center }: { blips: Blip[]; active?: string | null; onPick?: (id: string) => void; tone?: string; center?: string }) {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[420px] select-none">
      <div
        className="absolute inset-0 overflow-hidden rounded-full border-2"
        style={{ borderColor: `color-mix(in oklab, ${tone} 55%, transparent)`, background: `radial-gradient(circle, color-mix(in oklab, ${tone} 14%, transparent) 0%, color-mix(in oklab, ${tone} 4%, transparent) 60%, transparent 72%)`, boxShadow: `0 0 60px color-mix(in oklab, ${tone} 22%, transparent), inset 0 0 40px color-mix(in oklab, ${tone} 10%, transparent)` }}
      >
        {[0.25, 0.5, 0.75].map((k) => (
          <div key={k} className="absolute rounded-full border" style={{ inset: `${(1 - k) * 50}%`, borderColor: `color-mix(in oklab, ${tone} 22%, transparent)` }} />
        ))}
        <div className="absolute top-0 bottom-0 left-1/2 w-px" style={{ background: `color-mix(in oklab, ${tone} 18%, transparent)` }} />
        <div className="absolute top-1/2 right-0 left-0 h-px" style={{ background: `color-mix(in oklab, ${tone} 18%, transparent)` }} />
        <div className="radar-sweep absolute inset-0 rounded-full" style={{ background: `conic-gradient(from 0deg, color-mix(in oklab, ${tone} 55%, transparent) 0deg, color-mix(in oklab, ${tone} 18%, transparent) 28deg, transparent 70deg)` }} />
      </div>
      <div className="absolute top-1/2 left-1/2 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 text-base" style={{ borderColor: tone, background: "var(--bg)", boxShadow: `0 0 18px ${tone}` }}>
        {center ?? "🐙"}
      </div>
      {blips.map((b) => {
        const a = (angleOf(b.id) * Math.PI) / 180;
        const r = 12 + Math.min(1, Math.max(0, b.r)) * 34; // в процентах от стороны
        const on = active === b.id;
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => onPick?.(b.id)}
            className={cn("radar-blip group absolute -translate-x-1/2 -translate-y-1/2 transition-transform", on ? "z-20 scale-125" : "z-10 hover:z-20 hover:scale-110")}
            style={{ left: `${50 + Math.cos(a) * r}%`, top: `${50 + Math.sin(a) * r}%`, animationDelay: `${(angleOf(b.id) / 360) * 4}s` }}
            title={b.label}
          >
            <span className="relative grid size-9 place-items-center overflow-hidden rounded-full border-2 bg-panel text-sm font-bold" style={{ borderColor: b.color, boxShadow: `0 0 ${on ? 22 : 12}px ${b.color}` }}>
              {b.glyph}
              {b.img && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={b.img} alt="" className="absolute inset-0 size-full object-cover" onError={(e) => ((e.currentTarget.style.display = "none"))} />
              )}
            </span>
            <span className={cn("num absolute top-full left-1/2 mt-0.5 -translate-x-1/2 rounded bg-bg/90 px-1 text-[10px] whitespace-nowrap", on ? "text-fg" : "text-muted group-hover:text-fg")}>{b.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// Плашка «Live» с пульсирующей точкой.
export function LivePill({ children, tone = "bg-lime" }: { children: React.ReactNode; tone?: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line bg-panel/80 px-3 py-1 text-xs text-muted">
      <span className="relative flex size-2">
        <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-70", tone)} />
        <span className={cn("relative inline-flex size-2 rounded-full", tone)} />
      </span>
      {children}
    </span>
  );
}

// Фильтр-«пилюля».
export function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn("rounded-full border px-3 py-1 text-xs transition-colors", on ? "border-honey/70 bg-honey/15 text-honey" : "border-line text-muted hover:text-fg")}>
      {children}
    </button>
  );
}

// Логотип токена (ссылка из DexScreener, сохранённая при скане); если её нет, остаётся первая буква тикера.
export function TokenAvatar({ img, symbol, color, size = 44 }: { img?: string; symbol: string; color: string; size?: number }) {
  return (
    <span className="relative grid shrink-0 place-items-center overflow-hidden rounded-full border-2 bg-bg font-bold" style={{ width: size, height: size, borderColor: color, boxShadow: `0 0 14px color-mix(in oklab, ${color} 45%, transparent)` }}>
      {symbol.slice(0, 1).toUpperCase()}
      {img && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img} alt="" className="absolute inset-0 size-full object-cover" onError={(e) => ((e.currentTarget.style.display = "none"))} />
      )}
    </span>
  );
}
