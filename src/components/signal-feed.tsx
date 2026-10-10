"use client";
import Link from "next/link";
import { Radio } from "lucide-react";
import { SOURCE_META, timeAgo } from "@/lib/utils";
import type { Signal } from "@/lib/types";

const KIND_LABEL: Record<Signal["kind"], string> = {
  mention_spike: "Mention spike",
  new_pair: "New pair",
  whale_buy: "Whale buy",
  kol_call: "KOL call",
  doc_update: "Docs",
};

export function SignalFeed({ signals, max = 30 }: { signals: Signal[]; max?: number }) {
  if (!signals.length)
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted">
        <Radio className="size-5 animate-pulse text-honey" />
        Listening to the swarm…
      </div>
    );
  return (
    <ul className="divide-y divide-line">
      {signals.slice(0, max).map((s) => (
        <li key={s.id} className="flash-in px-4 py-2.5">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="flex items-center gap-1.5" style={{ color: SOURCE_META[s.source].color }}>
              <span className="size-1.5 rounded-full" style={{ background: SOURCE_META[s.source].color }} />
              {KIND_LABEL[s.kind]}
            </span>
            <span className="num text-muted">{timeAgo(s.ts)}</span>
          </div>
          <p className="mt-1 text-[13px] leading-snug">{s.text}</p>
          <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
            <Link href={`/crawler/${s.crawlerId}`} className="hover:text-honey">
              {s.crawlerName}
            </Link>
            <span className="num">conf {(s.confidence * 100).toFixed(0)}%</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
