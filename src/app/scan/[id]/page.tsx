// Страница одного скана: /scan/<адрес>. Её ссылку кидают в X — превью строится из opengraph-image рядом.
// Показывает сохранённый результат и ведёт на свежий скан. Если токен ещё не сканировали — сразу запускает скан.
// Всем видны вердикт, балл, главные флаги, рынок и итог «Probable dump». Полный разбор (bubble map, первые
// покупатели, раскладка балла, запуск, Second look) в HTML не попадает: его грузит ScanDeep по тарифу (actions.ts).
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ArrowDown, ArrowRight, ExternalLink, Radar } from "lucide-react";
import { savedScan, type ScanResult } from "@/lib/server/scan";
import { DEEP_SCAN_TIER, TIER_NAME } from "@/lib/server/tiers";
import { CHAIN_LABEL, VERDICT_COLOR, VERDICT_LABEL, explorerToken, shareText } from "@/lib/scan-share";
import { ShareScan } from "@/components/share-scan";
import { XVoices } from "@/components/x-voices";
import { XRayPanel } from "@/components/xray-panel";
import { LarpLine } from "@/components/larp-line";
import { TrustScore } from "@/components/trust-score";
import { DumpHeadline } from "@/components/dump-projection";
import { TopFlags } from "@/components/scan-factors";
import { ScanDeep } from "@/components/scan-deep";
import { timeAgo } from "@/lib/utils";

export async function generateMetadata({ params }: PageProps<"/scan/[id]">): Promise<Metadata> {
  await connection();
  const { id } = await params;
  const r = savedScan(id);
  if (!r) return { title: "Instant Crawl · CrawlHive" };
  const title = r.score === null ? `$${r.symbol}: too early to judge · CrawlHive` : `$${r.symbol} scored ${r.score}/100 ${VERDICT_LABEL[r.verdict]} · CrawlHive`;
  return {
    title,
    description: r.reason,
    openGraph: { title, description: r.reason, type: "website" },
    twitter: { card: "summary_large_image", title, description: r.reason },
  };
}

export default function ScanPage({ params }: PageProps<"/scan/[id]">) {
  return (
    <Suspense fallback={<div className="py-20 text-center text-muted">Loading scan…</div>}>
      <ScanView params={params} />
    </Suspense>
  );
}

