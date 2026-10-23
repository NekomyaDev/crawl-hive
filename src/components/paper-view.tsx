"use client";
// Paper Trading: живой бумажный движок. Несколько стратегий торгуют сигналами Launch Radar параллельно, каждая со
// своими стопами, тейками и сроком. Таблица лидеров, кривые, открытые позиции, последние сделки с причиной выхода.
// Внизу старый расчёт задним числом (купить по цене скана, продать через сутки) для сравнения.
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Card, CardHeader, Stat } from "@/components/ui/card";
import { VerdictPill, pct } from "@/components/verdict";
import { useApi } from "@/lib/client/use-api";
import { cn, fmt, short, timeAgo } from "@/lib/utils";
import type { PaperEngineData } from "@/lib/server/paper-engine";
import type { PaperData } from "@/lib/server/paper";

interface Data {
  engine: PaperEngineData;
  legacy: PaperData | null;
}
type Strategy = PaperEngineData["strategies"][number];

// Цвета стратегий по порядку: одни и те же в таблице, легенде и на кривых.
const COLORS = ["lime", "teal", "sky", "violet", "pink", "honey", "coral", "danger", "fg", "muted"];
const colorOf = (ids: string[], id: string) => `var(--${COLORS[Math.max(0, ids.indexOf(id)) % COLORS.length]})`;

