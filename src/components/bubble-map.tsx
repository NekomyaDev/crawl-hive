"use client";
// Бабл-карта держателей: каждый кружок — кошелёк, размер — доля, цвет — оператор (кошельки с общим спонсором,
// деньгами от дева или самим девом). Линии — кто кого пополнил. Раскладка — простая физика, детерминированная:
// одинаковые данные всегда дают одинаковую картинку, без зависимостей.
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

export interface BubbleNode {
  w: string;
  pct: number;
  g: number;
  roles: string[];
  hub?: boolean;
}
export interface BubbleMapData {
  nodes: BubbleNode[];
  links: [number, number][];
}
interface Op {
  wallets: number;
  pct: number;
  roles: string[];
  devLinked: boolean;
}

// Цвета маскотов: оранжевый, розовый, лайм, голубой, фиолетовый, бирюзовый.
const COLORS = ["#ff9f1c", "#f472b6", "#a3e635", "#60a5fa", "#c084fc", "#2dd4bf"];
// Одиночные кошельки — каждый свой владелец, поэтому у каждого свой мягкий цвет, без свечения и связей.
const SOFT = ["#fcd34d", "#fda4af", "#bbf7d0", "#bae6fd", "#e9d5ff", "#99f6e4", "#fed7aa", "#fbcfe8"];
const PALETTE = [...COLORS, ...SOFT];
const W = 760;
const H = 460;
const ROLE_ICON: Record<string, string> = { sniper: "🎯", bundle: "🔗", dev: "🧑‍💻" };

const paletteIdx = (n: BubbleNode, i: number) => (n.g >= 0 ? n.g % COLORS.length : COLORS.length + (i % SOFT.length));
const colorOf = (n: BubbleNode, i: number) => PALETTE[paletteIdx(n, i)];
const isDev = (n: BubbleNode) => n.roles.includes("dev");
const short = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;

function layout(data: BubbleMapData) {
  const n = data.nodes.length;
  // Размер — от доли относительно самого крупного кошелька: разница между китом и мелочью видна сразу.
  const max = Math.max(...data.nodes.map((x) => x.pct), 0.01);
  const r = data.nodes.map((x) => (x.hub ? (isDev(x) ? 16 : 11) : 14 + 52 * Math.sqrt(Math.max(x.pct, 0) / max)));
  const groups = [...new Set(data.nodes.map((x) => x.g))];
  // Старт: группы по кругу, внутри группы — маленький круг; одиночки — по внешнему кольцу.
  const pos = data.nodes.map((node, i) => {
    const gi = groups.indexOf(node.g);
    const a = (gi / Math.max(groups.length, 1)) * Math.PI * 2 + i * 0.7;
    const d = node.g < 0 ? 190 : 110;
    return { x: W / 2 + Math.cos(a) * d + Math.sin(i * 12.9) * 20, y: H / 2 + Math.sin(a) * d * 0.7 + Math.cos(i * 7.3) * 20 };
  });
  for (let step = 0; step < 320; step++) {
    const cool = 1 - step / 320;
    const f = pos.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const dx = pos[j].x - pos[i].x;
        const dy = pos[j].y - pos[i].y;
        const d = Math.hypot(dx, dy) || 0.01;
        const min = r[i] + r[j] + 6;
        // Разные операторы держатся дальше друг от друга, чтобы кучки читались.
        const same = data.nodes[i].g === data.nodes[j].g && data.nodes[i].g >= 0;
        const want = same ? min : min + 26;
        if (d < want) {
          const k = ((want - d) / d) * 0.5;
          f[i].x -= dx * k;
          f[i].y -= dy * k;
          f[j].x += dx * k;
          f[j].y += dy * k;
        }
      }
    for (const [a, b] of data.links) {
      const dx = pos[b].x - pos[a].x;
      const dy = pos[b].y - pos[a].y;
      const d = Math.hypot(dx, dy) || 0.01;
      const k = ((d - (r[a] + r[b] + 18)) / d) * 0.08;
      f[a].x += dx * k;
      f[a].y += dy * k;
      f[b].x -= dx * k;
      f[b].y -= dy * k;
    }
    for (let i = 0; i < n; i++) {
      // Лёгкое притяжение к центру, у одиночек слабее — они остаются по краям.
      const pull = data.nodes[i].g < 0 ? 0.004 : 0.012;
      f[i].x += (W / 2 - pos[i].x) * pull;
      f[i].y += (H / 2 - pos[i].y) * pull * 1.4;
      pos[i].x = Math.min(W - r[i] - 4, Math.max(r[i] + 4, pos[i].x + f[i].x * (0.4 + cool)));
      pos[i].y = Math.min(H - r[i] - 4, Math.max(r[i] + 4, pos[i].y + f[i].y * (0.4 + cool)));
    }
  }
  // Подгоняем окно под содержимое: без пустых полей, с сохранением пропорций.
  const minX = Math.min(...pos.map((p, i) => p.x - r[i])) - 24;
  const maxX = Math.max(...pos.map((p, i) => p.x + r[i])) + 24;
  const minY = Math.min(...pos.map((p, i) => p.y - r[i])) - 24;
  const maxY = Math.max(...pos.map((p, i) => p.y + r[i])) + 24;
  let vw = Math.max(maxX - minX, 360);
  let vh = Math.max(maxY - minY, 220);
  if (vw / vh > W / H) vh = vw / (W / H);
  else vw = vh * (W / H);
  const vb = { x: (minX + maxX) / 2 - vw / 2, y: (minY + maxY) / 2 - vh / 2, w: vw, h: vh };
  return { pts: pos.map((p, i) => ({ ...p, r: r[i] })), vb };
}

