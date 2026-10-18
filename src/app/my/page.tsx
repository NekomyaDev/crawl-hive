"use client";
// Мои краулеры: свои и арендованные, сводка по кошельку.
import Link from "next/link";
import { Flame, Pause, Play, Wallet } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, Stat } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CrawlerCard } from "@/components/crawler/crawler-row";
import { GrokBots, GrokDutyToggle, type PublicBot } from "@/components/grok-bots";
import { SOURCE_META } from "@/lib/utils";
import { useWallet } from "@/components/wallet-provider";
import { useToast } from "@/components/ui/toast";
import { useApi } from "@/lib/client/use-api";
import { patch } from "@/lib/client/api";
import { CREDITS } from "@/lib/economy";
import type { PublicCrawler } from "@/lib/types";
import { fmt } from "@/lib/utils";

export default function MyCrawlers() {
  const { address, info, connect, signedIn } = useWallet();
  const toast = useToast();
  const { data, reload } = useApi<PublicCrawler[]>(address && signedIn ? `/api/crawlers?mine=1&w=${address}` : null, 5000);
  const { data: bots, reload: reloadBots } = useApi<PublicBot[]>(address && signedIn ? `/api/bots?w=${address}` : null, 15000);
  const { data: onDuty, reload: reloadDuty } = useApi<Record<string, { runs: number }>>(address && signedIn ? `/api/bots/duty?w=${address}` : null, 30000);

  if (!address)
    return (
      <>
        <PageHeader title="My Crawlers" />
        <Card className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <Wallet className="size-8 text-honey" />
          <div className="font-semibold">Connect a wallet to see your crawlers</div>
          <p className="max-w-sm text-sm text-muted">No Phantom? You get a demo wallet with 250k {CREDITS} to play with.</p>
          <Button onClick={() => connect()}>Connect</Button>
        </Card>
      </>
    );

  const owned = (data ?? []).filter((c) => c.owner === address);
  const rented = (data ?? []).filter((c) => c.renter === address);
  // Над какими краулерами стоят Grok Bots: карточка рисует спрута вместо точки.
  const duty = new Map<string, { count: number; live: boolean }>();
  for (const id of Object.keys(onDuty ?? {})) duty.set(id, { count: 1, live: true });
  for (const b of bots ?? [])
    for (const id of b.crawlerIds) {
      const cur = duty.get(id) ?? { count: 0, live: false };
      duty.set(id, { count: cur.count + 1, live: cur.live || b.live });
    }
  const earned = owned.reduce((s, c) => s + (c.renter ? 0 : c.stats.rewards), 0) + rented.reduce((s, c) => s + c.stats.rewards, 0);

  const toggle = async (c: PublicCrawler) => {
    try {
      await patch(`/api/crawlers/${c.id}`, { status: c.status === "paused" ? "active" : "paused" });
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <>
      <PageHeader
        title="My Crawlers"
        sub="Your part of the swarm. Pausing saves nothing and costs uptime, so only do it when targets dry up."
        action={
          <Link href="/spawn">
            <Button>
              <Flame className="size-4" /> Spawn another
            </Button>
          </Link>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Balance" value={info ? fmt(info.balance) : "-"} hint={CREDITS} accent />
        <Stat label="Crawlers" value={owned.length} hint={rented.length ? `+${rented.length} rented` : undefined} />
        <Stat label="Avg reputation" value={info?.reputation ?? "-"} />
        <Stat label="Burned by you" value={info ? fmt(info.burned) : "-"} hint={`all-time earned ${fmt(earned)}`} />
      </div>

      {data && !owned.length && !rented.length && (
        <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <div className="font-semibold">No crawlers yet</div>
          <p className="max-w-sm text-sm text-muted">Spawn one on targets you know better than the swarm does, or rent a proven crawler on the marketplace.</p>
          <div className="flex gap-2">
            <Link href="/spawn">
              <Button>Spawn</Button>
            </Link>
            <Link href="/market">
              <Button variant="outline">Browse market</Button>
            </Link>
          </div>
        </Card>
      )}

      {owned.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {owned.map((c) => (
            <CrawlerCard
              key={c.id}
              c={c}
              bots={duty.get(c.id)}
              footer={
                c.status === "rented" ? (
                  <span className="text-xs text-violet">Rented out: rewards go to the renter until the lease ends</span>
                ) : (
                  <div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => toggle(c)}>
                      {c.status === "paused" ? <Play className="size-3" /> : <Pause className="size-3" />}
                      {c.status === "paused" ? "Resume" : "Pause"}
                    </Button>
                    <Link href={`/crawler/${c.id}`}>
                      <Button size="sm" variant="ghost">
                        Manage
                      </Button>
                    </Link>
                  </div>
                  {c.live && <GrokDutyToggle crawlerId={c.id} on={!!onDuty?.[c.id]} color={SOURCE_META[c.source].color} onChange={reloadDuty} />}
                  </div>
                )
              }
            />
          ))}
        </div>
      )}

      {rented.length > 0 && (
        <>
          <h2 className="mb-3 mt-8 text-lg font-semibold">Rented by you</h2>
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {rented.map((c) => (
              <CrawlerCard key={c.id} c={c} bots={duty.get(c.id)} />
            ))}
          </div>
        </>
      )}

      {data && signedIn && <GrokBots crawlers={[...owned.filter((c) => c.live), ...rented]} bots={bots ?? []} reload={reloadBots} />}
    </>
  );
}
