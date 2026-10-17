"use client";
// Narrative Radar: что охотник платформы нашёл в X. Это ничей краулер: он работает для всех, а у каждого
// нарратива есть кнопка «Launch this narrative», которая открывает Clean Launch с готовыми полями.
import Link from "next/link";
import { ExternalLink, Flame, Rocket, Sparkles, Users } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, Stat } from "@/components/ui/card";
import { VerdictPill } from "@/components/verdict";
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

const HEAT: Record<string, { t: string; c: string }> = {
  hot: { t: "🔥 hot", c: "border-coral/60 bg-coral/10 text-coral" },
  rising: { t: "📈 rising", c: "border-honey/60 bg-honey/10 text-honey" },
  early: { t: "🌱 early", c: "border-lime/50 bg-lime/10 text-lime" },
};

function inH(ts: number) {
  const m = Math.max(0, Math.round((ts - Date.now()) / 60_000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function NarrativeCard({ n }: { n: Item }) {
  const heat = HEAT[n.heat] ?? HEAT.early;
  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className={cn("rounded-full border px-2 py-0.5 font-semibold", heat.c)}>{heat.t}</span>
        <span className="flex items-center gap-2 text-muted">
          <span className="rounded border border-line px-1.5">{n.kind}</span>
          <span className="num">{timeAgo(n.at)}</span>
        </span>
      </div>
      <div className="mt-2.5 text-lg leading-tight font-bold">{n.title}</div>
      <div className="num mt-0.5 text-sm font-semibold text-honey">${n.ticker}</div>
      <p className="mt-2 flex-1 text-sm text-fg/80">{n.why}</p>
      <div className={cn("mt-2 text-xs", n.clones === 0 ? "text-lime" : n.clones ? "text-honey" : "text-muted")}>
        {n.clones === null ? "Coins on this ticker: unknown" : n.clones === 0 ? "✓ No coin on this ticker in the last 24h" : `${n.clones} coin${n.clones === 1 ? "" : "s"} on this ticker in the last 24h`}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {n.posts.map((u, i) => (
          <a key={u} href={u} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-sky hover:underline">
            <ExternalLink className="size-3" /> post {i + 1} · verified
          </a>
        ))}
      </div>
      {n.launched ? (
        <Link href={`/scan/${n.launched.mint}`} className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-lime/40 bg-lime/[0.06] px-3 py-2 text-sm hover:bg-lime/10">
          <span>
            <Rocket className="mr-1 inline size-3.5 text-lime" /> Launched on CrawlHive: <b>${n.launched.symbol}</b>
          </span>
          {n.launched.verdict ? <VerdictPill verdict={n.launched.verdict} score={n.launched.score} /> : <span className="text-[11px] text-muted">scanning…</span>}
        </Link>
      ) : (
        <Link
          href={launchHrefFor({ title: n.title, ticker: n.ticker, why: n.why, post: n.posts[0] })}
          className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-honey via-coral to-pink px-3 py-2 text-sm font-extrabold text-black hover:opacity-90"
        >
          <Rocket className="size-4" /> Launch this narrative
        </Link>
      )}
    </Card>
  );
}

export default function NarrativesPage() {
  const { data } = useApi<Feed>("/api/narratives", 60_000);
  const d = data?.day;
  return (
    <>
      <PageHeader
        title={
          <>
            <Sparkles className="mr-2 inline size-7 text-violet" />
            Narrative Radar
          </>
        }
        sub="The platform's own Narrative Hunter. Every few hours it walks X for what just started spreading: new memes, viral animals, AI launches, internet moments. Every post link is verified, invented ones drop out. Nobody owns this hunter: what it finds is here for everyone."
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Stat label="Narratives, 24h" value={d ? d.found : "—"} tone="violet" icon={<Sparkles className="size-4" />} />
        <Stat label="Hot right now" value={d ? d.hot : "—"} tone="coral" icon={<Flame className="size-4" />} />
        <Stat label="No coin on the ticker yet" value={d ? d.fresh : "—"} hint="in the last 24h" tone="lime" icon={<Users className="size-4" />} />
      </div>

      <Card className="mb-5 flex flex-wrap items-center justify-between gap-3 border-violet/30 bg-gradient-to-r from-violet/[0.08] to-transparent px-4 py-3 text-sm">
        <span>
          {data?.enabled === false ? (
            <span className="text-muted">The hunter is resting right now.</span>
          ) : (
            <>
              <span className="font-semibold">Hunts every {data?.everyH ?? 3} hours.</span>
              <span className="text-muted">
                {data?.lastAt ? ` Last hunt ${timeAgo(data.lastAt)}` : " First hunt is on its way"}
                {data?.nextAt ? `, next in ${inH(data.nextAt)}.` : "."}
              </span>
            </>
          )}
        </span>
        <span className="text-muted">
          Want your own, tuned to your topics?{" "}
          <Link href="/market" className="text-honey hover:underline">
            Narrative Hunter in the marketplace
          </Link>
        </span>
      </Card>

      {data && !data.items.length ? (
        <Card className="px-4 py-12 text-center text-sm text-muted">The first hunt is running. Narratives land here in a few minutes.</Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(data?.items ?? []).map((n) => (
            <NarrativeCard key={n.id} n={n} />
          ))}
        </div>
      )}
      <p className="mt-4 text-xs text-muted">
        A narrative is not a coin and not a call. Launching a coin on one does not make it a good investment, and every coin launched on CrawlHive is scanned by the same rules as any other.
      </p>
    </>
  );
}
