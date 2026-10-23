// Профиль токена: /token/<адрес>. Сколько раз токен сканировали, первый и последний скан, последний публичный
// вердикт (v2) со ссылкой на /scan/<адрес>, вердикты по сканам, исход Track Record, что помнит рой и голоса держателей.
// Сводка рендерится на сервере из сохранённых данных; голоса и комментарии грузит клиентский TokenVotes.
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { ArrowRight, Radar } from "lucide-react";
import { tokenProfile, type TokenProfile } from "@/lib/server/token-profile";
import { CHAIN_LABEL, VERDICT_COLOR, VERDICT_LABEL, type Verdict } from "@/lib/scan-share";
import { VerdictPill, pct } from "@/components/verdict";
import { TokenVotes } from "@/components/token-votes";
import { short, timeAgo } from "@/lib/utils";

const norm = (id: string) => (id.startsWith("0x") ? id.toLowerCase() : id);

export async function generateMetadata({ params }: { params: Promise<{ mint: string }> }): Promise<Metadata> {
  await connection();
  const { mint } = await params;
  const p = tokenProfile(norm(mint));
  if (!p) return { title: "Token history · CrawlHive" };
  const title = `$${p.symbol} token history · CrawlHive`;
  const description = `${p.scans}${p.scansCapped ? "+" : ""} scan${p.scans === 1 ? "" : "s"} on CrawlHive. Verdicts over time, Track Record outcome and holder votes.`;
  return { title, description, openGraph: { title, description, type: "website" } };
}

export default function TokenPage({ params }: { params: Promise<{ mint: string }> }) {
  return (
    <Suspense fallback={<div className="py-20 text-center text-muted">Loading token history…</div>}>
      <TokenView params={params} />
    </Suspense>
  );
}

const date = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ") + " UTC";

async function TokenView({ params }: { params: Promise<{ mint: string }> }) {
  await connection();
  const { mint } = await params;
  const id = norm(mint);
  const p = tokenProfile(id);
  if (!p)
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <h1 className="text-2xl font-bold">No history for this token yet</h1>
        <p className="num mt-2 break-all text-xs text-muted">{mint}</p>
        <p className="mt-3 text-sm text-muted">CrawlHive builds a token profile after the first scan.</p>
        <Link
          href={`/?scan=${encodeURIComponent(mint)}`}
          className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg bg-honey px-4 text-sm font-semibold text-black hover:bg-[#ffc24d]"
        >
          <Radar className="size-4" /> Scan it now
        </Link>
      </div>
    );

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Header p={p} />
      <Timeline p={p} />
      <Outcome p={p} />
      <Brain p={p} />
      <TokenVotes mint={p.id} />
      <p className="text-center text-[10px] text-muted">Automated checks at the time of each scan, not financial advice.</p>
    </div>
  );
}

