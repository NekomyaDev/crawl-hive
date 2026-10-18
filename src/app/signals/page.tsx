"use client";
// Личная лента: сигналы, которые прислали твои краулеры (и арендованные). Видишь только ты.
import Link from "next/link";
import { useMemo, useState } from "react";
import { Lock, Wallet } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, Stat } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/field";
import { SignalFeed } from "@/components/signal-feed";
import { TelegramCard } from "@/components/telegram-card";
import { useWallet } from "@/components/wallet-provider";
import { useApi } from "@/lib/client/use-api";
import type { PublicCrawler, Signal } from "@/lib/types";

type Filter = "all" | "pending" | "hit" | "miss";

export default function MySignals() {
  const { address, signedIn, connect, signIn } = useWallet();
  const ready = !!address && signedIn;
  const { data: signals } = useApi<Signal[]>(ready ? `/api/signals?w=${address}` : null, 5000);
  const { data: crawlers } = useApi<PublicCrawler[]>(ready ? `/api/crawlers?mine=1&w=${address}` : null, 15000);
  const [filter, setFilter] = useState<Filter>("all");
  const [crawler, setCrawler] = useState("all");

  const shown = useMemo(
    () =>
      (signals ?? [])
        .filter((s) => filter === "all" || s.outcome?.status === filter)
        .filter((s) => crawler === "all" || s.crawlerId === crawler),
    [signals, filter, crawler],
  );
  const scored = (signals ?? []).filter((s) => s.outcome?.status === "hit" || s.outcome?.status === "miss");
  const hits = scored.filter((s) => s.outcome?.status === "hit").length;

  if (!ready)
    return (
      <>
        <PageHeader title="My Signals" />
        <Card className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <Lock className="size-8 text-honey" />
          <div className="font-semibold">Your signals are private</div>
          <p className="max-w-sm text-sm text-muted">Connect and sign in with your wallet to read what your crawlers found. Signing is free and sends no transaction.</p>
          <Button onClick={() => (address ? signIn() : connect())}>
            <Wallet className="size-4" /> {address ? "Sign in" : "Connect wallet"}
          </Button>
        </Card>
      </>
    );

  const live = (crawlers ?? []).filter((c) => c.live);
  return (
    <>
      <PageHeader
        title="My Signals"
        sub="Everything your crawlers found, filtered through your specifications. Each signal with a token is scored against the price after your horizon."
      />
      <TelegramCard />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Signals" value={signals?.length ?? "-"} />
        <Stat label="Scored" value={scored.length} />
        <Stat label="Hit rate" value={scored.length ? `${Math.round((hits / scored.length) * 100)}%` : "-"} accent />
        <Stat label="Live crawlers" value={live.length} />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented options={["all", "pending", "hit", "miss"] as const} value={filter} onChange={setFilter} />
        {live.length > 1 && (
          <Segmented
            options={["all", ...live.map((c) => c.id)]}
            value={crawler}
            onChange={setCrawler}
            render={(id) => (id === "all" ? "All crawlers" : live.find((c) => c.id === id)?.name ?? id)}
          />
        )}
      </div>
      {signals && !signals.length ? (
        <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center text-sm text-muted">
          {live.length ? "No signals yet. Your crawlers report here as soon as something passes their specification." : "You have no live crawlers yet."}
          {!live.length && (
            <Link href="/spawn">
              <Button>Spawn a crawler</Button>
            </Link>
          )}
        </Card>
      ) : (
        <Card>
          <SignalFeed signals={shown} max={200} />
        </Card>
      )}
    </>
  );
}
