// Страница одного скана: /scan/<адрес>. Её ссылку кидают в X — превью строится из opengraph-image рядом.
// Показывает сохранённый результат и ведёт на свежий скан. Если токен ещё не сканировали — сразу запускает скан.
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ArrowRight, ExternalLink, Radar } from "lucide-react";
import { savedScan, type ScanResult } from "@/lib/server/scan";
import { V2 } from "@/lib/server/score-v2";
import { launchOf, memDb } from "@/lib/server/memory-db";
import { CHAIN_LABEL, VERDICT_COLOR, VERDICT_LABEL, explorerToken, shareText } from "@/lib/scan-share";
import { ShareScan } from "@/components/share-scan";
import { XVoices } from "@/components/x-voices";
import { XRayPanel } from "@/components/xray-panel";
import { BubbleMap } from "@/components/bubble-map";
import { LaunchEvidence } from "@/components/launch-evidence";
import { LarpLine } from "@/components/larp-line";
import { TrustScore } from "@/components/trust-score";
import { SinceLastScan } from "@/components/since-last-scan";
import { SecondLook } from "@/components/second-look";
import { DumpProjection } from "@/components/dump-projection";
import { FirstBuyers } from "@/components/first-buyers";
import { lookV3 } from "@/lib/second-look";
import { cn, timeAgo } from "@/lib/utils";

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
  // Доказательства запуска свежими из базы: настоящего создателя фоновый поиск может найти уже после скана.
  const db = memDb();
  const fresh = db ? launchOf(db, r.chain === "solana" ? r.id : r.id.toLowerCase()) : null;
  const launch = fresh
    ? { ...r.launch, deployer: fresh.deployer ?? r.launch?.deployer, factory: r.launch?.factory ?? fresh.factory ?? undefined, poolCreator: fresh.poolCreator ?? r.launch?.poolCreator, tx: fresh.tx ?? r.launch?.tx, launchedAt: fresh.launchedAt ?? r.launch?.launchedAt, seenAt: fresh.seenAt }
    : r.launch;
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
            </div>
            {r.name && <div className="truncate text-sm text-muted">{r.name}</div>}
            <p className="mt-1">{r.reason}</p>
            <SecondLook v={lookV3(r.v3)} className="mt-2" />
          </div>
        </div>

        {r.larp && <LarpLine l={r.larp} ours={{ verdict: r.verdict, factors: r.factors }} className="mt-5" />}
        {r.trust && <TrustScore t={r.trust} className="mt-3" />}
        <SinceLastScan s={r.since} className="mt-3" />

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

        <Factors r={r} />

        <DumpProjection d={r.dump} className="mt-4" />

        {launch && (
          <div className="mt-4">
            <LaunchEvidence l={{ ...launch, deployer: launch.deployer ?? undefined }} chain={r.chain} />
          </div>
        )}
        <ShareScan id={r.id} text={shareText(r)} className="mt-4" />

        {r.operators?.map && <BubbleMap data={r.operators.map} ops={r.operators.operators} chain={r.chain} className="mt-4" />}

        <FirstBuyers f={r.firstBuyers} chain={r.chain} className="mt-4" />

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

// С 22.10 публичный балл считает v2: строки списка - её правила, и их сумма равна показанному баллу.
// Флаги краулеров (v1) идут ниже со знаком «!»: в v2 они входят одним правилом «балл краулеров», свои очки v1
// видны в подсказке. Скан без v2 (базовый актив, старый скан) показываем по-старому.
interface Line {
  key: string;
  impact: number | null; // null - флаг без своих очков в балле
  label: string;
  note: string;
  hint?: string;
  v1?: number; // очки этого флага в старой оценке v1, только для цвета и подсказки
}

