"use client";
// Страница краулера: метрики, разложение репутации, сигналы и управление для владельца.
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Pause, Play, Store, Save, ArrowLeft, RefreshCw, Hourglass } from "lucide-react";
import { Card, CardHeader, Stat } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Segmented } from "@/components/ui/field";
import { NarrativeBadge, SourceBadge, StatusBadge, TierBadge } from "@/components/ui/badge";
import { RepBreakdown } from "@/components/crawler/rep-breakdown";
import { SpecEditor } from "@/components/crawler/spec-editor";
import { Badge } from "@/components/ui/badge";
import { SignalFeed } from "@/components/signal-feed";
import { useWallet } from "@/components/wallet-provider";
import { useToast } from "@/components/ui/toast";
import { useApi } from "@/lib/client/use-api";
import { usePay } from "@/lib/client/use-pay";
import { useConfig, explorerTx } from "@/lib/client/use-config";
import { patch, post } from "@/lib/client/api";
import { renewWithPayment, type BurnStep } from "@/lib/client/burn";
import { TIERS, CREDITS } from "@/lib/economy";
import type { CrawlerSpec, PublicCrawler, Signal } from "@/lib/types";
import { cn, fmt, short, timeAgo, timeLeft } from "@/lib/utils";

type Detail = PublicCrawler & { recentSignals: Signal[] };

function hours(sec: number) {
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400 * 2) return `${(sec / 3600).toFixed(1)}h`;
  return `${(sec / 86400).toFixed(1)}d`;
}

