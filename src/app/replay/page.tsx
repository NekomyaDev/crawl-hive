"use client";
// Gem Replay и Rug Replay: что сканер назвал заранее и чем это кончилось. Попадания показываем крупно, но рядом
// всегда честные счётчики промахов и ссылка на полный Track Record — выборка без них была бы рекламой.
import Link from "next/link";
import { useState } from "react";
import { Gem, Skull } from "lucide-react";
import { VerdictPill } from "@/components/verdict";
import { LivePill } from "@/components/radar-scope";
import { useApi } from "@/lib/client/use-api";
import { cn, fmt, timeAgo } from "@/lib/utils";

interface Row {
  id: string;
  chain: string;
  symbol: string;
  name: string | null;
  verdict: string;
  score: number | null;
  src: "scan" | "crawler" | "radar" | "agent";
  at: number;
  fdv0: number | null;
  multiple: number | null;
  hoursToPeak: number | null;
  lowPct: number | null;
  rugged: boolean;
}
interface Feed {
  gems: Row[];
  rugs: Row[];
  stats: { good: number; goodDoubled: number; goodDumped: number; danger: number; dangerDumped: number; gems: number; rugs: number };
}

const SRC: Record<Row["src"], string> = { scan: "user scan", radar: "Launch Radar", crawler: "crawler check", agent: "AI agent" };
const CHAIN: Record<string, string> = { solana: "Solana", robinhood: "Robinhood", bsc: "BNB" };
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "-");

function Card({ r, kind }: { r: Row; kind: "gem" | "rug" }) {
  const gem = kind === "gem";
  return (
    <Link
      href={`/scan/${r.id}`}
      className={cn("flex flex-col rounded-2xl border bg-panel p-4 transition-colors", gem ? "border-line hover:border-lime/50" : "border-line hover:border-danger/50")}
    >
      <div className="flex items-center gap-3">
        <span className={cn("grid size-11 shrink-0 place-items-center rounded-full border-2 bg-bg font-bold", gem ? "border-lime text-lime" : "border-danger text-danger")}>{r.symbol.slice(0, 1).toUpperCase()}</span>
        <div className="min-w-0 flex-1">
          <div className="num truncate text-lg font-bold">${r.symbol}</div>
          <div className="truncate text-xs text-muted">
            {CHAIN[r.chain] ?? r.chain} · {SRC[r.src]} · {timeAgo(r.at)}
          </div>
        </div>
        <VerdictPill verdict={r.verdict} score={r.score} />
      </div>
      <div className={cn("mt-3 rounded-xl border p-3", gem ? "border-lime/40 bg-lime/[0.06]" : "border-danger/40 bg-danger/[0.06]")}>
        {gem ? (
          <>
            <div className="num text-3xl font-black text-lime">×{r.multiple}</div>
            <div className="num text-xs text-muted">
              {r.fdv0 ? `$${fmt(r.fdv0)} at scan → peak $${fmt(r.fdv0 * (r.multiple ?? 1))}` : "peak within 24h of the scan"}
              {r.hoursToPeak != null ? ` · ${r.hoursToPeak < 1 ? `${Math.round(r.hoursToPeak * 60)} min` : `${r.hoursToPeak}h`} to peak` : ""}
            </div>
          </>
        ) : (
          <>
            <div className="num text-3xl font-black text-danger">{r.rugged ? "Rugged" : `${Math.round(r.lowPct ?? -90)}%`}</div>
            <div className="num text-xs text-muted">
              {r.rugged ? "liquidity pulled" : "fell from the scan price"} within 24h{r.fdv0 ? ` · $${fmt(r.fdv0)} at scan` : ""}
            </div>
          </>
        )}
      </div>
    </Link>
  );
}

export default function ReplayPage() {
  const { data } = useApi<Feed>("/api/replay", 120_000);
  const [tab, setTab] = useState<"gem" | "rug">("gem");
  const s = data?.stats;
  const rows = tab === "gem" ? data?.gems : data?.rugs;
  return (
    <>
      <section className="mb-6">
        <LivePill tone="bg-pink">Updated every 10 minutes from the Track Record</LivePill>
        <h1 className="mt-4 text-4xl leading-none font-bold tracking-tight lg:text-6xl">
          <span className="bg-gradient-to-r from-lime to-teal bg-clip-text text-transparent">Gem</span> &amp; <span className="bg-gradient-to-r from-danger to-coral bg-clip-text text-transparent">Rug</span> Replay
        </h1>
        <p className="mt-4 max-w-2xl text-fg/85">Coins the swarm called before the move. Gem Replay: rated CLEAN or OK, then at least doubled within 24 hours. Rug Replay: rated DANGER, then fell 90% or lost their liquidity.</p>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Hits only tell half the story, so the misses are right here too. Every verdict, good or bad, is on the{" "}
          <Link href="/track" className="text-honey hover:underline">
            Track Record
          </Link>{" "}
          and hashed onchain.
        </p>
      </section>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-lime/40 bg-lime/[0.05] p-4">
          <div className="text-xs text-muted">CLEAN / OK that doubled</div>
          <div className="num mt-1 text-3xl font-black text-lime">{s ? pct(s.goodDoubled, s.good) : "-"}</div>
          <div className="num text-xs text-muted">{s ? `${s.goodDoubled} of ${s.good} settled` : ""}</div>
        </div>
        <div className="rounded-2xl border border-danger/40 bg-danger/[0.05] p-4">
          <div className="text-xs text-muted">DANGER that dumped</div>
          <div className="num mt-1 text-3xl font-black text-danger">{s ? pct(s.dangerDumped, s.danger) : "-"}</div>
          <div className="num text-xs text-muted">{s ? `${s.dangerDumped} of ${s.danger} settled` : ""}</div>
        </div>
        <div className="rounded-2xl border border-honey/40 bg-honey/[0.05] p-4">
          <div className="text-xs text-muted">Our misses: CLEAN / OK that dumped anyway</div>
          <div className="num mt-1 text-3xl font-black text-honey">{s ? pct(s.goodDumped, s.good) : "-"}</div>
          <div className="num text-xs text-muted">{s ? `${s.goodDumped} of ${s.good} settled · memecoins are risky even when clean` : ""}</div>
        </div>
      </div>

      <div className="mb-4 flex gap-2">
        <button type="button" onClick={() => setTab("gem")} className={cn("inline-flex items-center gap-1.5 rounded-xl border px-4 py-2 text-sm font-bold", tab === "gem" ? "border-lime/70 bg-lime/15 text-lime" : "border-line text-muted hover:text-fg")}>
          <Gem className="size-4" /> Gem Replay {s ? `(${s.gems})` : ""}
        </button>
        <button type="button" onClick={() => setTab("rug")} className={cn("inline-flex items-center gap-1.5 rounded-xl border px-4 py-2 text-sm font-bold", tab === "rug" ? "border-danger/70 bg-danger/15 text-danger" : "border-line text-muted hover:text-fg")}>
          <Skull className="size-4" /> Rug Replay {s ? `(${s.rugs})` : ""}
        </button>
      </div>

      {data && !rows?.length ? (
        <div className="rounded-2xl border border-line bg-panel px-4 py-12 text-center text-sm text-muted">Nothing here yet. Verdicts settle 24 hours after the scan.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(rows ?? []).map((r) => (
            <Card key={`${r.id}-${r.at}`} r={r} kind={tab} />
          ))}
        </div>
      )}
      <p className="mt-4 text-xs text-muted">Peaks are measured every 10 minutes for 24 hours after the scan. Moves over ×50 in a day and pools under $2k at scan are left out as likely price errors. Not financial advice.</p>
    </>
  );
}