export function BubbleMap({ data, ops, chain = "solana", className }: { data: BubbleMapData; ops?: Op[]; chain?: string; className?: string }) {
  const { pts: pos, vb } = useMemo(() => layout(data), [data]);
  const [hover, setHover] = useState<number | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const lit = (g: number) => focus === null || focus === g;
  const explorer = (w: string) => (chain === "solana" ? `https://solscan.io/account/${w}` : `https://${chain === "bsc" ? "bscscan.com" : chain === "base" ? "basescan.org" : "robin.etherscan.io"}/address/${w}`);
  const h = hover === null ? null : data.nodes[hover];

  return (
    <div className={cn("overflow-hidden rounded-2xl border border-line bg-[#07080b]", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
        <div className="text-sm font-bold">
          🫧 Bubble map <span className="font-normal text-muted">· who really holds it</span>
        </div>
        <div className="flex gap-3 text-[11px] text-muted">
          <span>🎯 sniper</span>
          <span>🔗 bundle</span>
          <span>🧑‍💻 dev</span>
          <span>◦ funder</span>
        </div>
      </div>
      <div className="relative">
        <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} className="block w-full" role="img" aria-label="Bubble map of top holders, snipers and the dev">
          <defs>
            <radialGradient id="bm-bg" cx="50%" cy="45%" r="70%">
              <stop offset="0%" stopColor="#1a1030" />
              <stop offset="100%" stopColor="#07080b" />
            </radialGradient>
            {PALETTE.map((c, i) => (
              <radialGradient key={c} id={`bm-g${i}`} cx="35%" cy="30%" r="75%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
                <stop offset="22%" stopColor={c} stopOpacity={i < COLORS.length ? 0.97 : 0.8} />
                <stop offset="100%" stopColor={c} stopOpacity={i < COLORS.length ? 0.6 : 0.35} />
              </radialGradient>
            ))}
            <filter id="bm-halo" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="28" />
            </filter>
            <filter id="bm-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="6" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <rect x={vb.x - 400} y={vb.y - 400} width={vb.w + 800} height={vb.h + 800} fill="url(#bm-bg)" />
          {/* гексы на фоне, как пол на картинках с маскотами */}
          <g opacity="0.07" stroke="#ffb020" fill="none">
            {Array.from({ length: 18 }, (_, row) =>
              Array.from({ length: 26 }, (_, col) => {
                const x = col * 58 + (row % 2) * 29 - 380;
                const y = row * 50 - 230;
                return <polygon key={`${row}-${col}`} points={`${x},${y - 18} ${x + 16},${y - 9} ${x + 16},${y + 9} ${x},${y + 18} ${x - 16},${y + 9} ${x - 16},${y - 9}`} />;
              }),
            )}
          </g>
          {/* мягкое свечение за каждым оператором: группы видны издалека */}
          {[...new Set(data.nodes.map((x) => x.g).filter((g) => g >= 0))].map((g) => {
            const idx = data.nodes.map((x, i) => (x.g === g ? i : -1)).filter((i) => i >= 0);
            const cx = idx.reduce((s2, i) => s2 + pos[i].x, 0) / idx.length;
            const cy = idx.reduce((s2, i) => s2 + pos[i].y, 0) / idx.length;
            const rr = Math.max(...idx.map((i) => Math.hypot(pos[i].x - cx, pos[i].y - cy) + pos[i].r)) + 18;
            return <circle key={`halo${g}`} cx={cx} cy={cy} r={rr} fill={COLORS[g % COLORS.length]} opacity={lit(g) ? 0.22 : 0.04} filter="url(#bm-halo)" />;
          })}
          {data.links.map(([a, b], i) => {
            const c = data.nodes[a].g >= 0 ? colorOf(data.nodes[a], a) : colorOf(data.nodes[b], b);
            const on = lit(data.nodes[a].g) || lit(data.nodes[b].g);
            return (
              <g key={i} opacity={on ? 1 : 0.1}>
                <line x1={pos[a].x} y1={pos[a].y} x2={pos[b].x} y2={pos[b].y} stroke={c} strokeWidth={6} strokeOpacity={0.35} filter="url(#bm-glow)" />
                <line x1={pos[a].x} y1={pos[a].y} x2={pos[b].x} y2={pos[b].y} stroke="#fff" strokeWidth={2} strokeOpacity={0.85} strokeDasharray="4 8" strokeLinecap="round" className="bm-flow" />
              </g>
            );
          })}
          {data.nodes.map((node, i) => {
            const p = pos[i];
            const ci = paletteIdx(node, i);
            const c = colorOf(node, i);
            const on = lit(node.g);
            const icon = node.roles.map((x) => ROLE_ICON[x]).filter(Boolean)[0];
            return (
              <g
                key={node.w}
                className="bm-node cursor-pointer"
                style={{ animationDelay: `${Math.min(i, 20) * 0.04}s, ${(i % 7) * 0.4}s`, opacity: on ? 1 : 0.18, transformOrigin: `${p.x}px ${p.y}px` }}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onClick={() => window.open(explorer(node.w), "_blank", "noopener")}
              >
                {node.hub ? (
                  <>
                    {isDev(node) && <circle cx={p.x} cy={p.y} r={p.r + 5} fill="none" stroke="#f87171" strokeWidth={3} strokeDasharray="4 3" />}
                    <circle cx={p.x} cy={p.y} r={p.r} fill="#0b0c0f" stroke={isDev(node) ? "#f87171" : c} strokeWidth={3} filter="url(#bm-glow)" />
                    {!isDev(node) && <circle cx={p.x} cy={p.y} r={p.r * 0.38} fill={c} />}
                    {isDev(node) && (
                      <text x={p.x} y={p.y + 6} textAnchor="middle" fontSize={17}>
                        🧑‍💻
                      </text>
                    )}
                  </>
                ) : (
                  <>
                    {node.roles.includes("dev") && <circle cx={p.x} cy={p.y} r={p.r + 5} fill="none" stroke="#f87171" strokeWidth={3} strokeDasharray="4 3" />}
                    <circle cx={p.x} cy={p.y} r={p.r} fill={`url(#bm-g${ci})`} stroke={node.g >= 0 ? "#fff" : c} strokeOpacity={node.g >= 0 ? 0.9 : 0.6} strokeWidth={hover === i ? 3.5 : node.g >= 0 ? 2.5 : 1.2} filter={node.g >= 0 ? "url(#bm-glow)" : undefined} />
                    {/* блик, как на глянцевых маскотах */}
                    <ellipse cx={p.x - p.r * 0.32} cy={p.y - p.r * 0.42} rx={p.r * 0.36} ry={p.r * 0.2} fill="#fff" opacity={0.5} transform={`rotate(-28 ${p.x - p.r * 0.32} ${p.y - p.r * 0.42})`} />
                    {p.r >= 26 && (
                      <text x={p.x} y={p.y + (icon && p.r >= 34 ? 12 : 5)} textAnchor="middle" fontSize={Math.min(22, p.r * 0.42)} fontWeight={800} fill="#0b0c0f">
                        {node.pct >= 10 ? node.pct.toFixed(0) : node.pct.toFixed(1)}%
                      </text>
                    )}
                    {icon && (
                      <text x={p.x} y={p.r >= 34 ? p.y - 8 : p.y + 5} textAnchor="middle" fontSize={p.r >= 34 ? 18 : Math.max(10, p.r * 0.9)}>
                        {icon}
                      </text>
                    )}
                  </>
                )}
              </g>
            );
          })}
        </svg>
        {h && (
          <div
            className="pointer-events-none absolute z-10 rounded-lg border border-line bg-panel/95 px-3 py-2 text-xs shadow-xl"
            style={{ left: `${((pos[hover!].x - vb.x) / vb.w) * 100}%`, top: `${((pos[hover!].y - vb.y) / vb.h) * 100}%`, transform: "translate(-50%, calc(-100% - 14px))" }}
          >
            <div className="num font-semibold">{short(h.w)}</div>
            <div className="text-muted">
              {h.hub ? (isDev(h) ? "the dev: holds nothing now" : "funder of linked wallets") : `holds ${h.pct.toFixed(2)}%`}
              {h.roles.length ? ` · ${h.roles.join(" + ")}` : ""}
              {h.g >= 0 ? ` · operator ${h.g + 1}` : ""}
            </div>
          </div>
        )}
      </div>
      {!!ops?.length && (
        <div className="flex flex-wrap gap-2 px-4 pb-3 pt-1">
          {ops.map((o, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setFocus(focus === i ? null : i)}
              className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors", focus === i ? "bg-white/10" : "hover:bg-white/5")}
              style={{ borderColor: `${COLORS[i % COLORS.length]}88` }}
            >
              <span className="size-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length], boxShadow: `0 0 8px ${COLORS[i % COLORS.length]}` }} />
              <span className="font-semibold">Operator {i + 1}</span>
              <span className="text-muted">
                {o.wallets} wallets · {o.pct.toFixed(1)}%{o.roles.length ? ` · ${o.roles.join("+")}` : ""}
              </span>
            </button>
          ))}
        </div>
      )}
      <p className="px-4 pb-3 text-[10px] text-muted">Top holders, first-block snipers and the dev. Glowing bubbles of one color are one owner (shared funder or dev money), lines show who funded whom. Pools and curves are left out. Click a bubble to open the wallet.</p>
    </div>
  );
}
