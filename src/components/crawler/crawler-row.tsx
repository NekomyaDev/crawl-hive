import Link from "next/link";
import { RepScore, SourceBadge, StatusBadge, TierBadge } from "@/components/ui/badge";
import type { PublicCrawler } from "@/lib/types";
import { SOURCE_META, fmt } from "@/lib/utils";

// Карточка краулера для списков (My Crawlers, маркет).
export function CrawlerCard({ c, footer }: { c: PublicCrawler; footer?: React.ReactNode }) {
  const precision = c.stats.signals ? Math.round((c.stats.hits / c.stats.signals) * 100) : 0;
  return (
    <div className="flex flex-col rounded-xl border border-line bg-panel p-4 transition-colors hover:border-honey/40">
      <Link href={`/crawler/${c.id}`} className="flex items-start gap-3">
        <span
          className="mt-1 size-3 shrink-0 rounded-full"
          style={{ background: SOURCE_META[c.source].color, boxShadow: `0 0 12px ${SOURCE_META[c.source].color}` }}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{c.name}</div>
          <div className="num text-[11px] text-muted">{c.id}</div>
        </div>
        <RepScore rep={c.reputation} />
      </Link>
      <div className="mt-3 flex flex-wrap gap-1">
        <SourceBadge source={c.source} />
        <TierBadge tier={c.tier} />
        <StatusBadge status={c.status} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div>
          <div className="text-muted">Items</div>
          <div className="num">{fmt(c.stats.items)}</div>
        </div>
        <div>
          <div className="text-muted">Hit rate</div>
          <div className="num">{precision}%</div>
        </div>
        <div>
          <div className="text-muted">Earned</div>
          <div className="num text-honey">{fmt(c.stats.rewards)}</div>
        </div>
      </div>
      {footer && <div className="mt-3 border-t border-line pt-3">{footer}</div>}
    </div>
  );
}
