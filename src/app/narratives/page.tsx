"use client";
// Narrative Radar: что охотник платформы нашёл в X. Это ничей краулер: он работает для всех, а у каждого
// нарратива есть кнопка «Launch this narrative», которая открывает Clean Launch с готовыми полями.
import Link from "next/link";
import { useMemo, useState } from "react";
import { ExternalLink, Rocket } from "lucide-react";
import { VerdictPill } from "@/components/verdict";
import { Chip, LivePill, RadarScope } from "@/components/radar-scope";
import { useApi } from "@/lib/client/use-api";
import { launchHrefFor } from "@/lib/narrative";
import { cn, timeAgo } from "@/lib/utils";

interface Item {
  id: string;
  title: string;
  why: string;
  ticker: string;
  heat: string;
  kind: string;
  posts: string[];
  clones: number | null;
  at: number;
  launched: { mint: string; symbol: string; verdict: string | null; score: number | null } | null;
}
interface Feed {
  items: Item[];
  enabled: boolean;
  lastAt: number | null;
  nextAt: number | null;
  everyH: number;
  day: { found: number; hot: number; fresh: number };
}

const HEAT: Record<string, { t: string; c: string; color: string; r: number; bar: number }> = {
  hot: { t: "🔥 hot", c: "border-coral/60 bg-coral/10 text-coral", color: "var(--coral)", r: 0.12, bar: 100 },
  rising: { t: "📈 rising", c: "border-honey/60 bg-honey/10 text-honey", color: "var(--honey)", r: 0.48, bar: 66 },
  early: { t: "🌱 early", c: "border-lime/50 bg-lime/10 text-lime", color: "var(--lime)", r: 0.82, bar: 33 },
};
const GLYPH: Record<string, string> = { meme: "😂", ai: "🤖", animal: "🐾", tech: "💻", culture: "🎭", crypto: "🪙", other: "✨" };

