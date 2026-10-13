"use client";
// «Новое в рое»: живые плитки свежих функций с настоящими данными — Launch Radar, Track Record, агенты, Jev.
import Link from "next/link";
import { ArrowRight, Bot, Radar, Target, Zap } from "lucide-react";
import { BotOcto } from "@/components/bot-octo";
import { VerdictPill } from "@/components/verdict";
import { useApi } from "@/lib/client/use-api";
import { cn, fmt } from "@/lib/utils";

interface RadarFeed {
  items: { id: string; symbol: string; verdict: string; score: number | null; liq: number; at: number; chain: string }[];
  waiting: number;
  day: { scanned: number; danger: number; clean: number };
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
                <div className="num text-2xl font-bold text-danger">{danger?.settled ? Math.round((danger.dumped / danger.settled) * 100) : "—"}%</div>
                <div className="text-[11px] text-muted">of DANGER calls dumped</div>
              </div>
              <div>
                <div className="num text-2xl font-bold text-lime">{good.s ? Math.round((good.d / good.s) * 100) : "—"}%</div>
                <div className="text-[11px] text-muted">of CLEAN / OK dumped anyway</div>
              </div>
            </div>
          ) : (
            <p className="text-muted">
              Every verdict is checked against the real price for 24 hours. <span className="num text-fg">{track?.total ?? 0}</span> verdicts tracked so far.
            </p>
          )}
        </Tile>

        <Tile href="/my" icon={<Bot className="size-4 text-sky" />} tone="bg-sky" title="Any AI agent, one click" cta="Connect your agent">
          <div className="mb-2 flex -space-x-1.5">
            {["#ffb020", "#5eead4", "#60a5fa", "#c084fc"].map((c) => (
              <span key={c} className="grid size-8 place-items-center rounded-full border-2 border-panel bg-panel-2">
                <BotOcto size={22} color={c} live />
              </span>
            ))}
          </div>
          <p className="text-muted">Grok Bot, ChatGPT Dots, Meta Muse, Claude, Cursor: press Connect, pick crawlers, approve with your wallet.</p>
        </Tile>

        <Tile href="/track" icon={<Zap className="size-4 text-pink" />} tone="bg-pink" title="Jev decides, Grok researches" cta="How signals are rated">
          <p className="text-muted">A decision model rates every crawler find in half a second for $0.00002. Noise is skipped, Grok checks only the doubtful ones.</p>
          {!!track?.signals.scored && (
            <div className="mt-2 text-[11px] text-muted">
              Crawler signals hit: <span className="num text-lime">{Math.round((track.signals.hits / track.signals.scored) * 100)}%</span> of {track.signals.scored}
            </div>
          )}
        </Tile>
      </div>
    </section>
  );
}

