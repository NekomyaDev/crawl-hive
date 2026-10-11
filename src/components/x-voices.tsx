"use client";
// Карта «who's talking on X»: в центре краулер, вокруг на орбитах — люди, которые писали о токене.
// Пузырь = автор (аватар с unavatar, если его нет — буква), обводка = настрой поста. Клик открывает пост.
import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, X as Close } from "lucide-react";
import type { XVoice } from "@/lib/server/scan-x";
import { cn } from "@/lib/utils";

export type { XVoice };

const STANCE: Record<XVoice["stance"], { color: string; label: string; text: string }> = {
  bullish: { color: "#b6f23a", label: "bullish", text: "text-lime" },
  bearish: { color: "#f87171", label: "bearish", text: "text-danger" },
  neutral: { color: "#8a9099", label: "neutral", text: "text-muted" },
};
const LETTER_BG = ["#ffb020", "#c084fc", "#5eead4", "#60a5fa", "#f472b6", "#ff6a3d", "#b6f23a"];

// Орбиты в процентах от ширины и высоты блока (он шире, чем выше, поэтому эллипсы): ёмкость, радиусы, размер пузыря.
const RINGS = [
  { cap: 6, rx: 16, ry: 24, size: 50 },
  { cap: 10, rx: 29, ry: 35, size: 42 },
  { cap: 14, rx: 42, ry: 42, size: 34 },
];
// Пузыри задуманы под блок шириной 720px; в блоке уже — пропорционально мельче, но не меньше 60%.
const BASE_W = 720;

interface Placed extends XVoice {
  x: number;
  y: number;
  size: number;
  i: number;
}

// Раскладка в пикселях реального блока W×H, чтобы раздвигание работало и на телефоне.
function layout(voices: XVoice[], W: number, H: number): Placed[] {
  const k0 = Math.max(0.6, Math.min(1, W / BASE_W));
  const out: Placed[] = [];
  let i = 0;
  RINGS.forEach((ring, r) => {
    const chunk = voices.slice(i, i + ring.cap);
    chunk.forEach((v, k) => {
      // Сдвиг на полшага на каждой орбите, чтобы пузыри соседних колец не вставали на одну линию.
      const a = ((k + (r % 2) * 0.5) / chunk.length) * Math.PI * 2 + r * 0.3 - Math.PI / 2;
      const boost = Math.min(v.posts - 1, 3) * 4;
      out.push({ ...v, x: 50 + ring.rx * Math.cos(a), y: 50 + ring.ry * Math.sin(a), size: Math.round((ring.size + boost) * k0), i: i + k });
    });
    i += chunk.length;
  });
  // Расталкиваем пересекающиеся пузыри и не даём им вылезти за края и на центр.
  const pts = out.map((p) => ({ x: (p.x / 100) * W, y: (p.y / 100) * H, r: p.size / 2 + 4 }));
  const hub = { x: W / 2, y: H / 2, r: W < 640 ? 36 : 44 };
  for (let it = 0; it < 80; it++) {
    for (let a = 0; a < pts.length; a++) {
      for (let b = a + 1; b < pts.length; b++) {
        const dx = pts[b].x - pts[a].x;
        const dy = pts[b].y - pts[a].y;
        const d = Math.hypot(dx, dy) || 0.01;
        const need = pts[a].r + pts[b].r - d;
        if (need > 0) {
          const ux = dx / d;
          const uy = dy / d;
          pts[a].x -= (ux * need) / 2;
          pts[a].y -= (uy * need) / 2;
          pts[b].x += (ux * need) / 2;
          pts[b].y += (uy * need) / 2;
        }
      }
      const p = pts[a];
      const dh = Math.hypot(p.x - hub.x, p.y - hub.y) || 0.01;
      if (dh < hub.r + p.r) {
        p.x = hub.x + ((p.x - hub.x) / dh) * (hub.r + p.r);
        p.y = hub.y + ((p.y - hub.y) / dh) * (hub.r + p.r);
      }
      p.x = Math.min(W - p.r, Math.max(p.r, p.x));
      p.y = Math.min(H - p.r, Math.max(p.r, p.y));
    }
  }
  return out.map((p, k) => ({ ...p, x: (pts[k].x / W) * 100, y: (pts[k].y / H) * 100 }));
}

