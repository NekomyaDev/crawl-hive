"use client";
// Track Record: сбылись ли вердикты. Каждый скан сутки сверяется с реальной ценой; показываем и попадания,
// и промахи — без этого страница ничего не стоит.
import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Card, CardHeader, Stat } from "@/components/ui/card";
import { VerdictPill, pct } from "@/components/verdict";
import { ProofCard } from "@/components/proof-card";
import { useApi } from "@/lib/client/use-api";
import { cn, fmt, short, timeAgo } from "@/lib/utils";
import { useT } from "@/components/lang-provider";
import { DATE_LOCALE, type Lang } from "@/lib/i18n";

interface Row {
  id: string;
  chain: string;
  symbol: string;
  verdict: string;
  score: number | null;
  src: string;
  at: number;
  peakPct: number | null;
  lowPct: number | null;
  lastPct: number | null;
  done: boolean;
  dumped: boolean;
  rugged: boolean;
}
interface By {
  verdict: string;
  tracked: number;
  settled: number;
  dumped: number;
  rugged: number;
  medianPeak: number | null;
}
interface Data {
  since: number | null;
  total: number;
  by: By[];
  byPublic?: By[]; // с переключения на оценку v2
  byOld?: By[]; // до переключения (старая оценка)
  switchAt?: number | null;
  totalPublic?: number;
  old?: { since: number | null; total: number }; // до переключения (старая оценка)
  warned: Row[];
  missed: Row[];
  recent: Row[];
  windowHours: number;
  dumpPct: number;
  signals: { scored: number; hits: number; medianPeak: number | null; recent: { crawlerId: string; crawlerName: string; kind: string; ts: number; status: string; peakPct: number | null; changePct: number | null; jev: number | null }[] };
}

interface CompareRow {
  verdict: string;
  n: number;
  rugRate: number | null;
  dumpRate: number | null;
  peak50Rate: number | null;
  medianLast: number | null;
}
type Models = Record<"v1" | "v2" | "v3", CompareRow[]>;
interface Compare {
  switchAt: number | null;
  open: number;
  sinceSwitch: { settled: number; models: Models };
  allTime: { settled: number; models: Models };
}

const SRC: Record<string, string> = { scan: "user scan", crawler: "crawler", radar: "radar", agent: "agent" };
const share = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);

function Outcome({ r }: { r: Row }) {
  if (r.rugged) return <span className="font-semibold text-danger">rugged</span>;
  if (r.dumped) return <span className="font-semibold text-danger">dumped {pct(r.lowPct)}</span>;
  if (!r.done) return <span className="text-muted">watching… {pct(r.lastPct)}</span>;
  return <span className="text-lime">held · peak {pct(r.peakPct)}</span>;
}

function Rows({ rows, empty }: { rows: Row[]; empty: string }) {
  if (!rows.length) return <p className="px-4 py-6 text-center text-sm text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line/60">
      {rows.map((r) => (
        <li key={r.id + r.at} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
          <span className="min-w-0">
            <Link href={`/scan/${r.id}`} className="font-semibold hover:text-honey">${r.symbol}</Link>
            <span className="num ml-2 text-[11px] text-muted">{short(r.id)} · {SRC[r.src] ?? r.src} · {timeAgo(r.at)}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2 text-xs">
            <VerdictPill verdict={r.verdict} score={r.score} />
            <Outcome r={r} />
          </span>
        </li>
      ))}
    </ul>
  );
}

const FILLING_MIN = 20; // меньше закрытых монет с переключения - подпись «статистика заполняется»
const day = (t: number, lang: Lang = "en") => new Date(t).toLocaleDateString(DATE_LOCALE[lang], { month: "short", day: "numeric" });
const MODEL_LABEL: Record<string, string> = { v1: "Old score (v1)", v2: "Risk score v2 (public)", v3: "Second look v3 (beta)" };
const rate = (x: number | null) => (x == null ? "-" : `${Math.round(x)}%`);

