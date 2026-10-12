"use client";
import Link from "next/link";
import { ExternalLink, Lock, Radio } from "lucide-react";
import { SOURCE_META, cn, timeAgo } from "@/lib/utils";
import { SIGNAL_KIND_LABEL } from "@/lib/spec";
import type { Signal } from "@/lib/types";
import { BotOcto } from "@/components/bot-octo";

// Исход сигнала: ждём проверки цены, попал, не попал, или оценить нельзя (нет токена).
export function OutcomeBadge({ s }: { s: Signal }) {
  const o = s.outcome;
  if (!o) return null;
  const map = {
    pending: { t: "scoring…", c: "text-muted border-line" },
    // Попадание засчитывается по лучшему результату за окно: показываем пик, а не цену в конце.
    hit: { t: `hit ${o.peakPct !== undefined ? `peak +${o.peakPct}%` : o.changePct !== undefined ? `+${o.changePct}%` : ""}`, c: "text-lime border-lime/40" },
    miss: { t: `miss ${o.changePct !== undefined ? `${o.changePct}%` : ""}${o.peakPct !== undefined && o.peakPct > 0 ? ` · peak +${o.peakPct}%` : ""}`, c: "text-danger border-danger/40" },
    unscored: { t: "not scored", c: "text-muted border-line" },
  } as const;
  const m = map[o.status];
  return <span className={cn("num rounded border px-1.5 py-px text-[10px]", m.c)}>{m.t}</span>;
}

// Проверка токена сканером до отправки: краулер прикладывает вердикт к каждому сигналу.
const SAFE_TONE: Record<string, string> = { CLEAN: "text-lime", OK: "text-lime", RISKY: "text-honey", TOO_EARLY: "text-muted" };
function SafetyLine({ s }: { s: Signal }) {
  const f = s.safety!;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
      <span className={cn("num font-semibold", SAFE_TONE[f.verdict] ?? "text-muted")}>
        ✓ checked · {f.verdict.replace("_", " ")}
        {f.score != null ? ` ${f.score}` : ""}
      </span>
      {f.flags.slice(0, 3).map((x) => (
        <span key={x} className="rounded border border-line px-1 text-muted">
          {x}
        </span>
      ))}
      {s.token?.address && (
        <a href={`/scan/${s.token.address}`} className="text-sky hover:underline">
          scan →
        </a>
      )}
    </div>
  );
}

// Вывод встроенного Grok Bot под сигналом.
const TAKE = {
  look: { t: "LOOK", c: "text-lime border-lime/40 bg-lime/[0.06]" },
  watch: { t: "WATCH", c: "text-honey border-honey/40 bg-honey/[0.06]" },
  avoid: { t: "AVOID", c: "text-danger border-danger/40 bg-danger/[0.06]" },
} as const;
function BotTakeLine({ s }: { s: Signal }) {
  const b = s.bot!;
  const m = TAKE[b.take];
  return (
    <div className={cn("mt-1.5 flex items-start gap-2 rounded-lg border px-2 py-1.5 text-[12px]", m.c)}>
      <BotOcto size={18} color="currentColor" className="mt-px shrink-0" />
      <span className="min-w-0">
        <span className="font-semibold">{m.t}</span>
        {b.verdict && (
          <span className="num ml-1.5 text-muted">
            {b.verdict}
            {b.score != null ? ` ${b.score}` : ""}
          </span>
        )}
        <span className="ml-1.5 text-fg/90">{b.note}</span>
        {s.token?.address && (
          <a href={`/scan/${s.token.address}`} className="ml-1.5 text-sky hover:underline">
            scan →
          </a>
        )}
      </span>
    </div>
  );
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
          {s.safety && !s.redacted && !s.bot && <SafetyLine s={s} />}
          {s.bot && !s.redacted && <BotTakeLine s={s} />}
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