export function Avatar({ handle, size, className }: { handle: string; size: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const bg = LETTER_BG[[...handle].reduce((s, c) => s + c.charCodeAt(0), 0) % LETTER_BG.length];
  if (failed)
    return (
      <span
        className={cn("grid place-items-center rounded-full bg-panel-2 font-bold", className)}
        style={{ width: size, height: size, color: bg, fontSize: size * 0.4 }}
      >
        {handle[0]?.toUpperCase()}
      </span>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://unavatar.io/x/${handle}?fallback=false`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={cn("rounded-full bg-panel-2 object-cover", className)}
      style={{ width: size, height: size }}
    />
  );
}

export function XVoices({ voices, loading, symbol }: { voices?: XVoice[]; loading?: boolean; symbol: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: BASE_W, h: (BASE_W * 9) / 16 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setDims({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const placed = useMemo(() => layout(voices ?? [], dims.w, dims.h), [voices, dims.w, dims.h]);
  const [open, setOpen] = useState<Placed | null>(null);
  const counts = useMemo(() => {
    const c = { bullish: 0, bearish: 0, neutral: 0 };
    for (const v of voices ?? []) c[v.stance]++;
    return c;
  }, [voices]);
  if (!loading && !placed.length) return null;

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-line bg-[#05060a]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <div>
          <div className="text-sm font-semibold">who&apos;s talking about ${symbol} on 𝕏</div>
          <div className="text-[11px] text-muted">{loading ? "Grok is reading X, about a minute…" : "Real posts found by Grok over the last two days. Tap a bubble to read."}</div>
        </div>
        {!loading && (
          <div className="flex gap-3 text-[11px]">
            {(Object.keys(counts) as XVoice["stance"][]).map((k) => (
              <span key={k} className="flex items-center gap-1.5 text-muted">
                <span className="size-2 rounded-full" style={{ background: STANCE[k].color }} />
                <span className="num text-fg">{counts[k]}</span> {STANCE[k].label}
              </span>
            ))}
          </div>
        )}
      </div>

      <div ref={box} className="relative aspect-square w-full sm:aspect-[16/9]" style={{ backgroundImage: "radial-gradient(circle at 50% 50%, rgba(255,176,32,0.10), transparent 55%)" }}>
        {/* орбиты и линии к центру */}
        <svg className="absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {RINGS.map((r) => (
            <ellipse key={r.rx} cx="50" cy="50" rx={r.rx} ry={r.ry} fill="none" stroke="#22262c" strokeWidth="1" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
          ))}
          {placed.map((p) => (
            <line
              key={p.handle}
              x1="50"
              y1="50"
              x2={p.x}
              y2={p.y}
              pathLength={1}
              className="voice-line"
              stroke={open?.handle === p.handle ? STANCE[p.stance].color : "rgba(255,255,255,0.10)"}
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
              style={{ animationDelay: `${p.i * 45}ms` }}
            />
          ))}
        </svg>

        {/* пока Grok ищет — по орбите бегут пустые точки */}
        {loading && (
          <div className="orbit absolute inset-0">
            {Array.from({ length: 12 }, (_, k) => {
              const a = (k / 12) * Math.PI * 2;
              return (
                <span
                  key={k}
                  className="absolute size-3 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full bg-line"
                  style={{ left: `${50 + 29 * Math.cos(a)}%`, top: `${50 + 38 * Math.sin(a)}%`, animationDelay: `${k * 120}ms` }}
                />
              );
            })}
          </div>
        )}

        {/* центр: краулер */}
        <div className="hub-breathe absolute top-1/2 left-1/2 grid size-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-honey/50 bg-panel sm:size-20">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/crawlhive-mark.svg" alt="" className="size-11 sm:size-14" />
        </div>

        {placed.map((p) => (
          <button
            key={p.handle}
            type="button"
            title={`@${p.handle}`}
            onClick={() => setOpen((o) => (o?.handle === p.handle ? null : p))}
            className={cn("voice-pop group absolute rounded-full p-[2px] transition hover:z-10", open?.handle === p.handle && "z-10")}
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              animationDelay: `${150 + p.i * 45}ms`,
              background: STANCE[p.stance].color,
              boxShadow: open?.handle === p.handle ? `0 0 24px ${STANCE[p.stance].color}` : undefined,
            }}
          >
            <span className="block rounded-full bg-[#05060a] p-[2px] transition group-hover:scale-110">
              <Avatar handle={p.handle} size={p.size} />
            </span>
          </button>
        ))}

        {open && (
          <div className="absolute inset-x-3 bottom-3 z-20 mx-auto max-w-md rounded-xl border border-line bg-panel/95 p-3 shadow-2xl backdrop-blur sm:inset-x-auto sm:right-3 sm:left-auto">
            <div className="flex items-start gap-3">
              <Avatar handle={open.handle} size={40} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2">
                  <span className="truncate font-semibold">{open.name}</span>
                  <span className="text-xs text-sky">@{open.handle}</span>
                  <span className={cn("text-[10px] font-semibold uppercase", STANCE[open.stance].text)}>{STANCE[open.stance].label}</span>
                </div>
                <p className="mt-1 text-sm text-fg/90">{open.text}</p>
                <div className="mt-2 flex items-center gap-3 text-xs">
                  <a href={open.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-honey hover:underline">
                    open post <ExternalLink className="size-3" />
                  </a>
                  {open.posts > 1 && <span className="text-muted">{open.posts} posts about ${symbol}</span>}
                </div>
              </div>
              <button type="button" onClick={() => setOpen(null)} className="text-muted hover:text-fg" aria-label="Close">
                <Close className="size-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