// Сравнение моделей на одних монетах: по каждой модели и вердикту доля ругов, сливов, пиков от +50% и медиана.
function CompareCard() {
  const { data } = useApi<Compare>("/api/track/compare", 120000);
  const [all, setAll] = useState(false);
  const { t, lang } = useT();
  const part = all ? data?.allTime : data?.sinceSwitch;
  return (
    <Card className="mb-5">
      <CardHeader
        title={t("track.compare")}
        sub={
          all
            ? t("track.compareAll")
            : `${t("track.compareSince", { date: data?.switchAt ? day(data.switchAt, lang) : t("track.theSwitch") })}${data ? t("track.compareCount", { settled: data.sinceSwitch.settled, open: data.open }) : ""}.`
        }
        action={
          <button type="button" onClick={() => setAll(!all)} className="shrink-0 rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-fg">
            {all ? t("track.sinceSwitch") : t("track.allTime")}
          </button>
        }
      />
      <div className="overflow-x-auto p-4">
        <table className="w-full min-w-[520px] text-left text-xs">
          <thead className="text-muted">
            <tr>
              <th className="pb-2 font-medium">{t("track.col.verdict")}</th>
              <th className="pb-2 text-right font-medium">{t("track.col.coins")}</th>
              <th className="pb-2 text-right font-medium">{t("track.col.rugged")}</th>
              <th className="pb-2 text-right font-medium">{t("track.col.dumped")}</th>
              <th className="pb-2 text-right font-medium">{t("track.col.hit")}</th>
              <th className="pb-2 text-right font-medium">{t("track.col.median")}</th>
            </tr>
          </thead>
          {(["v1", "v2", "v3"] as const).map((m) => (
            <tbody key={m} className="border-t border-line/60">
              <tr>
                <td colSpan={6} className="pt-3 pb-1 font-semibold">{MODEL_LABEL[m]}</td>
              </tr>
              {(part?.models[m] ?? []).map((r) => (
                <tr key={r.verdict} className="num">
                  <td className="py-1"><VerdictPill verdict={r.verdict} /></td>
                  <td className="py-1 text-right">{r.n}</td>
                  <td className="py-1 text-right">{r.n ? rate(r.rugRate) : "-"}</td>
                  <td className="py-1 text-right">{r.n ? rate(r.dumpRate) : "-"}</td>
                  <td className="py-1 text-right">{r.n ? rate(r.peak50Rate) : "-"}</td>
                  <td className="py-1 text-right">{r.n ? pct(r.medianLast) : "-"}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
        <p className="mt-3 text-[11px] text-muted">
          {t("track.compareNote")}
        </p>
      </div>
    </Card>
  );
}

export default function TrackPage() {
  const { data } = useApi<Data>("/api/track", 60000);
  // Публичная статистика: с переключения на v2 (старые вердикты другой модели не смешиваем), старая - по кнопке.
  const [old, setOld] = useState(false);
  const { t, lang } = useT();
  const hasEra = !!data?.byPublic;
  const era = hasEra ? (old ? data!.byOld! : data!.byPublic!) : (data?.by ?? []);
  const eraHint = !hasEra ? null : old ? t("track.eraOld", { date: data?.switchAt ? day(data.switchAt, lang) : t("track.theSwitch") }) : t("track.eraNew", { date: data?.switchAt ? day(data.switchAt, lang) : t("track.today") });
  const by = new Map(era.map((b) => [b.verdict, b]));
  const group = (vs: string[]) => {
    const xs = vs.map((v) => by.get(v)).filter(Boolean) as By[];
    return { settled: xs.reduce((n, b) => n + b.settled, 0), dumped: xs.reduce((n, b) => n + b.dumped, 0), tracked: xs.reduce((n, b) => n + b.tracked, 0) };
  };
  // Новая оценка копит закрытые монеты сутки: пока их мало, прямо говорим, что карточки ещё заполняются.
  const settledNow = (data?.byPublic ?? []).reduce((n, b) => n + b.settled, 0);
  const filling = hasEra && !old && settledNow < FILLING_MIN;
  const shownTotal = old && data?.old ? data.old.total : data?.total;
  const shownSince = old && data?.old ? data.old.since : data?.since;
  const bad = group(["DANGER"]);
  const good = group(["CLEAN", "OK"]);
  const sig = data?.signals;

  return (
    <>
      <PageHeader
        title={t("track.title")}
        sub={t("track.sub", { hours: data?.windowHours ?? 24, pct: Math.abs(data?.dumpPct ?? 50) })}
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={t("track.tracked")} value={shownTotal != null ? fmt(shownTotal) : "-"} hint={shownSince ? t("track.since", { date: day(shownSince, lang) }) : t("track.startingNow")} tone="honey" />
        <Stat label={t("track.dangerDumped")} value={share(bad.dumped, bad.settled) == null ? "-" : `${share(bad.dumped, bad.settled)}%`} hint={`${t("track.settledOf", { a: bad.dumped, b: bad.settled })}${eraHint ? ` · ${eraHint}` : ""}`} tone="coral" />
        <Stat label={t("track.cleanDumped")} value={share(good.dumped, good.settled) == null ? "-" : `${share(good.dumped, good.settled)}%`} hint={`${t("track.settledOf", { a: good.dumped, b: good.settled })}${eraHint ? ` · ${eraHint}` : ""}`} tone="teal" />
        <Stat
          label={t("track.signalsHit")}
          value={sig?.scored ? `${share(sig.hits, sig.scored)}%` : "-"}
          hint={sig ? t("track.signalsHint", { a: sig.hits, b: sig.scored, peak: pct(sig.medianPeak) }) : undefined}
          tone="lime"
        />
      </div>
      {filling && (
        <p className="-mt-3 mb-5 text-xs text-muted">
          {t("track.filling", { date: data?.switchAt ? day(data.switchAt, lang) : day(Date.UTC(2026, 9, 22), lang), n: settledNow, hours: data?.windowHours ?? 24 })}
        </p>
      )}

      <ProofCard />

      <Card className="mb-5">
        <CardHeader
          title={t("track.byVerdict")}
          sub={`${t("track.byVerdictSub")}${eraHint ? t("track.showing", { era: eraHint }) : ""}`}
          action={
            hasEra && (
              <button type="button" onClick={() => setOld(!old)} className="shrink-0 rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-fg">
                {old ? t("track.current") : t("track.old")}
              </button>
            )
          }
        />
        <div className="space-y-3 p-4">
          {era.map((b) => {
            const s = share(b.dumped, b.settled);
            return (
              <div key={b.verdict} className="grid grid-cols-[92px_1fr_auto] items-center gap-3 text-sm">
                <VerdictPill verdict={b.verdict} />
                <div className="h-2.5 overflow-hidden rounded-full bg-line/60">
                  <div className={cn("h-full rounded-full", b.verdict === "DANGER" ? "bg-danger" : b.verdict === "RISKY" ? "bg-honey" : b.verdict === "TOO_EARLY" ? "bg-muted" : "bg-lime")} style={{ width: `${s ?? 0}%` }} />
                </div>
                <span className="num w-56 text-right text-xs text-muted">
                  {s == null ? t("track.noSettled") : t("track.dumpedPct", { s })} · {t("track.settledFrac", { a: b.settled, b: b.tracked })}
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      <CompareCard />

      <div className="mb-5 grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title={t("track.warned")} sub={t("track.warnedSub")} />
          <Rows rows={data?.warned ?? []} empty={t("track.warnedEmpty")} />
        </Card>
        <Card>
          <CardHeader title={t("track.missed")} sub={t("track.missedSub")} />
          <Rows rows={data?.missed ?? []} empty={t("track.missedEmpty")} />
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader title={t("track.latest")} sub={t("track.latestSub")} />
          <Rows rows={data?.recent ?? []} empty={t("track.latestEmpty")} />
        </Card>
        <Card>
          <CardHeader title={t("track.signals")} sub={t("track.signalsSub")} />
          <ul className="divide-y divide-line/60">
            {(sig?.recent ?? []).map((r) => (
              <li key={r.crawlerId + r.ts} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                <span className="min-w-0">
                  <Link href={`/crawler/${r.crawlerId}`} className="hover:text-honey">{r.crawlerName}</Link>
                  <span className="ml-2 text-[11px] text-muted">{timeAgo(r.ts)}{r.jev != null ? ` · ⚡ Jev ${Math.round(r.jev * 100)}%` : ""}</span>
                </span>
                <span className={cn("num shrink-0 text-xs font-semibold", r.status === "hit" ? "text-lime" : "text-danger")}>
                  {r.status} {r.status === "hit" ? `peak ${pct(r.peakPct)}` : pct(r.changePct)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
