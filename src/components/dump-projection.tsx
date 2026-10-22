// «Probable dump» на странице скана: насколько упала бы цена, если бы подозрительные кошельки продали всё сейчас,
// с раскладкой, кто сколько держит. Оценка по модели пула x*y=k, не прогноз; на балл и вердикт не влияет.
// Показываем только при заметной доле (meaningful: от 5% эмиссии).

export interface DumpData {
  pct: number;
  suspiciousPct: number;
  basis: "pool" | "curve";
  venue?: string;
  liquidityUsd?: number;
  sellUsd?: number;
  breakdown: { label: string; wallets: number; pct: number }[];
  meaningful: boolean;
}

const usd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${Math.round(n)}`);
const pc = (n: number) => `${n.toFixed(n < 10 ? 1 : 0)}%`;

export function DumpProjection({ d, className }: { d?: DumpData; className?: string }) {
  if (!d?.meaningful) return null;
  const tone = d.pct >= 50 ? "text-danger" : d.pct >= 20 ? "text-honey" : "text-fg";
  return (
    <div className={`rounded-lg border border-danger/30 bg-danger/5 p-3 text-xs ${className ?? ""}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">Probable dump</span>
        <span className="text-[10px] text-muted">estimate, not a prediction</span>
      </div>
      <p className="mt-1 text-sm">
        If the suspicious wallets sold now: price about <span className={`num font-bold ${tone}`}>-{d.pct}%</span>
      </p>
      <ul className="mt-2 space-y-1">
        {d.breakdown.map((b) => (
          <li key={b.label} className="flex items-baseline justify-between gap-2">
            <span className="text-muted">
              {b.label} <span className="num">· {b.wallets} wallet{b.wallets > 1 ? "s" : ""}</span>
            </span>
            <span className="num font-semibold">{pc(b.pct)}</span>
          </li>
        ))}
        <li className="flex items-baseline justify-between gap-2 border-t border-line pt-1">
          <span>Together (each wallet counted once)</span>
          <span className="num font-semibold">{pc(d.suspiciousPct)} of supply</span>
        </li>
      </ul>
      <p className="mt-2 text-[10px] leading-relaxed text-muted">
        {d.sellUsd ? `About ${usd(d.sellUsd)} at the current price, sold` : "Sold"} in one go{" "}
        {d.basis === "curve"
          ? `into the ${d.venue ?? "pump.fun"} bonding curve, using its reserves (the curve prices like a constant-product pool)`
          : `into the main ${d.venue ? `${d.venue} ` : ""}pool${d.liquidityUsd ? ` (${usd(d.liquidityUsd)} on the quote side)` : ""}`}
        . Constant-product approximation: other pools, fees and buyers stepping in are ignored. Does not change the score.
      </p>
    </div>
  );
}
