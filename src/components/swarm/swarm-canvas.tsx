"use client";
// Карта роя на canvas: точки-краулеры, кошельки-соты, связи владения и общего нарратива.
// Грузится только в браузере (см. swarm-map.tsx), потому что force-graph трогает window.
import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods, type NodeObject, type LinkObject } from "react-force-graph-2d";
import { SOURCE_META } from "@/lib/utils";
import type { SwarmLink, SwarmNode } from "@/lib/types";

export type GNode = NodeObject<SwarmNode & { owned?: number }>;
type GLink = LinkObject<GNode, { kind: SwarmLink["kind"] }>;

export interface SwarmCanvasProps {
  nodes: GNode[];
  links: GLink[];
  isVisible: (n: GNode) => boolean;
  selectedId: string | null;
  pulses: React.RefObject<Map<string, number>>;
  onSelect: (n: GNode | null) => void;
  height: number;
}

const PULSE_MS = 1800;
// Пока краулеров немного, подписи видны всегда; в большом рое — только при приближении.
const ALWAYS_LABEL_MAX = 40;
const HEX = 26; // сторона соты фона в координатах графа

// В маленьком рое точки крупнее: иначе на просторной карте они теряются.
let sizeBoost = 1;
function crawlerRadius(n: GNode) {
  return (4 + (n.reputation / 1000) * 7) * sizeBoost;
}

// Фон — соты улья в координатах графа: двигаются и масштабируются вместе с картой, дают глазу опору.
function drawHoneycomb(ctx: CanvasRenderingContext2D, scale: number) {
  const t = ctx.getTransform();
  const x0 = -t.e / t.a;
  const y0 = -t.f / t.d;
  const x1 = (ctx.canvas.width - t.e) / t.a;
  const y1 = (ctx.canvas.height - t.f) / t.d;
  // При сильном отдалении соты укрупняем, чтобы не рисовать тысячи мелких.
  let side = HEX;
  while (((x1 - x0) / (side * 1.73)) * ((y1 - y0) / (side * 1.5)) > 1600) side *= 2;
  const w = side * Math.sqrt(3);
  const h = side * 1.5;
  ctx.save();
  ctx.lineWidth = 1 / scale;
  ctx.strokeStyle = "rgba(255,176,32,0.07)";
  ctx.beginPath();
  for (let row = Math.floor(y0 / h) - 1; row * h < y1 + h; row++) {
    const off = row % 2 ? w / 2 : 0;
    for (let col = Math.floor(x0 / w) - 1; col * w < x1 + w; col++) {
      const cx = col * w + off;
      const cy = row * h;
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i + Math.PI / 6;
        const px = cx + side * Math.cos(a);
        const py = cy + side * Math.sin(a);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    }
  }
  ctx.stroke();
  ctx.restore();
}

// Canvas не понимает CSS-переменные в ctx.font, поэтому берём реальные семейства шрифтов со страницы.
let fonts: { sans: string; mono: string } | null = null;
function fontFamilies() {
  if (fonts) return fonts;
  const css = getComputedStyle(document.documentElement);
  const pick = (v: string, fb: string) => {
    const name = css.getPropertyValue(v).trim();
    return name ? `${name}, ${fb}` : fb;
  };
  fonts = { sans: pick("--font-geist-sans", "system-ui, sans-serif"), mono: pick("--font-geist-mono", "ui-monospace, monospace") };
  return fonts;
}

// Подпись-плашка под узлом: имя и строка поменьше (источник · тир или «wallet»).
// above — плашка над точкой (у кошельков), чтобы подписи кошелька и его краулера не налезали друг на друга.
function drawLabel(ctx: CanvasRenderingContext2D, x: number, y0: number, scale: number, title: string, sub: string, accent: string, above = false) {
  const { sans, mono } = fontFamilies();
  const fs = 11 / scale;
  const ss = 9.5 / scale;
  ctx.font = `600 ${fs}px ${sans}`;
  const tw = ctx.measureText(title).width;
  ctx.font = `${ss}px ${mono}`;
  const sw = ctx.measureText(sub).width;
  const pad = 5 / scale;
  const bw = Math.max(tw, sw) + pad * 2;
  const bh = fs + ss + pad * 2.2;
  const y = above ? y0 - bh : y0;
  const bx = x - bw / 2;
  ctx.fillStyle = "rgba(14,16,19,0.82)";
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1 / scale;
  ctx.beginPath();
  ctx.roundRect(bx, y, bw, bh, 4 / scale);
  ctx.fill();
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = `600 ${fs}px ${sans}`;
  ctx.fillStyle = "rgba(232,234,237,0.95)";
  ctx.fillText(title, x, y + pad);
  ctx.font = `${ss}px ${mono}`;
  ctx.fillStyle = accent;
  ctx.fillText(sub, x, y + pad + fs + pad * 0.3);
  ctx.textBaseline = "alphabetic";
}

function hexPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    const px = x + r * Math.cos(a);
    const py = y + r * Math.sin(a);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