function inH(ts: number) {
  const m = Math.max(0, Math.round((ts - Date.now()) / 60_000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function Box({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="min-w-[110px] rounded-xl border border-line bg-panel/70 px-3 py-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={cn("num mt-0.5 text-xl font-bold", tone)}>{value}</div>
    </div>
  );
}

function NarrativeCard({ n, active }: { n: Item; active: boolean }) {
  const heat = HEAT[n.heat] ?? HEAT.early;
  return (
    <div
      id={`n-${n.id}`}
      className={cn(
        "flex scroll-mt-24 flex-col rounded-2xl border bg-panel p-4 transition-all",
        active ? "border-violet/70 shadow-[0_0_28px_rgba(167,139,250,.35)]" : "border-line hover:border-violet/40",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="grid size-11 shrink-0 place-items-center rounded-full border-2 bg-bg text-xl" style={{ borderColor: heat.color, boxShadow: `0 0 14px color-mix(in oklab, ${heat.color} 45%, transparent)` }}>
          {GLYPH[n.kind] ?? "✨"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="num truncate text-lg font-bold">${n.ticker}</span>
            <span className="num rounded-full border border-line px-1.5 text-[10px] text-muted">{timeAgo(n.at)}</span>
          </div>
          <div className="truncate text-sm text-fg/80">{n.title}</div>
        </div>
        <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold", heat.c)}>{heat.t}</span>
      </div>

      <p className="mt-3 flex-1 text-sm leading-snug text-fg/85">{n.why}</p>

      <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-line bg-bg/60 p-2.5">
        <div>
          <div className="text-[10px] text-muted uppercase tracking-wider">Heat</div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line/70">
            <div className="h-full rounded-full" style={{ width: `${heat.bar}%`, background: heat.color }} />
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-muted uppercase tracking-wider">Coins on ticker, 24h</div>
          <div className={cn("num text-sm font-bold", n.clones === 0 ? "text-lime" : n.clones ? "text-honey" : "text-muted")}>{n.clones === null ? "—" : n.clones === 0 ? "0 · fresh" : n.clones}</div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {n.posts.map((u, i) => (
          <a key={u} href={u} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-sky hover:underline">
            <ExternalLink className="size-3" /> post {i + 1} · verified
          </a>
        ))}
      </div>

      {n.launched ? (
        <Link href={`/scan/${n.launched.mint}`} className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-lime/40 bg-lime/[0.06] px-3 py-2 text-sm hover:bg-lime/10">
          <span>
            <Rocket className="mr-1 inline size-3.5 text-lime" /> Launched: <b>${n.launched.symbol}</b>
          </span>
          {n.launched.verdict ? <VerdictPill verdict={n.launched.verdict} score={n.launched.score} /> : <span className="text-[11px] text-muted">scanning…</span>}
        </Link>
      ) : (
        <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
          <Link
            href={launchHrefFor({ title: n.title, ticker: n.ticker, why: n.why, post: n.posts[0] })}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-honey via-coral to-pink px-3 py-2 text-sm font-extrabold text-black hover:opacity-90"
          >
            <Rocket className="size-4" /> Launch this narrative
          </Link>
          {n.posts[0] && (
            <a href={n.posts[0]} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-xl border border-line px-3 py-2 text-sm hover:border-sky/60 hover:text-sky">
              On X <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export default function NarrativesPage() {
  const { data } = useApi<Feed>("/api/narratives", 60_000);
  const [heat, setHeat] = useState<string>("all");
  const [active, setActive] = useState<string | null>(null);
  const d = data?.day;
  const items = useMemo(() => (data?.items ?? []).filter((n) => heat === "all" || (heat === "fresh" ? n.clones === 0 : n.heat === heat)), [data, heat]);
  const blips = items.slice(0, 18).map((n) => ({ id: n.id, label: `$${n.ticker}`, glyph: GLYPH[n.kind] ?? "✨", color: (HEAT[n.heat] ?? HEAT.early).color, r: (HEAT[n.heat] ?? HEAT.early).r + Math.min(0.12, (Date.now() - n.at) / 864e5 / 8) }));
  const pick = (id: string) => {
    setActive(id);
    document.getElementById(`n-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <>
      <section className="mb-8 grid items-center gap-8 lg:grid-cols-[1.15fr_1fr]">
        <div>
          <LivePill tone="bg-violet">
            {data?.enabled === false ? "Resting" : `Live · hunts X every ${data?.everyH ?? 3} hours`}
            {data?.nextAt ? ` · next in ${inH(data.nextAt)}` : ""}
          </LivePill>
          <h1 className="mt-4 text-4xl leading-none font-bold tracking-tight lg:text-6xl">
            Narrative <span className="bg-gradient-to-r from-violet via-pink to-honey bg-clip-text text-transparent">Radar</span>
          </h1>
          <p className="mt-4 max-w-xl text-fg/85">What is starting to spread on X right now, found by the platform&apos;s own Narrative Hunter. Nobody owns it: every find is here for everyone.</p>
          <p className="mt-1 max-w-xl text-sm text-muted">Every post link is verified, invented ones drop out. Each narrative shows how many coins already use its ticker, and one tap turns it into a Clean Launch.</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Box label="Narratives, 24h" value={d ? d.found : "—"} tone="text-violet" />
            <Box label="Hot now" value={d ? d.hot : "—"} tone="text-coral" />
            <Box label="Fresh tickers" value={d ? d.fresh : "—"} tone="text-lime" />
            <Box label="Last hunt" value={data?.lastAt ? timeAgo(data.lastAt) : "—"} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {[
              ["all", "All"],
              ["hot", "🔥 Hot"],
              ["rising", "📈 Rising"],
              ["early", "🌱 Early"],
              ["fresh", "✓ Fresh ticker"],
            ].map(([k, t]) => (
              <Chip key={k} on={heat === k} onClick={() => setHeat(k)}>
                {t}
              </Chip>
            ))}
          </div>
        </div>
        <RadarScope blips={blips} active={active} onPick={pick} tone="var(--violet)" center="🔮" />
      </section>

      {data && !items.length ? (
        <div className="rounded-2xl border border-line bg-panel px-4 py-12 text-center text-sm text-muted">{data.items.length ? "Nothing in this filter right now." : "The first hunt is running. Narratives land here in a few minutes."}</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((n) => (
            <NarrativeCard key={n.id} n={n} active={active === n.id} />
          ))}
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-violet/30 bg-gradient-to-r from-violet/[0.08] to-transparent px-4 py-3 text-sm">
        <span className="text-muted">Want a hunter tuned to your own topics, with finds sent to Telegram the moment they appear?</span>
        <Link href="/market" className="font-semibold text-honey hover:underline">
          Narrative Hunter in the marketplace →
        </Link>
      </div>
      <p className="mt-3 text-xs text-muted">A narrative is not a coin and not a call. Launching a coin on one does not make it a good investment, and every coin launched on CrawlHive is scanned by the same rules as any other.</p>
    </>
  );
}
