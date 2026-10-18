"use client";
// «Новое в рое»: живые плитки свежих функций с настоящими данными — Narrative Radar, Clean Launch, Launch Radar, Track Record.
import Link from "next/link";
import { ArrowRight, Radar, Rocket, Sparkles, Target } from "lucide-react";
import { VerdictPill } from "@/components/verdict";
import { useApi } from "@/lib/client/use-api";
import { cn, fmt } from "@/lib/utils";

interface RadarFeed {
  items: { id: string; symbol: string; verdict: string; score: number | null; liq: number; at: number; chain: string }[];
  waiting: number;
  day: { scanned: number; danger: number; clean: number };
}
interface NarrFeed {
  items: { id: string; ticker: string; title: string; heat: string; clones: number | null }[];
  day: { found: number };
}
interface Launches {
  launches: { mint: string; symbol: string; verdict?: string | null; score?: number | null }[];
}
interface Track {
  total: number;
  by: { verdict: string; settled: number; dumped: number }[];
  signals: { scored: number; hits: number };
}

function Tile({ href, icon, tone, title, children, cta }: { href: string; icon: React.ReactNode; tone: string; title: string; children: React.ReactNode; cta: string }) {
  return (
    <Link href={href} className="group relative flex flex-col overflow-hidden rounded-xl border border-line bg-panel p-4 transition-colors hover:border-honey/40">
      <div className={cn("pointer-events-none absolute -top-16 -right-16 size-40 rounded-full opacity-40 blur-3xl", tone)} />
      <div className="relative mb-3 flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </div>
      <div className="relative min-h-0 flex-1 text-sm">{children}</div>
      <div className="relative mt-3 inline-flex items-center gap-1 text-xs text-honey">
        {cta} <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

export function WhatsNew() {
  const { data: radar } = useApi<RadarFeed>("/api/radar", 60000);
  const { data: narr } = useApi<NarrFeed>("/api/narratives", 120000);
  const { data: launch } = useApi<Launches>("/api/launch", 120000);
  const { data: track } = useApi<Track>("/api/track", 120000);
  const by = new Map((track?.by ?? []).map((b) => [b.verdict, b]));
  const danger = by.get("DANGER");
  const good = ["CLEAN", "OK"].map((v) => by.get(v)).reduce((a, b) => ({ s: a.s + (b?.settled ?? 0), d: a.d + (b?.dumped ?? 0) }), { s: 0, d: 0 });

  return (
    <section className="mb-6">
      <div className="mb-3 flex items-end justify-between">
        <h2 className="text-lg font-semibold">
          New in the <span className="text-gradient">swarm</span>
        </h2>
        <span className="text-xs text-muted">live data</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile href="/narratives" icon={<Sparkles className="size-4 text-violet" />} tone="bg-violet" title="Narrative Radar" cta={narr?.day.found ? `${narr.day.found} narratives found today` : "See what is spreading"}>
          <ul className="space-y-1.5">
            {(narr?.items ?? []).slice(0, 3).map((n) => (
              <li key={n.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">
                  <span className="num font-medium text-honey">${n.ticker}</span> <span className="text-muted">{n.title}</span>
                </span>
                <span className="shrink-0 text-[11px]">{n.heat === "hot" ? "🔥" : n.heat === "rising" ? "📈" : "🌱"}</span>
              </li>
            ))}
            {narr && !narr.items.length && <li className="text-xs text-muted">The platform&apos;s own hunter walks X every 3 hours. First narratives land here soon.</li>}
          </ul>
        </Tile>

        <Tile href="/launch" icon={<Rocket className="size-4 text-coral" />} tone="bg-coral" title="Clean Launch" cta="Launch a coin">
          <p className="text-muted">Launch on pump.fun right from CrawlHive. 0% platform fee, Phantom signs, the swarm scans every coin at birth.</p>
          {!!launch?.launches.length && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
              {launch.launches.slice(0, 3).map((l) => (
                <span key={l.mint} className="flex items-center gap-1">
                  <span className="num font-medium">${l.symbol}</span>
                  {l.verdict && <VerdictPill verdict={l.verdict} score={l.score} />}
                </span>
              ))}
            </div>
          )}
        </Tile>

        <Tile href="/radar" icon={<Radar className="size-4 text-lime" />} tone="bg-lime" title="Launch Radar" cta={radar ? `${radar.day.scanned} launches scanned today` : "Open the radar"}>
          <ul className="space-y-1.5">
            {(radar?.items ?? []).slice(0, 3).map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">${e.symbol}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="num text-[11px] text-muted">${fmt(e.liq)}</span>
                  <VerdictPill verdict={e.verdict} score={e.score} />
                </span>
              </li>
            ))}
            {radar && !radar.items.length && <li className="text-xs text-muted">The swarm scans fresh launches on its own. First ones land here in minutes.</li>}
          </ul>
          {!!radar?.waiting && <div className="mt-2 text-[11px] text-muted">+{radar.waiting} newer, live for crawler owners</div>}
        </Tile>

        <Tile href="/track" icon={<Target className="size-4 text-honey" />} tone="bg-honey" title="Track Record" cta="See hits and misses">
          {danger?.settled || good.s ? (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="num text-2xl font-bold text-danger">{danger?.settled ? Math.round((danger.dumped / danger.settled) * 100) : "-"}%</div>
                <div className="text-[11px] text-muted">of DANGER calls dumped</div>
              </div>
              <div>
                <div className="num text-2xl font-bold text-lime">{good.s ? Math.round((good.d / good.s) * 100) : "-"}%</div>
                <div className="text-[11px] text-muted">of CLEAN / OK dumped anyway</div>
              </div>
            </div>
          ) : (
            <p className="text-muted">
              Every verdict is checked against the real price for 24 hours. <span className="num text-fg">{track?.total ?? 0}</span> verdicts tracked so far.
            </p>
          )}
        </Tile>

      </div>
    </section>
  );
}

