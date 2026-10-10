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

function crawlerRadius(n: GNode) {
  return 3 + (n.reputation / 1000) * 7;
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
  const fitted = useRef(false);

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
    f.d3Force("charge")?.strength?.(-40);
    f.d3Force("link")?.distance?.((l: GLink) => (l.kind === "narrative" ? 40 : 22));
  }, [nodes.length]);

  // Объект graphData меняем только когда меняется состав узлов, иначе симуляция «взрывается» заново.
  const data = useMemo(() => ({ nodes, links }), [nodes, links]);

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
    <div ref={wrap} className="relative w-full" style={{ height }}>
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
          if (!fitted.current) {
            fitted.current = true;
            fg.current?.zoomToFit(600, 24);
          }
        }}
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
          return "rgba(255,255,255,0.07)";
        }}
        linkWidth={(l) => (l.kind === "rents" ? 1.2 : 0.6)}
        nodeCanvasObject={(n, ctx, scale) => {
          const visible = isVisible(n);
          const selected = n.id === selectedId;
          const near = neighbours.has(String(n.id));
          const alpha = visible ? (selectedId && !selected && !near ? 0.35 : 1) : 0.08;
          const x = n.x ?? 0;
          const y = n.y ?? 0;
          ctx.globalAlpha = alpha;

          if (n.kind === "wallet") {
            const r = 4.5 + Math.min(7, (n.owned ?? 1) * 0.7);
            hexPath(ctx, x, y, r);
            ctx.fillStyle = "#0e1013";
            ctx.fill();
            ctx.lineWidth = 1.6;
            ctx.strokeStyle = selected ? "#ffb020" : "rgba(232,234,237,0.9)";
            ctx.stroke();
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
          // Подписи появляются при приближении.
          if ((scale > 2.6 && visible) || selected) {
            ctx.font = `${10 / scale}px var(--font-geist-sans), sans-serif`;
            ctx.fillStyle = "rgba(232,234,237,0.85)";
            ctx.textAlign = "center";
            ctx.fillText(n.label, x, y + (n.kind === "wallet" ? 9 : crawlerRadius(n) + 3) + 9 / scale);
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
      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-3 text-[11px] text-muted">
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
