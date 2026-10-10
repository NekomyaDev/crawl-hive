"use client";
// Главная: живая карта роя, метрики сети и поток сигналов.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Flame, Plus } from "lucide-react";
import { SwarmMap } from "@/components/swarm/swarm-map";
import { SignalFeed } from "@/components/signal-feed";
import { Card, CardHeader, Stat } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { useStream } from "@/lib/client/use-stream";
import { fmt, timeLeft } from "@/lib/utils";
import type { NetworkStats, Signal } from "@/lib/types";

export default function Dashboard() {
  const [stats, setStats] = useState<NetworkStats | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [, force] = useState(0);

  // Таймер эпохи тикает каждую секунду.
  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const onSignals = useCallback((s: Signal[]) => setSignals((prev) => (prev.length ? prev : s)), []);

  useStream((e) => {
    if (e.type === "signal") setSignals((prev) => [e.signal, ...prev.filter((x) => x.id !== e.signal.id)].slice(0, 60));
  });

  return (
    <>
      <PageHeader
        title={
          <>
            The <span className="text-honey">Swarm</span>
          </>
        }
        sub="Every dot is a live crawler digging X, Telegram, chains and docs for memecoin signal. Hexagons are the wallets that spawned them."
        action={
          <Link href="/spawn">
            <Button size="lg">
              <Flame className="size-4" /> Spawn a crawler
            </Button>
          </Link>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Active crawlers" value={stats ? `${stats.activeCrawlers}` : "—"} hint={stats ? `of ${stats.totalCrawlers} spawned` : ""} />
        <Stat label="Wallets" value={stats ? stats.wallets : "—"} />
        <Stat label="Items / min" value={stats ? fmt(stats.itemsPerMin) : "—"} />
        <Stat label="Signals 24h" value={stats ? fmt(stats.signals24h) : "—"} />
        <Stat label="Credits burned" value={stats ? fmt(stats.totalBurned) : "—"} accent />
        <Stat
          label="Epoch reward"
          value={stats ? fmt(stats.epochReward) : "—"}
          hint={stats ? timeLeft(stats.epochEndsAt) : ""}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <SwarmMap onStats={setStats} onSignals={onSignals} />
        <Card className="flex max-h-[680px] flex-col">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <span className="size-2 animate-pulse rounded-full bg-lime" /> Live signals
              </span>
            }
            sub="Streamed from crawlers as they fire"
          />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <SignalFeed signals={signals} />
          </div>
        </Card>
      </div>

      <Card className="mt-5 flex flex-wrap items-center justify-between gap-4 px-5 py-4">
        <div>
          <div className="font-semibold">Got an edge nobody is crawling?</div>
          <div className="text-sm text-muted">Spawn a crawler on your own targets. Good signals raise its reputation and its share of each epoch.</div>
        </div>
        <Link href="/spawn">
          <Button variant="outline">
            <Plus className="size-4" /> Spawn a crawler
          </Button>
        </Link>
      </Card>
    </>
  );
}