const usd = (n: number) => `${n < 0 ? "-" : n > 0 ? "+" : ""}$${fmt(Math.abs(n), Math.abs(n) < 100 ? 2 : 0)}`;
const tone = (n: number | null | undefined) => (n == null || n === 0 ? "text-muted" : n > 0 ? "text-lime" : "text-danger");
const when = (ts: number) => new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const mins = (m: number | null) => (m == null ? "-" : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`);
const price = (p: number) => (p >= 1 ? p.toFixed(4) : p.toPrecision(3));

const REASON: Record<string, { label: string; cls: string }> = {
  tp: { label: "take profit", cls: "text-lime" },
  sl: { label: "stop loss", cls: "text-danger" },
  trail: { label: "trailing stop", cls: "text-honey" },
  time: { label: "time out", cls: "text-muted" },
  rug: { label: "rugged", cls: "font-semibold text-danger" },
  removed: { label: "strategy removed", cls: "text-muted" },
};

function rules(s: Strategy) {
  const x = s.exits;
  if (!x) return "-";
  const parts = [
    s.delayMin != null && `buy ${s.delayMin}m after scan`,
    x.tpPct != null && `TP +${x.tpPct}%`,
    x.slPct != null && `SL -${x.slPct}%`,
    x.partial && `sell ${x.partial.sellPct}% at +${x.partial.atPct}%${x.partial.breakeven ? ", then stop at entry" : ""}`,
    x.trailPct != null && `trail ${x.trailPct}%${x.trailArmPct ? ` after +${x.trailArmPct}%` : ""}`,
    `max ${mins(x.maxHoldMin)}`,
  ];
  return parts.filter(Boolean).join(" · ");
}

// Подтверждённый вход: сколько ждут покупки и сколько сигналов отсеяно (пул вытащили, упала, убежала вверх).
function Confirm({ s }: { s: Strategy }) {
  if (s.delayMin == null) return <span className="text-muted">-</span>;
  const k = s.skipped;
  const other = (k.expired ?? 0) + (k.full ?? 0) + (k.removed ?? 0);
  return (
    <span className="whitespace-nowrap" title="Waiting to buy · skipped: liquidity pulled / price dropped / already ran / other">
      <span className="text-sky">{s.pending} wait</span>
      <span className="text-muted"> · </span>
      <span className={k.liq ? "text-danger" : "text-muted"}>{k.liq ?? 0} liq</span>
      <span className="text-muted"> · </span>
      <span className={k.drop ? "text-coral" : "text-muted"}>{k.drop ?? 0} drop</span>
      <span className="text-muted"> · </span>
      <span className={k.ran ? "text-honey" : "text-muted"}>{k.ran ?? 0} ran</span>
      {other > 0 && <span className="text-muted"> · {other} other</span>}
    </span>
  );
}

function Leaderboard({ strategies, ids }: { strategies: Strategy[]; ids: string[] }) {
  const rows = [...strategies].sort((a, b) => b.pnl + b.openPnl - (a.pnl + a.openPnl));
  return (
    <div className="overflow-x-auto">
      <table className="num w-full min-w-[1180px] text-xs">
        <thead className="text-left text-muted">
          <tr className="border-b border-line">
            <th className="px-4 py-2 font-medium">Strategy</th>
            <th className="px-2 py-2 text-right font-medium">Trades</th>
            <th className="px-2 py-2 text-right font-medium">Open</th>
            <th className="px-2 py-2 text-right font-medium">Confirm</th>
            <th className="px-2 py-2 text-right font-medium">Win rate</th>
            <th className="px-2 py-2 text-right font-medium">Realized</th>
            <th className="px-2 py-2 text-right font-medium">Unrealized</th>
            <th className="px-2 py-2 text-right font-medium">Avg / median</th>
            <th className="px-2 py-2 text-right font-medium" title="95% range of the average trade: wide means too few trades to tell">Avg range</th>
            <th className="px-2 py-2 text-right font-medium">Profit factor</th>
            <th className="px-2 py-2 text-right font-medium" title="Realized P&L without the best trade and without the two best. If it flips negative, one coin made the result">Without best / top 2</th>
            <th className="px-2 py-2 text-right font-medium">Max DD</th>
            <th className="px-4 py-2 text-right font-medium">Avg hold</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/60">
          {rows.map((s) => (
            <tr key={s.id} className={cn(!s.enabled && "opacity-60")}>
              <td className="px-4 py-2">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorOf(ids, s.id) }} />
                  <span className="font-semibold text-fg">
                    {s.id.toUpperCase()} {s.label}
                  </span>
                  {!s.enabled && <span className="text-[10px] text-muted">paused</span>}
                </div>
                <div className="mt-0.5 pl-4 text-[11px] text-muted">
                  {s.note}. {rules(s)}
                </div>
              </td>
              <td className="px-2 py-2 text-right">{s.trades}</td>
              <td className="px-2 py-2 text-right">{s.open}</td>
              <td className="px-2 py-2 text-right text-[11px]">
                <Confirm s={s} />
              </td>
              <td className="px-2 py-2 text-right">{s.winRate == null ? "-" : `${s.winRate}%`}</td>
              <td className={cn("px-2 py-2 text-right font-semibold", tone(s.pnl))}>{s.trades ? usd(s.pnl) : "-"}</td>
              <td className={cn("px-2 py-2 text-right", tone(s.openPnl))}>{s.open ? usd(s.openPnl) : "-"}</td>
              <td className="px-2 py-2 text-right">
                <span className={tone(s.avgRet)}>{pct(s.avgRet)}</span> / <span className={tone(s.medianRet)}>{pct(s.medianRet)}</span>
              </td>
              <td className="px-2 py-2 text-right text-[11px]">
                {s.avgRetLo == null ? <span className="text-muted">-</span> : <span className={tone(s.avgRetLo > 0 ? 1 : s.avgRetHi! < 0 ? -1 : 0)}>{pct(s.avgRetLo)} to {pct(s.avgRetHi)}</span>}
              </td>
              <td className="px-2 py-2 text-right">{s.profitFactor ?? (s.trades && s.wins === s.trades ? "no losses" : "-")}</td>
              <td className="px-2 py-2 text-right" title={s.bestShare != null ? `Best trade is ${s.bestShare}% of all gains` : undefined}>
                <span className={tone(s.pnlExBest)}>{s.pnlExBest == null ? "-" : usd(s.pnlExBest)}</span>
                <span className="text-muted"> / </span>
                <span className={tone(s.pnlExTop2)}>{s.pnlExTop2 == null ? "-" : usd(s.pnlExTop2)}</span>
              </td>
              <td className={cn("px-2 py-2 text-right", s.maxDrawdown ? "text-danger" : "text-muted")}>{s.maxDrawdown ? `-$${fmt(s.maxDrawdown, 2)}` : "-"}</td>
              <td className="px-4 py-2 text-right">{mins(s.avgHoldMin)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Кривые реализованного P&L по времени закрытия: SVG без библиотек, ноль пунктиром.
function EquityCurves({ strategies, ids, startedAt }: { strategies: Strategy[]; ids: string[]; startedAt: number | null }) {
  const lines = strategies.filter((s) => s.curve.length);
  if (!lines.length) return <p className="px-4 py-10 text-center text-sm text-muted">No closed trades yet. Curves show up after the first exits.</p>;
  const W = 720;
  const Ht = 240;
  const P = { l: 60, r: 12, t: 12, b: 24 };
  const t0 = Math.min(startedAt ?? Infinity, ...lines.map((s) => s.curve[0][0]));
  const t1 = Math.max(Date.now(), t0 + 60_000);
  const vals = lines.flatMap((s) => s.curve.map((c) => c[1]));
  const lo = Math.min(0, ...vals);
  const hi = Math.max(0, ...vals);
  const span = hi - lo || 1;
  const x = (t: number) => P.l + ((t - t0) / (t1 - t0)) * (W - P.l - P.r);
  const y = (v: number) => P.t + ((hi - v) / span) * (Ht - P.t - P.b);
  const ticks = [hi, (hi + lo) / 2, lo];
  const xt = [0, 0.25, 0.5, 0.75, 1].map((f) => t0 + f * (t1 - t0));
  // Ступенька: P&L меняется только в момент закрытия сделки, последнее значение тянем до «сейчас».
  const points = (s: Strategy) =>
    [`${x(t0)},${y(0)}`, ...s.curve.flatMap((c, i) => [`${x(c[0])},${y(i ? s.curve[i - 1][1] : 0)}`, `${x(c[0])},${y(c[1])}`]), `${x(t1)},${y(s.curve[s.curve.length - 1][1])}`].join(" ");
  return (
    <div className="p-4">
      <svg viewBox={`0 0 ${W} ${Ht}`} className="h-auto w-full" role="img" aria-label="Cumulative realized paper P&L per strategy">
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} className="stroke-line" strokeWidth={1} />
            <text x={P.l - 6} y={y(v) + 4} textAnchor="end" className="fill-muted text-[10px]">
              {usd(Math.round(v))}
            </text>
          </g>
        ))}
        <line x1={P.l} x2={W - P.r} y1={y(0)} y2={y(0)} className="stroke-muted" strokeWidth={1} strokeDasharray="4 4" />
        {xt.map((t, i) => (
          <text key={i} x={x(t)} y={Ht - 6} textAnchor={i === 0 ? "start" : i === xt.length - 1 ? "end" : "middle"} className="fill-muted text-[10px]">
            {new Date(t).toLocaleString("en-US", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </text>
        ))}
        {lines.map((s) => (
          <polyline key={s.id} fill="none" strokeWidth={2} strokeLinejoin="round" style={{ stroke: colorOf(ids, s.id) }} points={points(s)} />
        ))}
      </svg>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {lines.map((s) => (
          <span key={s.id} className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded" style={{ background: colorOf(ids, s.id) }} />
            <span>{s.id.toUpperCase()}</span>
            <span className={cn("num", tone(s.pnl))}>{usd(s.pnl)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Legacy({ d }: { d: PaperData }) {
  return (
    <Card className="mb-5">
      <CardHeader title="Old backtest view" sub={`The first version: $${d.stake} at the Track Record scan price, sold ${d.windowHours}h later, no stops, no fees.`} />
      <ul className="num divide-y divide-line/60 text-xs">
        {d.strategies.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
            <span className="text-fg">{s.label}</span>
            <span className="flex gap-4 text-muted">
              <span>{s.trades} trades</span>
              <span>win {s.winRate == null ? "-" : `${s.winRate}%`}</span>
              <span>
                avg <span className={tone(s.avgRet)}>{pct(s.avgRet)}</span>
              </span>
              <span className={cn("font-semibold", tone(s.pnl))}>{s.trades ? usd(s.pnl) : "-"}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// Плашка про живую торговлю: только когда она включена на сервере (режим не off).
function LiveBanner() {
  const { data } = useApi<{ mode: string }>("/api/live", 300_000);
  if (!data || data.mode === "off") return null;
  return (
    <Link href="/live" className="mb-5 flex items-center justify-between gap-3 rounded-lg border border-coral/50 bg-coral/10 px-4 py-3 text-sm hover:bg-coral/15">
      <span>
        <b className="text-coral">Live auto trading (beta) for holders</b>
        <span className="text-muted"> · let a trading wallet follow these strategies with real swaps</span>
      </span>
      <span className="shrink-0 text-xs font-semibold text-coral">Open</span>
    </Link>
  );
}

export function PaperView() {
  const { data } = useApi<Data>("/api/paper", 60_000);
  const e = data?.engine;
  const ids = (e?.strategies ?? []).map((s) => s.id);
  const totals = (e?.strategies ?? []).reduce((a, s) => ({ trades: a.trades + s.trades, open: a.open + s.open }), { trades: 0, open: 0 });
  const best = [...(e?.strategies ?? [])].filter((s) => s.trades).sort((a, b) => b.pnl - a.pnl)[0];
  const label = new Map((e?.strategies ?? []).map((s) => [s.id, s.label]));

  return (
    <>
      <PageHeader
        title="Auto Trading · paper"
        action={
          <Link href="/paper/builder" className="inline-flex h-9 items-center rounded-lg bg-honey px-4 text-sm font-semibold text-black hover:bg-[#ffc24d]">
            Build your own strategy
          </Link>
        }
        sub={`The swarm trades its own Launch Radar calls automatically with fake money, live. ${e ? e.strategies.filter((x) => x.enabled).length : "Several"} strategies run side by side, each with its own entry filter, take profit, stop loss, trailing stop and time limit. Prices are checked every ${e?.sampleSec ?? 60}s (fast strategies every 10s with extra slippage), fees and slippage are in, a rug counts as -100%. Losing strategies get switched off, new ones get added, every trade stays on the page.`}
      />
      <p className="-mt-3 mb-2 text-xs text-coral">Paper money only. No real trades are made. Not financial advice.</p>
      <p className="mb-5 text-xs text-muted">
        Holders get live strategy signals in Telegram: /signals in{" "}
        <a href="https://t.me/crawlhivebot" target="_blank" rel="noreferrer" className="text-honey hover:underline">
          @crawlhivebot
        </a>
      </p>
      <LiveBanner />

      {e && !e.enabled && <p className="mb-5 rounded-lg border border-line bg-panel px-4 py-3 text-sm text-muted">The paper engine is switched off right now. Numbers below are frozen.</p>}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Running since" value={e?.startedAt ? when(e.startedAt) : "-"} hint={e?.lastTick ? `last price check ${timeAgo(e.lastTick)}` : "waiting for the first price check"} tone="sky" />
        <Stat label="Closed trades" value={String(totals.trades)} hint="all strategies together" tone="teal" />
        <Stat label="Open positions" value={String(totals.open)} hint={`up to ${e?.maxOpen ?? 40} per strategy`} tone="violet" />
        <Stat label="Leader" value={best ? `${best.id.toUpperCase()} ${usd(best.pnl)}` : "-"} hint={best ? best.label : "no closed trades yet"} tone="lime" />
      </div>

      <Card className="mb-5">
        <CardHeader title="Strategy leaderboard" sub="Sorted by realized plus unrealized P&L. Each trade is a $100 paper buy." />
        {e ? <Leaderboard strategies={e.strategies} ids={ids} /> : <p className="px-4 py-10 text-center text-sm text-muted">Loading…</p>}
      </Card>

      <Card className="mb-5">
        <CardHeader title="Equity curves" sub="Cumulative realized P&L per strategy, by the time each trade closed." />
        {e ? <EquityCurves strategies={e.strategies} ids={ids} startedAt={e.startedAt} /> : <p className="px-4 py-10 text-center text-sm text-muted">Loading…</p>}
      </Card>

      <Card className="mb-5">
        <CardHeader title={`Open positions (${e?.open.length ?? 0})`} sub="Live P&L if sold at the last price check, after fees and slippage." />
        {!e?.open.length ? (
          <p className="px-4 py-6 text-center text-sm text-muted">Nothing open. New positions open the moment Launch Radar posts a verdict a strategy likes.</p>
        ) : (
          <ul className="divide-y divide-line/60">
            {e.open.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorOf(ids, p.strategy) }} />
                  <span className="num text-[11px] text-muted">{p.strategy.toUpperCase()}</span>
                  <Link href={`/scan/${p.token}`} className="font-semibold hover:text-honey">
                    ${p.symbol}
                  </Link>
                  <span className="num text-[11px] text-muted">
                    {short(p.token)} · {p.chain} · in {timeAgo(p.entryAt)} at ${price(p.entryPrice)}
                  </span>
                </span>
                <span className="num flex shrink-0 items-center gap-3 text-xs">
                  <VerdictPill verdict={p.verdict} score={p.score} />
                  <span className="text-muted">peak {pct(p.peakPct)}</span>
                  {p.missing > 0 && <span className="text-danger">pair missing {p.missing}x</span>}
                  <span className={cn("w-16 text-right font-semibold", tone(p.retPct))}>{pct(p.retPct)}</span>
                  <span className={cn("w-16 text-right", tone(p.pnl))}>{usd(p.pnl)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="mb-5">
        <CardHeader title="Recent trades" sub="Last 100 exits across all strategies. Net return includes fees and slippage." />
        {!e?.trades.length ? (
          <p className="px-4 py-6 text-center text-sm text-muted">No exits yet.</p>
        ) : (
          <ul className="divide-y divide-line/60">
            {e.trades.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorOf(ids, t.strategy) }} />
                  <span className="num text-[11px] text-muted" title={label.get(t.strategy)}>
                    {t.strategy.toUpperCase()}
                  </span>
                  <Link href={`/scan/${t.token}`} className="font-semibold hover:text-honey">
                    ${t.symbol}
                  </Link>
                  <span className="num text-[11px] text-muted">
                    {t.chain} · held {mins(Math.round((t.exitAt - t.entryAt) / 60_000))} · closed {timeAgo(t.exitAt)}
                  </span>
                </span>
                <span className="num flex shrink-0 items-center gap-3 text-xs">
                  <VerdictPill verdict={t.verdict} score={t.score} />
                  <span className={REASON[t.reason]?.cls ?? "text-muted"}>{REASON[t.reason]?.label ?? t.reason}</span>
                  <span className="text-muted">peak {pct(t.peakPct)}</span>
                  <span className={cn("w-16 text-right font-semibold", tone(t.netPct))}>{pct(t.netPct)}</span>
                  <span className={cn("w-16 text-right", tone(t.pnl))}>{usd(t.pnl)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {data?.legacy && <Legacy d={data.legacy} />}

      <p className="text-xs text-muted">
        How it works: when Launch Radar finishes a scan, every strategy whose filter matches buys $100 at the scan price. Confirmed strategies wait instead and buy at the price of that moment, but only if the pool still holds most of its liquidity and the price has not dropped or run too far; otherwise the signal is counted as skipped. Each buy and sell pays a {Math.round((e?.fee ?? 0.01) * 100)}% fee plus slippage of size over pool
        liquidity, capped. Exits are checked in order: stop loss, take profit, trailing stop, time limit, at the real sampled price, so a fast candle can blow past a level. A pair that vanishes or drops under $500 liquidity
        for three checks in a row is a rug at -100%. Real trading would still do worse: no failed transactions, no MEV, no delay. Verdict outcomes live on{" "}
        <Link href="/track" className="text-honey hover:underline">
          Track Record
        </Link>
        .
      </p>
    </>
  );
}
