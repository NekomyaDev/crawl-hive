"use client";
// Маркетплейс: продажа и аренда краулеров. Комиссия 2.5% сжигается.
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/field";
import { CrawlerCard } from "@/components/crawler/crawler-row";
import { useWallet } from "@/components/wallet-provider";
import { useToast } from "@/components/ui/toast";
import { useApi } from "@/lib/client/use-api";
import { del, post } from "@/lib/client/api";
import { MARKET_FEE_BURN, CREDITS } from "@/lib/economy";
import type { Listing, PublicCrawler } from "@/lib/types";
import { fmt, short, timeAgo } from "@/lib/utils";

type Row = Listing & { crawler: PublicCrawler };
type Sort = "newest" | "cheapest" | "reputation";

export default function Market() {
  const { address, connect, refresh } = useWallet();
  const toast = useToast();
  const { data, reload } = useApi<Row[]>("/api/market", 6000);
  const [type, setType] = useState<"all" | "sale" | "rent">("all");
  const [sort, setSort] = useState<Sort>("newest");
  const [busy, setBusy] = useState<string | null>(null);

  const rows = useMemo(() => {
    const r = (data ?? []).filter((l) => type === "all" || l.type === type);
    if (sort === "cheapest") r.sort((a, b) => total(a) - total(b));
    if (sort === "reputation") r.sort((a, b) => b.crawler.reputation - a.crawler.reputation);
    return r;
  }, [data, type, sort]);

  const buy = async (l: Row) => {
    if (!address) return connect();
    setBusy(l.id);
    try {
      const r = await post<{ paid: number; burnedFee: number }>(`/api/market/${l.id}`);
      toast(`${l.type === "sale" ? "Bought" : "Rented"} ${l.crawler.name} for ${fmt(r.paid)} ${CREDITS}. ${fmt(r.burnedFee)} burned as fee.`);
      reload();
      refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  const cancel = async (l: Row) => {
    try {
      await del(`/api/market/${l.id}`);
      toast("Listing removed");
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <>
      <PageHeader
        title="Crawl Marketplace"
        sub={`Buy a proven crawler outright or rent one for a few days: the renter earns its rewards for the lease. ${MARKET_FEE_BURN * 100}% of every trade is burned.`}
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          options={["all", "sale", "rent"] as const}
          value={type}
          onChange={setType}
          render={(v) => ({ all: "All", sale: "For sale", rent: "For rent" })[v]}
        />
        <Segmented
          options={["newest", "cheapest", "reputation"] as const}
          value={sort}
          onChange={setSort}
          render={(v) => ({ newest: "Newest", cheapest: "Cheapest", reputation: "Top rep" })[v]}
        />
      </div>

      {data && !rows.length && <Card className="px-6 py-14 text-center text-sm text-muted">Nothing listed here right now.</Card>}

      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {rows.map((l) => {
          const mine = address && l.seller === address;
          return (
            <CrawlerCard
              key={l.id}
              c={l.crawler}
              footer={
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="num text-lg font-semibold text-honey">
                      {fmt(l.price)} <span className="text-xs">{CREDITS}</span>
                      {l.type === "rent" && <span className="text-xs text-muted"> /day</span>}
                    </div>
                    <div className="text-[11px] text-muted">
                      {l.type === "rent" ? `${l.rentDays}d lease · ${fmt(total(l))} total` : "full ownership"} · {short(l.seller)} · {timeAgo(l.createdAt)}
                    </div>
                  </div>
                  {mine ? (
                    <Button size="sm" variant="danger" onClick={() => cancel(l)}>
                      Delist
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => buy(l)} disabled={busy === l.id}>
                      {l.type === "rent" ? "Rent" : "Buy"}
                    </Button>
                  )}
                </div>
              }
            />
          );
        })}
      </div>
    </>
  );
}

function total(l: Listing) {
  return l.type === "rent" ? l.price * (l.rentDays ?? 1) : l.price;
}
