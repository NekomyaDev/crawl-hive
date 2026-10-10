import { cn, SOURCE_META, NARRATIVE_LABEL } from "@/lib/utils";
import { repGrade } from "@/lib/reputation";
import { TIERS } from "@/lib/economy";
import type { CrawlerStatus, Source, Tier } from "@/lib/types";
import type { HTMLAttributes } from "react";

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[11px] text-muted", className)}
      {...props}
    />
  );
}

export function SourceBadge({ source }: { source: Source }) {
  const m = SOURCE_META[source];
  return (
    <Badge>
      <span className="size-1.5 rounded-full" style={{ background: m.color }} />
      {m.label}
    </Badge>
  );
}

export function NarrativeBadge({ n }: { n: string }) {
  return <Badge className="text-fg/80">#{NARRATIVE_LABEL[n] ?? n}</Badge>;
}

const TIER_COLOR: Record<Tier, string> = {
  larva: "text-muted",
  worker: "text-sky",
  soldier: "text-lime",
  queen: "text-honey border-honey/40",
};

export function TierBadge({ tier }: { tier: Tier }) {
  return <Badge className={TIER_COLOR[tier]}>{TIERS[tier].label}</Badge>;
}

export function StatusBadge({ status }: { status: CrawlerStatus }) {
  const map = {
    active: "text-lime border-lime/30",
    paused: "text-muted",
    rented: "text-violet border-violet/30",
  } as const;
  return (
    <Badge className={map[status]}>
      {status === "active" && <span className="size-1.5 animate-pulse rounded-full bg-lime" />}
      {status}
    </Badge>
  );
}

export function RepScore({ rep, className }: { rep: number; className?: string }) {
  const g = repGrade(rep);
  return (
    <span className={cn("num inline-flex items-baseline gap-1.5", className)}>
      <span className={cn("font-bold", g.color)}>{g.grade}</span>
      <span>{rep}</span>
    </span>
  );
}
