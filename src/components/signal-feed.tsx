"use client";
import Link from "next/link";
import { ExternalLink, Lock, Radio } from "lucide-react";
import { SOURCE_META, cn, timeAgo } from "@/lib/utils";
import { SIGNAL_KIND_LABEL } from "@/lib/spec";
import type { Signal } from "@/lib/types";

// Исход сигнала: ждём проверки цены, попал, не попал, или оценить нельзя (нет токена).
export function OutcomeBadge({ s }: { s: Signal }) {
  const o = s.outcome;
  if (!o) return null;
  const map = {
    pending: { t: "scoring…", c: "text-muted border-line" },
    hit: { t: `hit ${o.changePct !== undefined ? `+${o.changePct}%` : ""}`, c: "text-lime border-lime/40" },
    miss: { t: `miss ${o.changePct !== undefined ? `${o.changePct}%` : ""}`, c: "text-danger border-danger/40" },
    unscored: { t: "not scored", c: "text-muted border-line" },
  } as const;
  const m = map[o.status];
  return <span className={cn("num rounded border px-1.5 py-px text-[10px]", m.c)}>{m.t}</span>;
}

function hostOf(u: string) {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
}

export function SignalFeed({ signals, max = 30, showCrawler = true }: { signals: Signal[]; max?: number; showCrawler?: boolean }) {
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
              {SIGNAL_KIND_LABEL[s.kind]}
              {s.live && !s.redacted && <span className="rounded bg-honey/15 px-1 text-honey">live</span>}
            </span>
            <span className="flex items-center gap-2">
              {s.live && <OutcomeBadge s={s} />}
              <span className="num text-muted">{timeAgo(s.ts)}</span>
            </span>
          </div>
          <p className={cn("mt-1 text-[13px] leading-snug", s.redacted && "flex items-center gap-1.5 text-muted")}>
            {s.redacted && <Lock className="size-3" />}
            {s.live && s.ticker && !s.redacted && <span className="num mr-1 text-honey">${s.ticker}</span>}
            {s.text}
          </p>
          {!!s.urls?.length && (
            <div className="mt-1 flex flex-wrap gap-2">
              {s.urls.map((u) => (
                <a key={u} href={u} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[11px] text-sky hover:underline">
                  <ExternalLink className="size-3" /> {hostOf(u)}
                </a>
              ))}
            </div>
          )}
          <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
            {showCrawler ? (
              <Link href={`/crawler/${s.crawlerId}`} className="hover:text-honey">
                {s.crawlerName}
              </Link>
            ) : (
              <span />
            )}
            <span className="num">conf {(s.confidence * 100).toFixed(0)}%</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
