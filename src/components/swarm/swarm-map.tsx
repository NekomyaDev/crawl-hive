"use client";
// Обёртка карты: данные, фильтры, real-time вспышки, панель выбранной точки.
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X as Close } from "lucide-react";
import { api } from "@/lib/client/api";
import { useStream } from "@/lib/client/use-stream";
import { Card } from "@/components/ui/card";
import { Chips, Segmented } from "@/components/ui/field";
import { NarrativeBadge, RepScore, SourceBadge, StatusBadge, TierBadge } from "@/components/ui/badge";
import { NARRATIVES, CHAINS, SOURCES } from "@/lib/types";
import type { NetworkStats, Signal, SwarmLink, SwarmNode } from "@/lib/types";
import { NARRATIVE_LABEL, SOURCE_META, short } from "@/lib/utils";
import type { GNode } from "./swarm-canvas";

const SwarmCanvas = dynamic(() => import("./swarm-canvas"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-muted">Hatching the swarm…</div>,
});

interface SwarmResponse {
  nodes: SwarmNode[];
  links: SwarmLink[];
  stats: NetworkStats;
  signals: Signal[];
}

type LinkIn = { source: string | GNode; target: string | GNode; kind: SwarmLink["kind"] };

export function SwarmMap({
  onStats,
  onSignals,
  height = 560,
}: {
  onStats?: (s: NetworkStats) => void;
  onSignals?: (s: Signal[]) => void;
  height?: number;
}) {
  const [nodes, setNodes] = useState<GNode[]>([]);
  // Канвас монтируем только после гидратации: иначе, если чанк уже в кэше, клиент рендерит
  // граф сразу, а в HTML с сервера была заглушка — React ругается на расхождение (#418).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [links, setLinks] = useState<LinkIn[]>([]);
  const byId = useRef(new Map<string, GNode>());
  const pulses = useRef(new Map<string, number>());
  const linkSig = useRef("");
  const [selected, setSelected] = useState<GNode | null>(null);

  const [narratives, setNarratives] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [chain, setChain] = useState<string>("all");
  const [minRep, setMinRep] = useState(0);

  // Слияние свежего снапшота в существующие объекты: позиции точек сохраняются.
  const merge = useCallback(
    (r: SwarmResponse) => {
      let changed = false;
      const owned = new Map<string, number>();
      for (const l of r.links) if (l.kind === "owns") owned.set(l.source, (owned.get(l.source) ?? 0) + 1);
      const seen = new Set<string>();
      for (const n of r.nodes) {
        seen.add(n.id);
        const ex = byId.current.get(n.id);
        if (ex) Object.assign(ex, n, { owned: owned.get(n.id) });
        else {
          byId.current.set(n.id, { ...n, owned: owned.get(n.id) });
          changed = true;
        }
      }
      for (const id of [...byId.current.keys()])
        if (!seen.has(id)) {
          byId.current.delete(id);
          changed = true;
        }
      const sig = r.links.map((l) => `${l.source}>${l.target}:${l.kind}`).sort().join("|");
      if (sig !== linkSig.current) {
        linkSig.current = sig;
        setLinks(r.links.map((l) => ({ ...l })));
        changed = true;
      }
      if (changed) setNodes([...byId.current.values()]);
      onStats?.(r.stats);
    },
    [onStats],
  );

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<SwarmResponse>("/api/swarm")
        .then((r) => {
          if (!alive) return;
          merge(r);
          onSignals?.(r.signals);
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 8000);
    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merge]);

  useStream((e) => {
    if (e.type === "signal") pulses.current.set(e.signal.crawlerId, Date.now());
    if (e.type === "status") {
      const n = byId.current.get(e.id);
      if (n) n.status = e.status;
    }
    if (e.type === "spawn" || e.type === "trade") api<SwarmResponse>("/api/swarm").then(merge).catch(() => {});
  });

  const isVisible = useCallback(
    (n: GNode) => {
      if (n.kind === "wallet") return !narratives.length && !sources.length && chain === "all" && minRep === 0;
      if (narratives.length && !n.narratives?.some((x) => narratives.includes(x))) return false;
      if (sources.length && !sources.includes(n.source!)) return false;
      if (chain !== "all" && n.chain !== chain) return false;
      return n.reputation >= minRep;
    },
    [narratives, sources, chain, minRep],
  );

  const visibleCount = useMemo(
    () => nodes.filter((n) => n.kind === "crawler" && isVisible(n)).length,
    [nodes, isVisible],
  );

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold">
            Swarm map <span className="num ml-1 font-normal text-muted">{visibleCount} crawlers in view</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Segmented options={["all", ...CHAINS] as const} value={chain as "all"} onChange={setChain} />
            <label className="flex items-center gap-2 text-xs text-muted">
              min rep
              <input
                type="range"
                min={0}
                max={900}
                step={50}
                value={minRep}
                onChange={(e) => setMinRep(Number(e.target.value))}
                className="w-24 accent-[var(--honey)]"
              />
              <span className="num w-7 text-fg">{minRep}</span>
            </label>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <Chips options={NARRATIVES} value={narratives as never[]} onChange={setNarratives} render={(n) => `#${NARRATIVE_LABEL[n]}`} />
          <Chips options={SOURCES} value={sources as never[]} onChange={setSources} render={(s) => SOURCE_META[s].label} />
        </div>
      </div>

      <div className="relative">
        {mounted ? (
          <SwarmCanvas
            nodes={nodes}
            links={links as never}
            isVisible={isVisible}
            selectedId={selected ? String(selected.id) : null}
            pulses={pulses}
            onSelect={setSelected}
            height={height}
          />
        ) : (
          <div className="grid place-items-center text-sm text-muted" style={{ height }}>
            Hatching the swarm…
          </div>
        )}
        {selected && <NodePanel node={selected} onClose={() => setSelected(null)} />}
      </div>
    </Card>
  );
}

function NodePanel({ node, onClose }: { node: GNode; onClose: () => void }) {
  return (
    <div className="absolute right-3 top-3 w-64 rounded-xl border border-line bg-panel/95 p-4 shadow-2xl backdrop-blur">
      <button onClick={onClose} className="absolute right-3 top-3 text-muted hover:text-fg">
        <Close className="size-4" />
      </button>
      {node.kind === "wallet" ? (
        <>
          <div className="text-[11px] uppercase tracking-wider text-muted">Wallet</div>
          <div className="num mt-1 break-all text-sm">{short(String(node.id))}</div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="text-muted">Crawlers</div>
              <div className="num text-base">{node.owned ?? 0}</div>
            </div>
            <div>
              <div className="text-muted">Avg rep</div>
              <RepScore rep={node.reputation} className="text-base" />
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="num text-[11px] text-muted">{node.id}</div>
          <div className="mt-0.5 pr-5 font-semibold">{node.label}</div>
          <div className="mt-2 flex flex-wrap gap-1">
            <SourceBadge source={node.source!} />
            <TierBadge tier={node.tier!} />
            <StatusBadge status={node.status!} />
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {node.narratives?.map((n) => <NarrativeBadge key={n} n={n} />)}
          </div>
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-muted">Reputation</span>
            <RepScore rep={node.reputation} />
          </div>
          <Link
            href={`/crawler/${node.id}`}
            className="mt-3 block rounded-lg border border-line py-1.5 text-center text-xs hover:border-honey/60 hover:text-honey"
          >
            Open crawler →
          </Link>
        </>
      )}
    </div>
  );
}