export function CrawlerView() {
  const { id } = useParams<{ id: string }>();
  const { address } = useWallet();
  const toast = useToast();
  const { data: c, error, reload } = useApi<Detail>(`/api/crawlers/${id}`, 4000);
  const cfg = useConfig();

  if (error) return <div className="py-20 text-center text-muted">{error}</div>;
  if (!c) return <div className="py-20 text-center text-muted">Loading crawler…</div>;

  const isOwner = address && c.owner === address;
  const isRenter = address && c.renter === address;
  const scored = c.stats.scored ?? c.stats.signals;
  const precision = scored ? (c.stats.hits / scored) * 100 : 0;

  const toggle = async () => {
    try {
      await patch(`/api/crawlers/${c.id}`, { status: c.status === "paused" ? "active" : "paused" });
      toast(c.status === "paused" ? "Crawler resumed" : "Crawler paused. Uptime will drop while it sleeps.");
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <>
      <Link href="/" className="mb-4 inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
        <ArrowLeft className="size-3" /> Swarm
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="num text-xs text-muted">{c.id}</div>
          <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">{c.name}</h1>
          <div className="mt-2 flex flex-wrap gap-1">
            <SourceBadge source={c.source} />
            <TierBadge tier={c.tier} />
            <StatusBadge status={c.status} />
            {c.live && c.expiresAt && c.expiresAt <= Date.now() ? (
              <Badge className="border-danger/40 text-danger">expired</Badge>
            ) : c.live ? (
              <Badge className="border-honey/40 text-honey">live crawler</Badge>
            ) : (
              <Badge title="Part of the simulated demo network">demo</Badge>
            )}
            {c.narratives.map((n) => (
              <NarrativeBadge key={n} n={n} />
            ))}
          </div>
          <div className="mt-2 text-xs text-muted">
            owner <span className="num text-fg">{short(c.owner)}</span>
            {isOwner && " (you)"} · spawned {timeAgo(c.createdAt)} ·{" "}
            {c.payment ? (
              <>
                {c.payment.unit === "SOL" || c.payment.unit === "ETH" ? "paid" : "burned"}{" "}
                <span className="num text-honey">{c.payment.unit === "SOL" || c.payment.unit === "ETH" ? c.payment.amount : fmt(c.payment.amount)}</span> {c.payment.unit}{" "}
                on-chain (
                <a href={c.payment.unit === "ETH" ? `https://robin.etherscan.io/tx/${c.payment.tx}` : explorerTx(c.payment.tx, cfg?.cluster ?? "devnet")} target="_blank" rel="noreferrer" className="num text-fg hover:text-honey">
                  tx {c.payment.tx.slice(0, 6)}…
                </a>
                )
              </>
            ) : (
              <>
                burned <span className="num text-honey">{fmt(c.burned)}</span> {CREDITS}
              </>
            )}
            {c.renter && (
              <>
                {" "}
                · rented by <span className="num text-violet">{short(c.renter)}</span>
                {isRenter && " (you)"}, {c.rentedUntil ? timeLeft(c.rentedUntil) : ""}
              </>
            )}
          </div>
        </div>
        {isOwner && c.status !== "rented" && (
          <Button variant="outline" onClick={toggle}>
            {c.status === "paused" ? <Play className="size-4" /> : <Pause className="size-4" />}
            {c.status === "paused" ? "Resume" : "Pause"}
          </Button>
        )}
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Items" value={fmt(c.stats.items)} />
        <Stat label="Signals" value={fmt(c.stats.signals)} />
        <Stat label="Hit rate" value={`${precision.toFixed(1)}%`} hint={`${fmt(c.stats.hits)} of ${fmt(scored)} scored`} />
        <Stat label="Uptime" value={`${((c.stats.uptimeSec / Math.max(1, c.stats.totalSec)) * 100).toFixed(1)}%`} hint={`${hours(c.stats.uptimeSec)} of ${hours(c.stats.totalSec)}`} />
        <Stat label="Cycle" value={`${c.frequencyMin}m`} hint={`${c.targets.length} targets`} />
        <Stat label="Earned" value={fmt(c.stats.rewards)} hint={CREDITS} accent />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Targets" sub={`${c.targets.length} of ${TIERS[c.tier].maxTargets} on ${TIERS[c.tier].label} · chain ${c.chain}`} />
            {isOwner || isRenter ? (
              <EditTargets c={c} onSaved={reload} />
            ) : (
              <div className="flex flex-wrap gap-1.5 p-4">
                {c.targets.map((t) => (
                  <span key={t} className="num rounded-md bg-panel-2 px-2 py-1 text-xs">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </Card>
          {c.live && (isOwner || isRenter) && c.spec && <SpecCard c={c} onSaved={reload} />}
          <Card>
            <CardHeader
              title="Recent signals"
              sub={
                c.live
                  ? isOwner || isRenter
                    ? "Private to you. Scored against the price after your horizon."
                    : "This crawler's signals are private to its owner"
                  : "Simulated demo signals"
              }
            />
            <SignalFeed signals={c.recentSignals} max={30} showCrawler={false} />
          </Card>
        </div>
        <div className="flex flex-col gap-5">
          {c.live && c.expiresAt && <TermCard c={c} isOwner={!!isOwner} onRenewed={reload} />}
          {c.live && c.run && <RunCard c={c} />}
          <Card className="p-4">
            <RepBreakdown crawler={c} />
          </Card>
          {isOwner && c.status !== "rented" && cfg?.demoNetwork && <ListForm c={c} />}
        </div>
      </div>
    </>
  );
}


// Оплаченный срок: сколько осталось и продление ещё на один срок по цене спавна тира.
function TermCard({ c, isOwner, onRenewed }: { c: Detail; isOwner: boolean; onRenewed: () => void }) {
  const { cfg, unit, simulated, price: priceOf, fmtPrice, signLabel } = usePay();
  const toast = useToast();
  const [step, setStep] = useState<BurnStep | null>(null);
  const STEP_LABEL: Record<BurnStep, string> = { prepare: "Preparing transaction…", sign: signLabel, confirm: "Checking payment on-chain…" };
  const expired = c.expiresAt! <= Date.now();
  const soon = !expired && c.expiresAt! - Date.now() < 3 * 86400_000;
  const price = priceOf(c.tier);

  const renew = async () => {
    try {
      if (simulated) await post(`/api/crawlers/${c.id}/renew`, {});
      else await renewWithPayment(c.id, setStep);
      toast(`Renewed for ${cfg?.termDays ?? 30} more days`);
      onRenewed();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setStep(null);
    }
  };

  return (
    <Card className={cn(expired && "border-danger/50", soon && "border-honey/50")}>
      <CardHeader title="Paid term" sub={`Each payment buys ${cfg?.termDays ?? 30} days of crawling`} />
      <div className="space-y-3 p-4 text-sm">
        <div className="flex items-center gap-2">
          <Hourglass className={cn("size-4", expired ? "text-danger" : soon ? "text-honey" : "text-muted")} />
          {expired ? (
            <span className="text-danger">Stopped {timeAgo(c.expiresAt!)}. Renew to resume crawling.</span>
          ) : (
            <span>
              Crawls until <span className="num">{new Date(c.expiresAt!).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>{" "}
              <span className="text-muted">({timeLeft(c.expiresAt!)})</span>
            </span>
          )}
        </div>
        {isOwner && (
          <Button className="w-full" variant={expired || soon ? "primary" : "outline"} onClick={renew} disabled={!!step || !cfg}>
            <RefreshCw className={cn("size-4", step && "animate-spin")} />
            {step ? STEP_LABEL[step] : `Renew ${cfg?.termDays ?? 30} days${price !== undefined ? ` · ${fmtPrice(price)} ${unit}` : ""}`}
          </Button>
        )}
        {!!c.renewals?.length && <div className="text-xs text-muted">Renewed {c.renewals.length}×</div>}
      </div>
    </Card>
  );
}

// Журнал работы живого краулера: последний проход, следующий, ошибка.
function RunCard({ c }: { c: Detail }) {
  const r = c.run!;
  return (
    <Card>
      <CardHeader title="Crawl status" sub={`${r.runs} runs · ${r.failedRuns} failed`} />
      <dl className="space-y-1.5 p-4 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted">Last run</dt>
          <dd className="num">{r.lastRunAt ? timeAgo(r.lastRunAt) : "starting…"}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">Next run</dt>
          <dd className="num">{c.status === "paused" ? "paused" : r.nextRunAt > Date.now() ? timeLeft(r.nextRunAt).replace(" left", "") : "now"}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">Last run found</dt>
          <dd className="num">
            {r.lastItems ?? 0} items · {r.lastSignals ?? 0} signals
          </dd>
        </div>
        {!!r.lastFiltered && (
          <div className="flex justify-between">
            <dt className="text-muted">Blocked as unsafe</dt>
            <dd className="num text-danger">{r.lastFiltered} token{r.lastFiltered > 1 ? "s" : ""}</dd>
          </div>
        )}
        {r.lastError && (
          <div className="mt-2 rounded-md border border-danger/40 bg-danger/5 p-2 text-xs text-danger">
            {r.lastError}
            {(r.failStreak ?? 0) > 1 && <span className="mt-1 block text-muted">Failed {r.failStreak} times in a row, so the next tries are spaced out (up to an hour).</span>}
          </div>
        )}
      </dl>
    </Card>
  );
}

// Спецификация: видна и редактируется только владельцем/арендатором.
function SpecCard({ c, onSaved }: { c: Detail; onSaved: () => void }) {
  const toast = useToast();
  const [spec, setSpec] = useState<CrawlerSpec>(c.spec!);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await patch(`/api/crawlers/${c.id}`, { spec });
      toast("Specification saved: applies from the next run");
      onSaved();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader title="Specification" sub="Private. Changes apply from the next run." />
      <div className="p-4">
        <SpecEditor source={c.source} spec={spec} onChange={setSpec} />
        <Button className="mt-4" variant="outline" onClick={save} disabled={busy}>
          <Save className="size-4" /> Save specification
        </Button>
      </div>
    </Card>
  );
}

function EditTargets({ c, onSaved }: { c: Detail; onSaved: () => void }) {
  const toast = useToast();
  const [text, setText] = useState(c.targets.join(", "));
  const [freq, setFreq] = useState(c.frequencyMin);
  const save = async () => {
    try {
      await patch(`/api/crawlers/${c.id}`, {
        targets: text.split(",").map((s) => s.trim()).filter(Boolean),
        frequencyMin: freq,
      });
      toast("Targets updated");
      onSaved();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  return (
    <div className="flex flex-col gap-3 p-4">
      <div>
        <Label hint="comma separated">Targets</Label>
        <Input value={text} onChange={(e) => setText(e.target.value)} className="num" />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40">
          <Label hint={`min ${TIERS[c.tier].minFrequency}`}>Every N min</Label>
          <Input type="number" min={TIERS[c.tier].minFrequency} max={1440} value={freq} onChange={(e) => setFreq(Number(e.target.value))} />
        </div>
        <Button variant="outline" onClick={save}>
          <Save className="size-4" /> Save
        </Button>
      </div>
    </div>
  );
}

function ListForm({ c }: { c: Detail }) {
  const toast = useToast();
  const [type, setType] = useState<"sale" | "rent">("sale");
  const base = Math.round(TIERS[c.tier].burn * (0.6 + c.reputation / 600));
  const [price, setPrice] = useState(base);
  const [days, setDays] = useState(7);
  const list = async () => {
    try {
      await post("/api/market", { crawlerId: c.id, type, price, rentDays: type === "rent" ? days : undefined });
      toast(type === "sale" ? "Listed for sale" : "Listed for rent");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  return (
    <Card>
      <CardHeader title="List on marketplace" sub="2.5% fee is burned on every trade" />
      <div className="flex flex-col gap-3 p-4">
        <Segmented
          options={["sale", "rent"] as const}
          value={type}
          onChange={(v) => {
            setType(v);
            setPrice(v === "rent" ? Math.round(base / 40) : base);
          }}
          render={(v) => (v === "sale" ? "Sell" : "Rent out")}
        />
        <div>
          <Label hint={type === "rent" ? "per day" : `suggested ${fmt(base)}`}>Price, {CREDITS}</Label>
          <Input type="number" min={1} value={price} onChange={(e) => setPrice(Number(e.target.value))} className="num" />
        </div>
        {type === "rent" && (
          <div>
            <Label>Lease, days</Label>
            <Input type="number" min={1} max={30} value={days} onChange={(e) => setDays(Number(e.target.value))} />
          </div>
        )}
        <Button onClick={list}>
          <Store className="size-4" /> List {type === "rent" ? `for ${fmt(price * days)} total` : `for ${fmt(price)}`}
        </Button>
      </div>
    </Card>
  );
}
