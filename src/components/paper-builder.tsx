"use client";
// Strategy builder: холдер собирает свою бумажную стратегию (вход по вердиктам и ликвидности, выходы, частичная
// фиксация, быстрое исполнение), движок гоняет её рядом со стратегиями проекта, а здесь видны её итоги.
// Free и не вошедшие видят форму и демо-карточку на живых числах стратегии проекта S12, но сохранить не могут.
// Только бумага: настоящих сделок нет.
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { Lock, Pause, Pencil, Play, Trash2, Wallet } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Chips, Input, Label, Segmented } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { VerdictPill, pct } from "@/components/verdict";
import { useWallet } from "@/components/wallet-provider";
import { del, patch, post } from "@/lib/client/api";
import { useApi } from "@/lib/client/use-api";
import { useViewerTier } from "@/lib/client/use-tier";
import { TIER_NAME, type Tier } from "@/lib/tier-gate";
import { cn, fmt, timeAgo } from "@/lib/utils";
import {
  RANGES,
  USER_NAME_MAX,
  USER_PRESETS,
  USER_SIZE_USD,
  USER_VERDICTS,
  describeUserConfig,
  normalizeUserConfig,
  userConfigError,
  type UserStrategyConfig,
  type UserVerdict,
} from "@/lib/user-strategy-config";
import type { PaperEngineData, UserStrategyStats } from "@/lib/server/paper-engine";
import type { MyStrategy } from "@/lib/server/user-strategies";

interface Mine {
  tier: Tier;
  max: number;
  active: number;
  saved: number;
  maxSaved: number;
  list: MyStrategy[];
}
type Stats = UserStrategyStats["strategies"][number];
type Summary = PaperEngineData["strategies"][number];

