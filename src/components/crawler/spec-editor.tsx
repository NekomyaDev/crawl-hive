"use client";
// Редактор спецификации краулера: индивидуальные инструкции, ключевые слова, типы сигналов,
// фильтры on-chain и правило оценки. Используется при спавне и на странице краулера.
import { Chips, Input, Label, Textarea } from "@/components/ui/field";
import { KINDS_BY_SOURCE, SIGNAL_KIND_LABEL, SPEC_LIMITS } from "@/lib/spec";
import type { CrawlerSpec, Source } from "@/lib/types";
import { cn } from "@/lib/utils";

const PLACEHOLDER: Record<Source, string> = {
  x: "e.g. Only AI-agent tokens on Solana under $3M FDV. Prioritise first calls by small accounts that later get quoted by big ones. Ignore giveaways and paid promos.",
  telegram: "e.g. Flag a token only when it's called with a contract address. Skip anything that is a re-post of an old call.",
  onchain: "e.g. Prefer tokens with a real website and socials in the description, dev holding < 5%, steady volume rather than one spike.",
  docs: "e.g. Tell me when a mainnet launch date, token, airdrop or partnership is announced. Ignore typo fixes and style changes.",
};

const list = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);

export function SpecEditor({
  source,
  spec,
  onChange,
  compact = false,
}: {
  source: Source;
  spec: CrawlerSpec;
  onChange: (s: CrawlerSpec) => void;
  compact?: boolean;
}) {
  const set = (patch: Partial<CrawlerSpec>) => onChange({ ...spec, ...patch });
  return (
    <div className={cn("grid gap-5", !compact && "md:grid-cols-2")}>
      <div className={cn(!compact && "md:col-span-2")}>
        <Label hint={`${spec.instructions.length}/${SPEC_LIMITS.instructions}`}>Instructions for your crawler</Label>
        <Textarea
          rows={compact ? 3 : 4}
          maxLength={SPEC_LIMITS.instructions}
          value={spec.instructions}
          onChange={(e) => set({ instructions: e.target.value })}
          placeholder={PLACEHOLDER[source]}
        />
        <p className="mt-1 text-[11px] text-muted">
          Plain language. The AI reads every new post or page through these rules and only sends you what fits. Private: nobody else sees them.
        </p>
      </div>
      <div>
        <Label hint="comma separated">Keywords</Label>
        <Input
          defaultValue={spec.keywords.join(", ")}
          onBlur={(e) => set({ keywords: list(e.target.value) })}
          placeholder="ai agent, launch, airdrop"
        />
      </div>
      <div>
        <Label hint="comma separated">Exclude</Label>
        <Input
          defaultValue={spec.excludeKeywords.join(", ")}
          onBlur={(e) => set({ excludeKeywords: list(e.target.value) })}
          placeholder="giveaway, presale"
        />
      </div>
      <div className={cn(!compact && "md:col-span-2")}>
        <Label>Signal types</Label>
        <Chips
          options={KINDS_BY_SOURCE[source]}
          value={spec.signalKinds}
          onChange={(v) => v.length && set({ signalKinds: v })}
          render={(k) => SIGNAL_KIND_LABEL[k]}
        />
      </div>
      <div>
        <Label hint={`${Math.round(spec.minConfidence * 100)}%`}>Minimum confidence</Label>
        <input
          type="range"
          min={0}
          max={95}
          step={5}
          value={Math.round(spec.minConfidence * 100)}
          onChange={(e) => set({ minConfidence: Number(e.target.value) / 100 })}
          className="w-full accent-[var(--honey)]"
        />
      </div>
      <div>
        <Label hint="how a signal is scored">A hit is</Label>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted">+</span>
          <Input
            type="number"
            className="w-20"
            min={SPEC_LIMITS.hitThresholdPct[0]}
            max={SPEC_LIMITS.hitThresholdPct[1]}
            value={spec.outcome.hitThresholdPct}
            onChange={(e) => set({ outcome: { ...spec.outcome, hitThresholdPct: Number(e.target.value) } })}
          />
          <span className="text-muted">% within</span>
          <Input
            type="number"
            className="w-20"
            min={SPEC_LIMITS.horizonMin[0]}
            max={SPEC_LIMITS.horizonMin[1]}
            value={spec.outcome.horizonMin}
            onChange={(e) => set({ outcome: { ...spec.outcome, horizonMin: Number(e.target.value) } })}
          />
          <span className="text-muted">min</span>
        </div>
      </div>

      {source === "onchain" && (
        <div className={cn("grid gap-4 rounded-lg border border-line p-3", !compact && "md:col-span-2 md:grid-cols-2")}>
          <div className={cn(!compact && "md:col-span-2")}>
            <Label hint="DexScreener">Feeds</Label>
            <Chips
              options={["profiles", "boosts", "search"] as const}
              value={spec.onchain.feeds}
              onChange={(v) => v.length && set({ onchain: { ...spec.onchain, feeds: v } })}
              render={(f) => ({ profiles: "New token profiles", boosts: "Boosted tokens", search: "Search by keywords" })[f]}
            />
          </div>
          {(
            [
              ["minLiquidityUsd", "Min liquidity, $"],
              ["minVolume1hUsd", "Min volume 1h, $"],
              ["maxFdvUsd", "Max FDV, $ (0 = any)"],
              ["maxAgeHours", "Max pair age, h (0 = any)"],
            ] as const
          ).map(([k, label]) => (
            <div key={k}>
              <Label>{label}</Label>
              <Input
                type="number"
                min={0}
                value={spec.onchain[k]}
                onChange={(e) => set({ onchain: { ...spec.onchain, [k]: Number(e.target.value) } })}
              />
            </div>
          ))}
        </div>
      )}

      {source === "x" && (
        <label className={cn("flex items-center gap-2 text-sm", !compact && "md:col-span-2")}>
          <input
            type="checkbox"
            checked={spec.x.imageUnderstanding}
            onChange={(e) => set({ x: { imageUnderstanding: e.target.checked } })}
            className="accent-[var(--honey)]"
          />
          Read images in posts (charts, screenshots). Costs more per run.
        </label>
      )}
    </div>
  );
}