export default function SwarmCanvas({ nodes, links, isVisible, selectedId, pulses, onSelect, height }: SwarmCanvasProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const fg = useRef<ForceGraphMethods<GNode, GLink> | undefined>(undefined);
  const [width, setWidth] = useState(800);
  const fitted = useRef(-1);
  const crawlerCount = useMemo(() => nodes.filter((n) => n.kind === "crawler").length, [nodes]);
  const labelsAlways = crawlerCount <= ALWAYS_LABEL_MAX;
  sizeBoost = crawlerCount <= 12 ? 1.6 : 1;

  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  // Расталкиваем точки сильнее, чтобы кластеры нарративов читались.
  useEffect(() => {
    const f = fg.current;
    if (!f) return;
    // В маленьком рое точки разносим шире, чтобы подписи не налезали друг на друга.
    const sparse = nodes.length <= ALWAYS_LABEL_MAX;
    f.d3Force("charge")?.strength?.(sparse ? -260 : -40);
    f.d3Force("link")?.distance?.((l: GLink) => (l.kind === "narrative" ? (sparse ? 110 : 40) : sparse ? 95 : 22));
  }, [nodes.length]);

  // Объект graphData меняем только когда меняется состав узлов, иначе симуляция «взрывается» заново.
  const data = useMemo(() => ({ nodes, links }), [nodes, links]);

  // Связи владения в обе стороны: подпись ставим с той стороны, где нет связанного узла.
  const owners = useMemo(() => {
    const m = new Map<string, GNode[]>();
    for (const l of links) {
      if (l.kind !== "owns" || typeof l.source !== "object" || typeof l.target !== "object") continue;
      const a = l.source as GNode;
      const b = l.target as GNode;
      m.set(String(a.id), [...(m.get(String(a.id)) ?? []), b]);
      m.set(String(b.id), [...(m.get(String(b.id)) ?? []), a]);
    }
    return m;
  }, [links, nodes]);

  const neighbours = useMemo(() => {
    const m = new Set<string>();
    if (!selectedId) return m;
    for (const l of links) {
      const s = typeof l.source === "object" ? l.source.id : l.source;
      const t = typeof l.target === "object" ? l.target.id : l.target;
      if (s === selectedId) m.add(String(t));
      if (t === selectedId) m.add(String(s));
    }
    return m;
  }, [links, selectedId]);

  return (
    <div
      ref={wrap}
      className="relative w-full"
      // Медовое свечение в центре и затемнение к краям: карта перестаёт быть плоским серым полем.
      style={{
        height,
        background:
          "radial-gradient(ellipse at 50% 45%, rgba(255,176,32,0.10), transparent 60%), radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(0,0,0,0.45))",
      }}
    >
      <ForceGraph2D<GNode, GLink>
        ref={fg}
        graphData={data}
        width={width}
        height={height}
        backgroundColor="rgba(0,0,0,0)"
        autoPauseRedraw={false}
        cooldownTicks={180}
        warmupTicks={60}
        onEngineStop={() => {
          // Подгоняем вид при первом показе и когда меняется состав роя; мало узлов — не отдаляемся слишком.
          if (fitted.current === nodes.length) return;
          fitted.current = nodes.length;
          const f = fg.current;
          if (!f) return;
          f.zoomToFit(600, 110);
          setTimeout(() => {
            const z = f.zoom();
            if (z > 3.2) f.zoom(3.2, 300);
          }, 650);
        }}
        onRenderFramePre={(ctx, scale) => drawHoneycomb(ctx, scale)}
        nodeLabel={(n) =>
          n.kind === "wallet"
            ? `<b>Wallet</b> ${n.label}<br/>avg rep ${n.reputation}`
            : `<b>${n.label}</b> · ${n.id}<br/>${SOURCE_META[n.source!].label} · rep ${n.reputation}`
        }
        onNodeClick={(n) => onSelect(n)}
        onBackgroundClick={() => onSelect(null)}
        linkColor={(l) => {
          const s = l.source as GNode;
          const t = l.target as GNode;
          const dim = !isVisible(s) || !isVisible(t);
          if (selectedId && (s.id === selectedId || t.id === selectedId)) return "rgba(255,176,32,0.7)";
          if (dim) return "rgba(255,255,255,0.015)";
          if (l.kind === "narrative") return "rgba(255,176,32,0.13)";
          if (l.kind === "rents") return "rgba(192,132,252,0.45)";
          return "rgba(232,234,237,0.28)";
        }}
        linkWidth={(l) => (l.kind === "rents" ? 1.2 : l.kind === "owns" ? 1 : 0.6)}
        // Владение — пунктир от кошелька к его краулерам; по нему частицы бегут к краулеру.
        linkLineDash={(l) => (l.kind === "owns" ? [3, 3] : null)}
        linkDirectionalParticles={(l) => (l.kind === "owns" && labelsAlways ? 1 : 0)}
        linkDirectionalParticleWidth={1.6}
        linkDirectionalParticleSpeed={0.006}
        linkDirectionalParticleColor={() => "rgba(255,176,32,0.8)"}
        nodeCanvasObject={(n, ctx, scale) => {
          const visible = isVisible(n);
          const selected = n.id === selectedId;
          const near = neighbours.has(String(n.id));
          const alpha = visible ? (selectedId && !selected && !near ? 0.35 : 1) : 0.08;
          const x = n.x ?? 0;
          const y = n.y ?? 0;
          ctx.globalAlpha = alpha;

          if (n.kind === "wallet") {
            const r = (4.5 + Math.min(7, (n.owned ?? 1) * 0.7)) * sizeBoost;
            hexPath(ctx, x, y, r);
            ctx.fillStyle = "#0e1013";
            ctx.fill();
            ctx.lineWidth = 1.6;
            ctx.shadowColor = "rgba(232,234,237,0.5)";
            ctx.shadowBlur = 6;
            ctx.strokeStyle = selected ? "#ffb020" : "rgba(232,234,237,0.9)";
            ctx.stroke();
            ctx.shadowBlur = 0;
          } else {
            const r = crawlerRadius(n);
            const color = SOURCE_META[n.source!].color;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            if (n.status === "paused") {
              ctx.lineWidth = 1;
              ctx.strokeStyle = "rgba(138,144,153,0.8)";
              ctx.stroke();
            } else {
              // Мягкое свечение: чем выше репутация, тем ярче точка.
              ctx.shadowColor = color;
              ctx.shadowBlur = 4 + (n.reputation / 1000) * 10;
              ctx.fillStyle = color;
              ctx.fill();
              ctx.shadowBlur = 0;
            }
            if (n.status === "rented" || n.tier === "queen") {
              ctx.beginPath();
              ctx.arc(x, y, r + 2, 0, Math.PI * 2);
              ctx.lineWidth = 0.8;
              ctx.strokeStyle = n.status === "rented" ? "#c084fc" : "#ffb020";
              ctx.stroke();
            }
            // Вспышка при новом сигнале: расходящееся кольцо.
            const t0 = pulses.current?.get(String(n.id));
            if (t0 && visible) {
              const p = (Date.now() - t0) / PULSE_MS;
              if (p < 1) {
                ctx.beginPath();
                ctx.arc(x, y, r + 2 + p * 14, 0, Math.PI * 2);
                ctx.lineWidth = 1.5;
                ctx.strokeStyle = color;
                ctx.globalAlpha = (1 - p) * alpha;
                ctx.stroke();
                ctx.globalAlpha = alpha;
              } else pulses.current?.delete(String(n.id));
            }
          }

          if (selected) {
            ctx.beginPath();
            ctx.arc(x, y, (n.kind === "wallet" ? 9 : crawlerRadius(n) + 4) + 1, 0, Math.PI * 2);
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = "#ffb020";
            ctx.stroke();
          }
          // Подписи: в маленьком рое всегда, в большом — при приближении.
          if (((labelsAlways || scale > 2.6) && visible) || selected) {
            const r = n.kind === "wallet" ? 10 * sizeBoost : crawlerRadius(n) + 4;
            const linked = owners.get(String(n.id)) ?? [];
            // Связанный узел ниже — подпись сверху, и наоборот; без связей кошелёк подписан сверху, краулер снизу.
            const above = linked.length ? linked.reduce((sum, o) => sum + (o.y ?? 0), 0) / linked.length > y : n.kind === "wallet";
            const at = above ? y - r - 2 / scale : y + r + 2 / scale;
            if (n.kind === "wallet")
              drawLabel(ctx, x, at, scale, n.label, `wallet · ${n.owned ?? 0} crawler${n.owned === 1 ? "" : "s"}`, "rgba(138,144,153,0.95)", above);
            else {
              const m = SOURCE_META[n.source!];
              drawLabel(ctx, x, at, scale, n.label, `${m.label} · ${n.tier ?? ""}${n.status === "paused" ? " · paused" : ""}`, m.color, above);
            }
          }
          ctx.globalAlpha = 1;
        }}
        nodePointerAreaPaint={(n, color, ctx) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(n.x ?? 0, n.y ?? 0, n.kind === "wallet" ? 8 : crawlerRadius(n) + 2, 0, Math.PI * 2);
          ctx.fill();
        }}
      />
      <div className="pointer-events-none absolute left-3 top-3 hidden max-w-[18rem] sm:block rounded-lg border border-line bg-panel/70 px-2.5 py-1.5 text-[11px] leading-snug text-muted backdrop-blur">
        Dots are live crawlers, coloured by source and sized by reputation. Hexagons are the wallets that spawned them. Rings flash on a new signal. Click anything to inspect.
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-3 rounded-lg bg-panel/60 px-2 py-1 text-[11px] text-muted backdrop-blur">
        {Object.entries(SOURCE_META).map(([k, m]) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: m.color }} />
            {m.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <svg width="10" height="10" viewBox="-6 -6 12 12">
            <path d="M5.2 3 0 6-5.2 3v-6L0-6l5.2 3z" fill="none" stroke="#e8eaed" strokeWidth="1.2" />
          </svg>
          Wallet
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full border border-muted" /> Paused
        </span>
      </div>
    </div>
  );
}