function Header({ p }: { p: TokenProfile }) {
  const l = p.latest;
  const color = l ? VERDICT_COLOR[l.verdict as Verdict] ?? "#8a9099" : "#8a9099";
  return (
    <div className="ring-gradient overflow-hidden rounded-2xl bg-panel/70 p-5 lg:p-7">
      <div className="mb-3 text-xs text-muted">Token history</div>
      <div className="flex flex-wrap items-center gap-4">
        {l && (
          <div
            className="grid size-20 shrink-0 place-items-center rounded-full"
            style={{ background: `conic-gradient(${color} ${(l.score ?? 0) * 3.6}deg, rgba(255,255,255,0.06) 0)` }}
          >
            <div className="grid size-16 place-items-center rounded-full bg-panel">
              <span className="num text-2xl font-bold" style={{ color }}>
                {l.score ?? "-"}
              </span>
            </div>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold sm:text-3xl">${p.symbol}</h1>
            {l && (
              <span className="rounded-md border px-2 py-0.5 text-xs font-semibold" style={{ color, borderColor: `${color}66` }}>
                {VERDICT_LABEL[l.verdict as Verdict] ?? l.verdict}
              </span>
            )}
            <span className="rounded-md border border-violet/40 px-1.5 py-0.5 text-[10px] text-violet">{CHAIN_LABEL[p.chain] ?? p.chain}</span>
          </div>
          {p.name && <div className="truncate text-sm text-muted">{p.name}</div>}
          {l?.reason && <p className="mt-1 text-sm">{l.reason}</p>}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs">
        {[
          ["Scans", `${p.scans}${p.scansCapped ? "+" : ""}`],
          ["First scan", p.firstAt ? timeAgo(p.firstAt) : "-"],
          ["Latest scan", p.lastAt ? timeAgo(p.lastAt) : "-"],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-panel-2 px-2 py-1.5">
            <div className="text-[10px] text-muted uppercase">{k}</div>
            <div className="num font-semibold">{v}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link
          href={`/scan/${p.id}`}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-honey/40 bg-honey/10 px-3 text-sm font-semibold text-honey hover:bg-honey/20"
        >
          Latest scan result <ArrowRight className="size-4" />
        </Link>
        <Link href={`/?scan=${p.id}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-sm hover:border-honey/60 hover:text-honey">
          <Radar className="size-4" /> Run a fresh crawl
        </Link>
        {l && <span className="text-[11px] text-muted">Score model {l.model}</span>}
      </div>
      <p className="num mt-3 truncate text-[11px] text-muted">{p.id}</p>
    </div>
  );
}

function Timeline({ p }: { p: TokenProfile }) {
  if (!p.timeline.length) return null;
  const rows = [...p.timeline].reverse();
  return (
    <section className="rounded-xl border border-line bg-panel p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Verdicts over scans</h2>
        <span className="text-[11px] text-muted">last {rows.length}, newest first</span>
      </div>
      {/* Полоска баллов: высота столбика = балл, цвет = вердикт. Старые слева. */}
      <div className="mb-3 flex h-14 items-end gap-1" aria-hidden>
        {p.timeline.map((t) => (
          <div
            key={t.at}
            title={`${t.verdict} ${t.score ?? "-"}`}
            className="min-w-2 flex-1 rounded-t"
            style={{ height: `${Math.max(8, t.score ?? 8)}%`, background: VERDICT_COLOR[t.verdict as Verdict] ?? "#8a9099", opacity: 0.8 }}
          />
        ))}
      </div>
      <ul className="divide-y divide-line text-sm">
        {rows.map((t) => (
          <li key={t.at} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
            <VerdictPill verdict={t.verdict} score={t.score} />
            <span className="text-xs text-muted">
              {date(t.at)} · {timeAgo(t.at)}
              {t.model === "v1" ? " · v1 model" : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Outcome({ p }: { p: TokenProfile }) {
  const o = p.outcome;
  if (!o) return null;
  const result = o.rugged ? "Rugged" : o.dumped ? "Dumped" : o.settled ? "Survived 24h" : "Still tracking";
  const tone = o.rugged || o.dumped ? "text-danger" : o.settled ? "text-lime" : "text-muted";
  return (
    <section className="rounded-xl border border-line bg-panel p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Track Record outcome</h2>
        <Link href="/track" className="text-[11px] text-muted hover:text-fg">
          how it works →
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-4">
        <div className="rounded-lg bg-panel-2 px-2 py-1.5">
          <div className="text-[10px] text-muted uppercase">Verdict then</div>
          <VerdictPill verdict={o.verdict} score={o.score} className="mt-0.5" />
        </div>
        <div className="rounded-lg bg-panel-2 px-2 py-1.5">
          <div className="text-[10px] text-muted uppercase">Peak 24h</div>
          <div className="num font-semibold">{pct(o.peakPct)}</div>
        </div>
        <div className="rounded-lg bg-panel-2 px-2 py-1.5">
          <div className="text-[10px] text-muted uppercase">Low 24h</div>
          <div className="num font-semibold">{pct(o.lowPct)}</div>
        </div>
        <div className="rounded-lg bg-panel-2 px-2 py-1.5">
          <div className="text-[10px] text-muted uppercase">Result</div>
          <div className={`font-semibold ${tone}`}>{result}</div>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted">Tracked from {date(o.at)}. Dumped: -50% from scan price within 24h. Rugged: liquidity gone.</p>
    </section>
  );
}

function Brain({ p }: { p: TokenProfile }) {
  const b = p.brain;
  if (!b || (!b.dev && !b.linked && !b.wallets)) return null;
  return (
    <section className="rounded-xl border border-line bg-panel p-4">
      <h2 className="mb-3 text-sm font-semibold">What the swarm remembers</h2>
      <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
        <div className="rounded-lg bg-panel-2 px-3 py-2">
          <div className="text-[10px] text-muted uppercase">Dev</div>
          {b.dev ? (
            <Link href={`/dev/${b.dev}`} className="num font-semibold text-sky hover:underline">
              {short(b.dev)}
            </Link>
          ) : (
            <div className="font-semibold">Unknown</div>
          )}
          {b.devTokens && b.devTokens > 1 && <div className="text-muted">{b.devTokens} tokens in memory</div>}
        </div>
        <div className="rounded-lg bg-panel-2 px-3 py-2">
          <div className="text-[10px] text-muted uppercase">Linked wallets</div>
          <div className="num font-semibold">{b.linked}</div>
        </div>
        <div className="rounded-lg bg-panel-2 px-3 py-2">
          <div className="text-[10px] text-muted uppercase">Wallets with roles</div>
          <div className="num font-semibold">{b.wallets}</div>
        </div>
      </div>
    </section>
  );
}