const usd = (n: number) => `${n < 0 ? "-" : n > 0 ? "+" : ""}$${fmt(Math.abs(n), Math.abs(n) < 100 ? 2 : 0)}`;
const tone = (n: number | null | undefined) => (n == null || n === 0 ? "text-muted" : n > 0 ? "text-lime" : "text-danger");
const mins = (m: number | null) => (m == null ? "-" : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`);
const REASON: Record<string, string> = { tp: "take profit", sl: "stop loss", trail: "trailing stop", time: "time out", rug: "rugged", removed: "removed" };

// ---------- форма ----------

type Delay = "0" | "10" | "30";
interface Form {
  name: string;
  verdicts: UserVerdict[];
  verdictsV2: UserVerdict[];
  verdictsV3: UserVerdict[];
  minLiq: string;
  maxLiq: string;
  noPumpFun: boolean;
  delay: Delay;
  tp: string;
  sl: string;
  trail: string;
  trailArm: string;
  partialOn: boolean;
  partialAt: string;
  partialSell: string;
  breakeven: boolean;
  maxHoldH: string;
  fast: boolean;
}

const s = (n: number | undefined) => (n === undefined ? "" : String(n));
function formOf(name: string, c: UserStrategyConfig): Form {
  return {
    name,
    verdicts: c.verdicts ?? [],
    verdictsV2: c.verdictsV2 ?? [],
    verdictsV3: c.verdictsV3 ?? [],
    minLiq: s(c.minLiqUsd),
    maxLiq: s(c.maxLiqUsd),
    noPumpFun: !!c.noPumpFun,
    delay: String(c.delayMin ?? 0) as Delay,
    tp: s(c.tpPct),
    sl: s(c.slPct),
    trail: s(c.trailPct),
    trailArm: s(c.trailArmPct),
    partialOn: !!c.partial,
    partialAt: s(c.partial?.atPct ?? 100),
    partialSell: s(c.partial?.sellPct ?? 50),
    breakeven: c.partial?.breakeven ?? true,
    maxHoldH: String(Math.round((c.maxHoldMin / 60) * 10) / 10),
    fast: !!c.fast,
  };
}
function configOf(f: Form): UserStrategyConfig {
  const n = (v: string) => (v.trim() === "" ? undefined : Number(v));
  return normalizeUserConfig({
    verdicts: f.verdicts,
    verdictsV2: f.verdictsV2,
    verdictsV3: f.verdictsV3,
    minLiqUsd: n(f.minLiq),
    maxLiqUsd: n(f.maxLiq),
    noPumpFun: f.noPumpFun,
    delayMin: Number(f.delay),
    tpPct: n(f.tp),
    slPct: n(f.sl),
    trailPct: n(f.trail),
    trailArmPct: n(f.trailArm),
    partial: f.partialOn ? { atPct: n(f.partialAt), sellPct: n(f.partialSell), breakeven: f.breakeven } : undefined,
    maxHoldMin: Math.round((n(f.maxHoldH) ?? 24) * 60),
    fast: f.fast,
  });
}
const START = formOf(USER_PRESETS[0].name, USER_PRESETS[0].config);

function Toggle({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={cn("rounded-lg border px-2.5 py-1 text-xs transition-colors", on ? "border-honey/60 bg-honey/10 text-honey" : "border-line text-muted hover:text-fg")}
    >
      {children}
    </button>
  );
}

function NumField({ label, hint, value, onChange, placeholder, suffix }: { label: string; hint?: string; value: string; onChange: (v: string) => void; placeholder?: string; suffix?: string }) {
  return (
    <label className="block min-w-0">
      <Label hint={hint}>{label}</Label>
      <div className="relative">
        <Input inputMode="decimal" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))} className={suffix ? "pr-8" : undefined} />
        {suffix && <span className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-xs text-muted">{suffix}</span>}
      </div>
    </label>
  );
}

function Builder({ form, setForm, editing, canSave, saving, onSave, onCancel, gate }: {
  form: Form;
  setForm: (f: Form) => void;
  editing: string | null;
  canSave: boolean;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  gate: ReactNode;
}) {
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm({ ...form, [k]: v });
  const config = useMemo(() => configOf(form), [form]);
  const err = userConfigError(config);
  const r = (k: keyof typeof RANGES) => `${RANGES[k][0]} to ${RANGES[k][1]}`;
  return (
    <Card className="mb-5">
      <CardHeader title={editing ? `Edit ${editing.toUpperCase()}` : "New strategy"} sub={`Every trade is a $${USER_SIZE_USD} paper buy. Fees, slippage and rugs count the same as for project strategies.`} />
      <div className="space-y-5 p-4">
        <div>
          <Label hint="prefill, then tweak">Presets</Label>
          <div className="flex flex-wrap gap-2">
            {USER_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                title={p.note}
                onClick={() => setForm({ ...formOf(editing ? form.name : p.name, p.config) })}
                className="rounded-lg border border-line px-3 py-1.5 text-left text-xs hover:border-honey/60 hover:text-honey"
              >
                <span className="font-semibold">{p.name}</span>
                <span className="block text-[11px] text-muted">{p.note}</span>
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <Label hint={`up to ${USER_NAME_MAX} characters`}>Name</Label>
          <Input value={form.name} maxLength={USER_NAME_MAX} onChange={(e) => set("name", e.target.value)} placeholder="My deep pool runner" />
        </label>

        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <Label hint="public score v1">Verdict v1</Label>
            <Chips options={USER_VERDICTS} value={form.verdicts} onChange={(v) => set("verdicts", v)} />
          </div>
          <div>
            <Label hint="score v2">Verdict v2</Label>
            <Chips options={USER_VERDICTS} value={form.verdictsV2} onChange={(v) => set("verdictsV2", v)} />
          </div>
          <div>
            <Label hint="shadow score v3">Verdict v3</Label>
            <Chips options={USER_VERDICTS} value={form.verdictsV3} onChange={(v) => set("verdictsV3", v)} />
          </div>
        </div>
        <p className="-mt-3 text-[11px] text-muted">Every picked group must match. Leave a group empty to ignore it.</p>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <NumField label="Min liquidity" hint="USD" value={form.minLiq} onChange={(v) => set("minLiq", v)} placeholder="any" />
          <NumField label="Max liquidity" hint="USD" value={form.maxLiq} onChange={(v) => set("maxLiq", v)} placeholder="any" />
          <div>
            <Label>Entry</Label>
            <Segmented options={["0", "10", "30"] as const} value={form.delay} onChange={(v) => set("delay", v)} render={(o) => (o === "0" ? "On scan" : `Confirm ${o}m`)} />
          </div>
          <div>
            <Label>Filters</Label>
            <div className="flex flex-wrap gap-1.5">
              <Toggle on={form.noPumpFun} onChange={(v) => set("noPumpFun", v)}>
                No pump.fun
              </Toggle>
              <Toggle on={form.fast} onChange={(v) => set("fast", v)}>
                Fast fills
              </Toggle>
            </div>
          </div>
        </div>
        {form.delay !== "0" && <p className="-mt-3 text-[11px] text-muted">Confirmed entry: buys {form.delay} min after the scan only if 80%+ of liquidity is still there and the price is not down 15% or up 60%.</p>}
        {form.fast && <p className="-mt-3 text-[11px] text-muted">Fast fills: prices every 10s instead of every minute, but each side pays 3% extra slippage.</p>}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <NumField label="Take profit" hint={r("tpPct")} value={form.tp} onChange={(v) => set("tp", v)} placeholder="off" suffix="%" />
          <NumField label="Stop loss" hint={r("slPct")} value={form.sl} onChange={(v) => set("sl", v)} placeholder="off" suffix="%" />
          <NumField label="Trailing stop" hint={r("trailPct")} value={form.trail} onChange={(v) => set("trail", v)} placeholder="off" suffix="%" />
          <NumField label="Trail arms at" hint="gain from entry" value={form.trailArm} onChange={(v) => set("trailArm", v)} placeholder="0" suffix="%" />
          <NumField label="Max hold" hint="0.5 to 24" value={form.maxHoldH} onChange={(v) => set("maxHoldH", v)} placeholder="24" suffix="h" />
        </div>

        <div>
          <Toggle on={form.partialOn} onChange={(v) => set("partialOn", v)}>
            Partial take profit
          </Toggle>
          {form.partialOn && (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <NumField label="Sell at" hint={r("partialAtPct")} value={form.partialAt} onChange={(v) => set("partialAt", v)} suffix="%" />
              <NumField label="Sell share" hint={r("partialSellPct")} value={form.partialSell} onChange={(v) => set("partialSell", v)} suffix="%" />
              <div>
                <Label>After the partial</Label>
                <Toggle on={form.breakeven} onChange={(v) => set("breakeven", v)}>
                  Move stop to entry
                </Toggle>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-line bg-panel-2/50 px-3 py-2 text-xs">
          <span className="text-muted">Rules after limits: </span>
          <span className={err ? "text-danger" : "text-fg"}>{err ?? describeUserConfig(config)}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canSave ? (
            <Button onClick={onSave} disabled={saving || !!err || !form.name.trim()}>
              {editing ? "Save changes" : "Save and start"}
            </Button>
          ) : (
            gate
          )}
          {editing && (
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

// ---------- итоги стратегии ----------

function StatGrid({ s }: { s: Summary }) {
  const cells: [string, ReactNode, string?][] = [
    ["Trades", s.trades],
    ["Win rate", s.winRate == null ? "-" : `${s.winRate}%`],
    ["Realized", s.trades ? usd(s.pnl) : "-", tone(s.pnl)],
    ["Unrealized", s.open ? usd(s.openPnl) : "-", tone(s.openPnl)],
    ["Avg trade", pct(s.avgRet), tone(s.avgRet)],
    ["95% range", s.avgRetLo == null ? "-" : `${pct(s.avgRetLo)} to ${pct(s.avgRetHi)}`],
    ["Profit factor", s.profitFactor ?? (s.trades && s.wins === s.trades ? "no losses" : "-")],
    ["Max DD", s.maxDrawdown ? `-$${fmt(s.maxDrawdown, 2)}` : "-", s.maxDrawdown ? "text-danger" : undefined],
    ["Without best", s.pnlExBest == null ? "-" : usd(s.pnlExBest), tone(s.pnlExBest)],
    ["Open / waiting", `${s.open} / ${s.pending}`],
  ];
  return (
    <div className="num grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line text-xs sm:grid-cols-5">
      {cells.map(([k, v, cls]) => (
        <div key={k} className="bg-panel px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-muted">{k}</div>
          <div className={cn("mt-0.5 font-semibold", cls)}>{v}</div>
        </div>
      ))}
    </div>
  );
}

function Positions({ s }: { s: Stats }) {
  if (!s.openPositions.length && !s.lastTrades.length) return <p className="text-xs text-muted">No trades yet. It buys the moment Launch Radar posts a verdict this strategy likes.</p>;
  return (
    <div className="space-y-3">
      {s.openPositions.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] uppercase tracking-wider text-muted">Open</div>
          <ul className="divide-y divide-line/60 rounded-lg border border-line">
            {s.openPositions.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-xs">
                <span className="flex min-w-0 items-center gap-2">
                  <Link href={`/scan/${p.token}`} className="font-semibold hover:text-honey">
                    ${p.symbol}
                  </Link>
                  <span className="text-muted">
                    {p.chain} · in {timeAgo(p.entryAt)}
                  </span>
                </span>
                <span className="num flex items-center gap-3">
                  <VerdictPill verdict={p.verdict} score={p.score} />
                  <span className={cn("font-semibold", tone(p.retPct))}>{pct(p.retPct)}</span>
                  <span className={tone(p.pnl)}>{usd(p.pnl)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {s.lastTrades.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] uppercase tracking-wider text-muted">Last trades</div>
          <ul className="divide-y divide-line/60 rounded-lg border border-line">
            {s.lastTrades.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-xs">
                <span className="flex min-w-0 items-center gap-2">
                  <Link href={`/scan/${t.token}`} className="font-semibold hover:text-honey">
                    ${t.symbol}
                  </Link>
                  <span className="text-muted">
                    {REASON[t.reason] ?? t.reason} · held {mins(Math.round((t.exitAt - t.entryAt) / 60_000))} · {timeAgo(t.exitAt)}
                  </span>
                </span>
                <span className="num flex items-center gap-3">
                  <span className={cn("font-semibold", tone(t.netPct))}>{pct(t.netPct)}</span>
                  <span className={tone(t.pnl)}>{usd(t.pnl)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function StrategyCard({ m, st, busy, onToggle, onEdit, onDelete }: { m: MyStrategy; st: Stats | undefined; busy: boolean; onToggle: () => void; onEdit: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className={cn("p-4", !m.enabled && "opacity-75")}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="num text-[11px] text-muted">{m.id.toUpperCase()}</span>
            <span className="font-semibold">{m.name}</span>
            <span className={cn("rounded px-1.5 py-0.5 text-[10px]", m.enabled ? "bg-lime/10 text-lime" : "bg-panel-2 text-muted")}>{m.enabled ? "running" : "paused"}</span>
          </div>
          <p className="mt-0.5 text-[11px] text-muted">{describeUserConfig(m.config)}</p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <Button size="sm" variant="outline" disabled={busy} onClick={onToggle} title={m.enabled ? "Pause: no new entries, open positions run out" : "Resume"}>
            {m.enabled ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            {m.enabled ? "Pause" : "Resume"}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onEdit} title="Edit">
            <Pencil className="size-3.5" />
          </Button>
          <Button size="sm" variant="danger" disabled={busy} onClick={onDelete} title="Delete">
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
      {st ? <StatGrid s={st} /> : <div className="h-24 animate-pulse rounded-lg bg-panel-2/40" />}
      {st && (
        <div className="mt-3">
          <button type="button" onClick={() => setOpen(!open)} className="text-xs text-honey hover:underline">
            {open ? "Hide positions and trades" : `Positions and trades (${st.open} open, ${st.trades} closed)`}
          </button>
          {open && (
            <div className="mt-2">
              <Positions s={st} />
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ---------- страница ----------

export function PaperBuilder() {
  const { address, signedIn, connect, signIn } = useWallet();
  const toast = useToast();
  const mine = useApi<Mine>(signedIn ? `/api/paper/mine?w=${address}` : null, 60_000);
  const stats = useApi<UserStrategyStats>(signedIn ? `/api/paper/mine/stats?w=${address}` : null, 60_000);
  const m = signedIn ? mine.data : null;
  const canSave = !!m && m.max > 0;
  // Демо для тех, кто не может сохранять: живые числа стратегии проекта S12 в той же карточке.
  const demo = useApi<{ engine: PaperEngineData }>(m && m.list.length ? null : "/api/paper", 120_000);
  const demoRow = demo.data?.engine.strategies.find((x) => x.id === "s12");

  const [form, setForm] = useState<Form>(START);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const byId = new Map((stats.data?.strategies ?? []).map((x) => [x.id, x]));
  // Лимиты тарифов из /api/tier (источник правды TIER_LIMITS на сервере), в типе TierApi их нет.
  const limits = (useViewerTier().data as { limits?: Partial<Record<Tier, { strategies?: number | string }>> } | null)?.limits;

  const reload = () => Promise.all([mine.reload(), stats.reload()]);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast(ok);
      await reload();
      return true;
    } catch (e) {
      toast((e as Error).message, "error");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    const payload = { name: form.name, config: configOf(form) };
    const ok = editing
      ? await run(() => patch("/api/paper/mine", { id: editing, ...payload }), "Strategy updated")
      : await run(() => post("/api/paper/mine", { ...payload, enabled: (m?.active ?? 0) < (m?.max ?? 0) }), (m?.active ?? 0) < (m?.max ?? 0) ? "Strategy saved and running" : "Strategy saved as paused: active limit reached");
    if (ok) {
      setEditing(null);
      setForm(START);
    }
  };

  const gate = !signedIn ? (
    <Button onClick={() => (address ? signIn() : connect()).catch(() => {})}>
      <Wallet className="size-4" /> {address ? "Sign in to save" : "Connect wallet to save"}
    </Button>
  ) : (
    <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
      <Link href="/pricing" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-honey px-4 text-sm font-semibold text-black hover:bg-[#ffc24d]">
        <Lock className="size-4" /> Unlock with Holder
      </Link>
      {m ? "Saving strategies needs the Holder tier or higher." : (mine.error ?? "Checking your tier…")}
    </span>
  );

  return (
    <>
      <PageHeader
        title="Strategy builder · paper"
        sub="Build your own auto trading strategy on Launch Radar verdicts. The paper engine runs it next to the project strategies on every new verdict, with the same prices, fees, slippage and rug rules, and you see how it does live."
        action={
          <Link href="/paper" className="text-sm text-honey hover:underline">
            Project strategies
          </Link>
        }
      />
      <p className="-mt-3 mb-5 text-xs text-coral">Paper money only. No real trades are made. Not financial advice.</p>

      <div className="mb-5 flex flex-wrap gap-2 text-xs">
        {(["holder", "pro", "whale"] as Tier[]).map((t) => (
          <span key={t} className={cn("rounded-lg border px-2.5 py-1", m?.tier === t ? "border-honey/60 text-honey" : "border-line text-muted")}>
            {TIER_NAME[t]}: {limits?.[t]?.strategies ?? "…"} active
          </span>
        ))}
        {m && (
          <span className="rounded-lg border border-line px-2.5 py-1 text-fg">
            You: {TIER_NAME[m.tier]}, {m.active} of {m.max} active
          </span>
        )}
      </div>

      <Builder
        form={form}
        setForm={setForm}
        editing={editing}
        canSave={canSave}
        saving={busy}
        onSave={save}
        onCancel={() => {
          setEditing(null);
          setForm(START);
        }}
        gate={gate}
      />

      {m && m.list.length > 0 ? (
        <div className="mb-5 space-y-3">
          <h2 className="text-sm font-semibold">My strategies</h2>
          {m.list.map((x) => (
            <StrategyCard
              key={x.id}
              m={x}
              st={byId.get(x.id)}
              busy={busy}
              onToggle={() => run(() => patch("/api/paper/mine", { id: x.id, enabled: !x.enabled }), x.enabled ? "Paused. Open positions run out by their rules" : "Running")}
              onEdit={() => {
                setEditing(x.id);
                setForm(formOf(x.name, x.config));
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              onDelete={() => {
                if (window.confirm(`Delete ${x.name}? Open positions are closed at the next price check.`)) run(() => del(`/api/paper/mine?id=${x.id}`), "Strategy deleted");
              }}
            />
          ))}
        </div>
      ) : (
        <Card className="mb-5 p-4">
          <div className="mb-3">
            <div className="text-[11px] uppercase tracking-wider text-muted">Demo</div>
            <div className="font-semibold">This is how your strategy card looks</div>
            <p className="text-[11px] text-muted">Live numbers of project strategy S12 Deep liquidity, the same rules as the Deep pools preset.</p>
          </div>
          {demoRow ? <StatGrid s={demoRow} /> : <div className="h-24 animate-pulse rounded-lg bg-panel-2/40" />}
        </Card>
      )}

      <p className="text-xs text-muted">
        How it works: your strategy sees every Launch Radar verdict the moment it is ready and buys ${USER_SIZE_USD} of paper money when the filter matches. Exits are checked in order: stop loss, take profit, trailing stop, time limit, at the real sampled price.
        Up to 40 open positions per strategy, the same coin once a day. Pausing stops new entries, open positions run out by their rules; deleting closes them at the next price check. If your tier drops, the newest strategies over the limit get paused. Your strategies are private and never show up on the public
        leaderboard. Results are simulated and real trading would do worse.
      </p>
    </>
  );
}