const usd = (n?: number) =>
  n === undefined ? "-" : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${n.toFixed(n < 1 ? 6 : 0)}`;

async function ScanView({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const r = savedScan(id);
  if (!r) redirect(`/?scan=${encodeURIComponent(id)}`);
  const color = VERDICT_COLOR[r.verdict];
  const m = r.market;
  const age = m?.ageHours === undefined ? "-" : m.ageHours < 48 ? `${m.ageHours.toFixed(1)}h` : `${Math.round(m.ageHours / 24)}d`;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-3 flex items-center justify-between text-xs text-muted">
        <span>Instant Crawl result · scanned {timeAgo(r.scannedAt)}</span>
        <Link href="/" className="hover:text-fg">
          scan another token →
        </Link>
      </div>
      <div className="ring-gradient overflow-hidden rounded-2xl bg-panel/70 p-5 lg:p-7">
        <div className="flex flex-wrap items-center gap-5">
          <div
            className="grid size-28 shrink-0 place-items-center rounded-full"
            style={{ background: `conic-gradient(${color} ${(r.score ?? 0) * 3.6}deg, rgba(255,255,255,0.06) 0)` }}
          >
            <div className="grid size-22 place-items-center rounded-full bg-panel">
              <span className="num text-4xl font-bold" style={{ color }}>
                {r.score ?? "-"}
              </span>
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-bold">${r.symbol}</h1>
              <span className="rounded-md border px-2 py-0.5 text-xs font-semibold" style={{ color, borderColor: `${color}66` }}>
                {VERDICT_LABEL[r.verdict]}
              </span>
              <span className="rounded-md border border-violet/40 px-1.5 py-0.5 text-[10px] text-violet">{CHAIN_LABEL[r.chain] ?? r.chain}</span>
              <Link href={`/token/${r.id}`} className="text-[11px] text-muted hover:text-fg">
                Token history →
              </Link>
            </div>
            {r.name && <div className="truncate text-sm text-muted">{r.name}</div>}
            <p className="mt-1">{r.reason}</p>
          </div>
        </div>

        {r.larp && <LarpLine l={r.larp} ours={{ verdict: r.verdict, factors: r.factors }} className="mt-5" />}
        {r.trust && <TrustScore t={r.trust} className="mt-3" />}

        <div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs sm:grid-cols-6">
          {[
            ["Liquidity", usd(m?.liquidityUsd)],
            ["FDV", usd(m?.fdv)],
            ["Age", age],
            ["Vol 24h", usd(m?.volume24h)],
            ["Top 10", r.holders ? `${r.holders.top10.toFixed(0)}%` : "-"],
            ["Copycats", String(r.clones)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg bg-panel-2 px-2 py-1.5">
              <div className="text-[10px] text-muted uppercase">{k}</div>
              <div className="num font-semibold">{v}</div>
            </div>
          ))}
        </div>

        <TopFlags items={topItems(r)} className="mt-4" />

        <DumpHeadline d={r.dump} className="mt-3" />

        <a
          href="#full-analysis"
          className="mt-3 flex items-center justify-center gap-1.5 rounded-lg border border-honey/40 bg-honey/10 py-2 text-sm font-semibold text-honey hover:bg-honey/20"
        >
          See full analysis <ArrowDown className="size-4" />
        </a>

        <ShareScan id={r.id} text={shareText(r)} className="mt-4" />

        {r.xray && <XRayPanel x={r.xray} className="mt-4" />}

        {r.x && (
          <div className="mt-4 rounded-lg border border-line bg-panel-2/60 p-3 text-sm">
            <div className="mb-1 text-xs font-semibold">
              𝕏 buzz · <span className="uppercase">{r.x.sentiment}</span>
            </div>
            <p className="text-fg/90">{r.x.summary}</p>
            {!!r.x.posts.length && (
              <ul className="mt-2 space-y-1 text-xs">
                {r.x.posts.slice(0, 4).map((p) => (
                  <li key={p.url} className="truncate">
                    <a href={p.url} target="_blank" rel="noreferrer" className="hover:underline">
                      <span className="text-sky">@{p.handle}</span> <span className="text-muted">{p.text}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!!r.x?.voices?.length && <XVoices symbol={r.symbol} voices={r.x.voices} />}

        <div id="full-analysis" className="mt-6 scroll-mt-20 border-t border-line pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">Full analysis</h2>
            <span className="text-xs text-muted">{TIER_NAME[DEEP_SCAN_TIER]} tier and up</span>
          </div>
          <ScanDeep id={r.id} />
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <Link
            href={`/?scan=${r.id}`}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-honey px-4 text-sm font-semibold text-black hover:bg-[#ffc24d]"
          >
            <Radar className="size-4" /> Run a fresh crawl
          </Link>
          {m?.url && (
            <a href={m.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
              DexScreener <ExternalLink className="size-3" />
            </a>
          )}
          {explorerToken(r.chain, r.id) && (
            <a href={explorerToken(r.chain, r.id)!.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
              {explorerToken(r.chain, r.id)!.label} <ExternalLink className="size-3" />
            </a>
          )}
        </div>
        <p className="num mt-3 truncate text-[11px] text-muted">{r.id}</p>
        <p className="mt-1 text-[10px] text-muted">Automated checks at the time of the scan, not financial advice. Run a fresh crawl for current data.</p>
      </div>

      <Link
        href="/market"
        className="mt-4 flex items-center justify-center gap-1 rounded-xl border border-line bg-panel/70 py-3 text-sm text-honey hover:bg-panel-2"
      >
        Get alerts on tokens like this: spawn a crawler <ArrowRight className="size-4" />
      </Link>
    </div>
  );
}

// Главные минусы для бесплатного вида: флаги краулеров (v1) и правила v2 вида «-10 pump.fun launch»,
// кроме сводного «v1 score N» и потолков. Очки только для сортировки, на страницу идут названия.
function topItems(r: ScanResult) {
  const v2 = (r.v2?.reasonsV2 ?? []).flatMap((x) => {
    const m = x.match(/^([+-]?\d+) (.*)$/);
    if (!m || /^v1 score/.test(m[2])) return [];
    return [{ label: m[2].charAt(0).toUpperCase() + m[2].slice(1), impact: Number(m[1]) }];
  });
  return [...r.factors.map((f) => ({ label: f.label, impact: f.impact })), ...v2];
}
