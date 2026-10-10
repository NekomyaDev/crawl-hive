"use client";
// Лидерборд краулеров и кошельков. Обновляется каждые 5 секунд.
import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Segmented } from "@/components/ui/field";
import { RepScore, SourceBadge, TierBadge } from "@/components/ui/badge";
import { useWallet } from "@/components/wallet-provider";
import { useApi } from "@/lib/client/use-api";
import type { PublicCrawler, WalletInfo } from "@/lib/types";
import { cn, fmt, short } from "@/lib/utils";

const SORTS = ["reputation", "rewards", "items", "precision", "uptime"] as const;
type Sort = (typeof SORTS)[number];
const SORT_LABEL: Record<Sort, string> = {
  reputation: "Reputation",
  rewards: "Rewards",
  items: "Data volume",
  precision: "Signal quality",
  uptime: "Uptime",
};

export default function Leaderboard() {
  const [sort, setSort] = useState<Sort>("reputation");
  const { address } = useWallet();
  const { data } = useApi<{ crawlers: PublicCrawler[]; wallets: WalletInfo[] }>(`/api/leaderboard?sort=${sort}`, 5000);

  return (
    <>
      <PageHeader title="Leaderboard" sub="The best crawlers in the swarm. Rank follows the sort you pick; reputation is what drives rewards." />
      <div className="mb-4">
        <Segmented options={SORTS} value={sort} onChange={setSort} render={(s) => SORT_LABEL[s]} />
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">
                <th className="w-12 px-4 py-2.5">#</th>
                <th className="px-2 py-2.5">Crawler</th>
                <th className="px-2 py-2.5">Rep</th>
                <th className="px-2 py-2.5 text-right">Items</th>
                <th className="px-2 py-2.5 text-right">Hit rate</th>
                <th className="px-2 py-2.5 text-right">Uptime</th>
                <th className="px-4 py-2.5 text-right">Earned</th>
              </tr>
            </thead>
            <tbody>
              {(data?.crawlers ?? []).map((c, i) => {
                const mine = address && (c.owner === address || c.renter === address);
                return (
                  <tr key={c.id} className={cn("border-b border-line/60 hover:bg-panel-2", mine && "bg-honey/5")}>
                    <td className={cn("num px-4 py-2.5", i < 3 ? "font-bold text-honey" : "text-muted")}>{i + 1}</td>
                    <td className="px-2 py-2.5">
                      <Link href={`/crawler/${c.id}`} className="font-medium hover:text-honey">
                        {c.name}
                      </Link>
                      <div className="mt-0.5 flex items-center gap-1">
                        <span className="num text-[11px] text-muted">{c.id}</span>
                        <SourceBadge source={c.source} />
                        <TierBadge tier={c.tier} />
                      </div>
                    </td>
                    <td className="px-2 py-2.5">
                      <RepScore rep={c.reputation} />
                    </td>
                    <td className="num px-2 py-2.5 text-right">{fmt(c.stats.items)}</td>
                    <td className="num px-2 py-2.5 text-right">
                      {(c.stats.scored ?? c.stats.signals) ? ((c.stats.hits / (c.stats.scored ?? c.stats.signals)) * 100).toFixed(0) : 0}%
                    </td>
                    <td className="num px-2 py-2.5 text-right">
                      {((c.stats.uptimeSec / Math.max(1, c.stats.totalSec)) * 100).toFixed(1)}%
                    </td>
                    <td className="num px-4 py-2.5 text-right text-honey">{fmt(c.stats.rewards)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        <Card className="self-start">
          <CardHeader title="Top wallets" sub="Avg crawler reputation × fleet size" />
          <ol className="divide-y divide-line">
            {(data?.wallets ?? []).map((w, i) => (
              <li key={w.address} className={cn("flex items-center gap-3 px-4 py-2.5", w.address === address && "bg-honey/5")}>
                <span className={cn("num w-5 text-sm", i < 3 ? "font-bold text-honey" : "text-muted")}>{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="num text-sm">{short(w.address)}</div>
                  <div className="text-[11px] text-muted">
                    {w.crawlers} crawlers · {fmt(w.burned)} burned
                  </div>
                </div>
                <RepScore rep={w.reputation} />
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}
