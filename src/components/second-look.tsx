// Строка «Second look (beta)» под вердиктом: теневая оценка v2. Только показывает, вердикт остаётся прежним.
import { VERDICT_COLOR } from "@/lib/scan-share";
import { secondLookWhy, type SecondLookData } from "@/lib/second-look";
import { cn } from "@/lib/utils";

export function SecondLook({ v, className }: { v?: SecondLookData; className?: string }) {
  if (!v) return null;
  const why = secondLookWhy(v);
  const color = VERDICT_COLOR[v.verdictV2];
  return (
    <div
      className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-xs", className)}
      title="A stricter score we are testing against Track Record. The verdict above is still the official one."
    >
      <span className="rounded-md border border-honey/40 px-1.5 py-0.5 text-[10px] font-semibold text-honey uppercase">Second look · beta</span>
      <span className="num rounded-md border px-1.5 py-0.5 font-semibold" style={{ color, borderColor: `${color}66` }}>
        {v.verdictV2} {v.scoreV2}
      </span>
      {why && <span className="min-w-0 text-muted">{why}</span>}
    </div>
  );
}