const cap1 = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function v2Lines(r: ScanResult): Line[] | null {
  if (!r.v1 || !r.v2 || r.score === null) return null;
  const out: Line[] = [{ key: "base", impact: V2.base, label: "Starting score", note: "every coin starts here, the rules below move it" }];
  let raw: number = V2.base;
  let cap: string | undefined;
  for (const x of r.v2.reasonsV2) {
    if (x.startsWith("capped")) {
      cap = x.replace(/^capped at \d+: /, "");
      continue;
    }
    const m = x.match(/^([+-]?\d+) (.*)$/);
    if (!m) continue;
    const pts = Number(m[1]);
    raw += pts;
    const v1 = m[2].match(/^v1 score (\d+)$/);
    const dumped = m[2].match(/^(\d+) wallets were on tokens that dumped$/);
    out.push(
      v1
        ? { key: x, impact: pts, label: `Crawler checks: ${v1[1]}/100`, note: pts > 0 ? "80 or more, few red flags below" : "under 60, see the red flags below" }
        : dumped
          ? { key: x, impact: pts, label: "Wallets from dumped coins", note: `${dumped[1]} wallets here were on earlier coins that dumped` }
          : { key: x, impact: pts, label: cap1(m[2]), note: "" },
    );
  }
  // Сумма правил обрезается в 0-100, потом потолок по жёсткому флагу, потом жёсткие правила v1 могут держать вердикт ниже.
  const clamped = Math.max(0, Math.min(100, raw));
  if (clamped !== raw) out.push({ key: "clamp", impact: clamped - raw, label: clamped === 0 ? "Floor at 0" : "Ceiling at 100", note: "the score stays between 0 and 100" });
  if (cap && r.v2.scoreV2 < clamped) out.push({ key: "cap", impact: r.v2.scoreV2 - clamped, label: `Capped at ${r.v2.scoreV2}`, note: `${cap}: a coin with this flag can't score above RISKY` });
  if (r.score !== r.v2.scoreV2) out.push({ key: "hard", impact: r.score - r.v2.scoreV2, label: `Held at ${VERDICT_LABEL[r.verdict]}`, note: "a hard red flag below keeps the verdict this low" });
  const ruled = new Set(out.map((l) => l.label));
  for (const f of r.factors)
    if (!ruled.has(f.label))
      out.push({ key: `f:${f.label}`, impact: null, label: f.label, note: f.note, v1: f.impact, hint: f.impact ? `Old score (v1): ${f.impact > 0 ? `+${f.impact}` : f.impact}` : undefined });
  return out;
}

function Factors({ r }: { r: ScanResult }) {
  const lines = v2Lines(r);
  if (lines)
    return (
      <ul className="mt-4 divide-y divide-line rounded-lg border border-line text-sm">
        {lines.map((l) => (
          <li key={l.key} className="flex items-center gap-3 px-3 py-2" title={l.hint}>
            <span className={cn("num w-10 shrink-0 text-right font-semibold", l.key === "base" ? "text-muted" : l.impact === null ? ((l.v1 ?? 0) < 0 ? "text-danger" : (l.v1 ?? 0) > 0 ? "text-lime" : "text-honey") : l.impact < 0 ? "text-danger" : "text-lime")}>
              {l.impact === null ? "!" : l.key !== "base" && l.impact > 0 ? `+${l.impact}` : l.impact}
            </span>
            <span className="font-medium">{l.label}</span>
            {l.note && <span className="min-w-0 truncate text-muted">{l.note}</span>}
          </li>
        ))}
      </ul>
    );
  if (!r.factors.length) return <p className="mt-4 text-sm text-lime">No red flags found by the crawlers.</p>;
  return (
    <ul className="mt-4 divide-y divide-line rounded-lg border border-line text-sm">
      {[...r.factors]
        .sort((a, b) => a.impact - b.impact)
        .map((f) => (
          <li key={f.label} className="flex items-center gap-3 px-3 py-2">
            {/* Нулевой вес: предупреждение без влияния на балл, показываем «!» вместо 0. */}
            <span className={cn("num w-10 shrink-0 text-right font-semibold", f.impact < 0 ? "text-danger" : f.impact === 0 ? "text-honey" : "text-lime")}>
              {f.impact > 0 ? `+${f.impact}` : f.impact === 0 ? "!" : f.impact}
            </span>
            <span className="font-medium">{f.label}</span>
            <span className="min-w-0 truncate text-muted">{f.note}</span>
          </li>
        ))}
    </ul>
  );
}
