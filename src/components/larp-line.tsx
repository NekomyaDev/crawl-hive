// Карточка «второе мнение» от Larpcheck: их вердикт о проекте за токеном, оценка, вывод и штамп монеты.
// Ссылка на их проверку обязательна по их условиям.
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export interface LarpLineData {
  verdict: string;
  score: number | null;
  headline?: string | null;
  coin?: { word: string; score: number | null; line?: string };
  story?: { word: string; score: number | null; line?: string };
  url: string;
}
// Наш вердикт и главные факторы: из них объясняем, почему два вердикта расходятся.
export interface OurSide {
  verdict: string;
  factors: { label: string; impact: number; note: string }[];
}

const larpBad = (l: LarpLineData) => /SCAM|LARP/.test(l.verdict) || (!!l.coin && /RIG|SKETCH|SCAM|BAD|UNFAIR/.test(l.coin.word));
// Larpcheck считает нечестной саму монету (держатели, дев, ликвидность), а не только историю проекта.
const coinFlag = (l: LarpLineData) => !!l.coin && /RIG|SKETCH|SCAM|BAD|UNFAIR/.test(l.coin.word);
const larpGood = (l: LarpLineData) => /REAL/.test(l.verdict) && !/PARTLY/.test(l.verdict) && (!l.coin || /OK|FAIR|GOOD/.test(l.coin.word));
// Расхождение: мы считаем безопасным, а они видят ларп или нечестную монету, или наоборот.
export function disagreement(ours: OurSide, l: LarpLineData): "we-clean" | "we-risky" | null {
  const safe = ours.verdict === "CLEAN" || ours.verdict === "OK";
  const risky = ours.verdict === "RISKY" || ours.verdict === "DANGER";
  if (safe && larpBad(l)) return "we-clean";
  if (risky && larpGood(l)) return "we-risky";
  return null;
}

function WhyDisagree({ ours, l, kind }: { ours: OurSide; l: LarpLineData; kind: "we-clean" | "we-risky" }) {
  const good = ours.factors.filter((f) => f.impact > 0).slice(0, 3);
  const bad = [...ours.factors].filter((f) => f.impact < 0).sort((a, b) => a.impact - b.impact).slice(0, 3);
  const mine = kind === "we-clean" ? good : bad;
  return (
    <div className="border-t border-line bg-panel/60 px-4 py-3 text-sm">
      <div className="mb-2 text-xs font-bold tracking-wide text-honey uppercase">⚖️ Why they disagree</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="text-xs font-semibold text-muted">CrawlHive checks the chain</div>
          <ul className="mt-1 space-y-0.5">
            {mine.length ? mine.map((f) => <li key={f.label}>{kind === "we-clean" ? "✓" : "✕"} {f.label}: <span className="text-muted">{f.note}</span></li>) : <li className="text-muted">{kind === "we-clean" ? "no red flags in holders, LP, contract or dev" : "red flags on-chain"}</li>}
          </ul>
        </div>
        <div>
          <div className="text-xs font-semibold text-muted">Larpcheck checks the project</div>
          <ul className="mt-1 space-y-0.5">
            {l.story?.line && <li>{l.story.word}: <span className="text-muted">{l.story.line}</span></li>}
            {l.coin?.line && <li>coin {l.coin.word}: <span className="text-muted">{l.coin.line}</span></li>}
            {!l.story?.line && !l.coin?.line && l.headline && <li className="text-muted">{l.headline}</li>}
          </ul>
        </div>
      </div>
      <p className="mt-2.5 rounded-lg bg-honey/10 px-3 py-2 text-xs text-fg/90">
        {kind === "we-risky"
          ? "The project looks real, but the token itself has on-chain risks. A real team can still have a rigged launch: check who holds it before you buy."
          : coinFlag(l)
            ? "Larpcheck sees risk in the coin itself that our scan didn't flag. The two tools read holders differently: compare their numbers with the bubble map and holders here before you buy."
            : "On-chain it looks clean, but the project's claims don't check out. Safe to trade is not the same as a real project: size small and don't hold for the story."}
      </p>
    </div>
  );
}

const colorOf = (v: string) => (/SCAM|LARP/.test(v) ? "var(--danger)" : /REAL/.test(v) && !/PARTLY/.test(v) ? "var(--lime)" : "var(--honey)");
const coinColor = (w: string) => (/RIG|SCAM|BAD/.test(w) ? "var(--danger)" : /OK|FAIR|GOOD/.test(w) ? "var(--lime)" : "var(--honey)");

export function LarpLine({ l, ours, className }: { l: LarpLineData; ours?: OurSide; className?: string }) {
  const why = ours ? disagreement(ours, l) : null;
  const c = colorOf(l.verdict);
  return (
    <div className={cn("overflow-hidden rounded-xl border bg-panel-2/60", className)} style={{ borderColor: `color-mix(in srgb, ${c} 45%, transparent)`, boxShadow: `0 0 30px color-mix(in srgb, ${c} 12%, transparent)` }}>
      <div className="flex items-center justify-between border-b border-line px-4 py-2 text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">
        <span>Second opinion · project check</span>
        <span className="text-fg">Larpcheck</span>
      </div>
      <div className="flex gap-4 p-4">
        <div className="grid size-16 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(${c} ${(l.score ?? 0) * 3.6}deg, rgba(255,255,255,0.07) 0)` }}>
          <div className="grid size-13 place-items-center rounded-full bg-panel">
            <span className="num text-xl font-bold" style={{ color: c }}>
              {l.score ?? "?"}
            </span>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xl font-black tracking-tight" style={{ color: c }}>
              {l.verdict}
            </span>
            {l.coin && (
              <span className="rounded-md border px-1.5 py-0.5 text-[11px] font-bold" style={{ color: coinColor(l.coin.word), borderColor: `color-mix(in srgb, ${coinColor(l.coin.word)} 45%, transparent)` }}>
                coin: {l.coin.word}
                {l.coin.score != null ? ` ${l.coin.score}` : ""}
              </span>
            )}
          </div>
          {l.headline && <p className="mt-1.5 text-sm leading-relaxed text-fg/90">{l.headline}</p>}
          <a href={l.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-panel">
            Full check on Larpcheck <ExternalLink className="size-3.5" />
          </a>
        </div>
      </div>
      {why && ours && <WhyDisagree ours={ours} l={l} kind={why} />}
    </div>
  );
}
