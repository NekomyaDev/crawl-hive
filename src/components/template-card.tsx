"use client";
// Карточка готового краулера: что он делает, цена тира, сколько таких уже работает, покупка в один клик.
// Покупка — обычный on-chain спавн с настройками шаблона; «Customize» открывает Spawn с ними же.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, SlidersHorizontal, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SourceBadge, TierBadge } from "@/components/ui/badge";
import { useWallet } from "@/components/wallet-provider";
import { useToast } from "@/components/ui/toast";
import { post } from "@/lib/client/api";
import { spawnWithBurn, type BurnStep } from "@/lib/client/burn";
import { usePay } from "@/lib/client/use-pay";
import { useConfig } from "@/lib/client/use-config";
import { CREDITS, TIERS } from "@/lib/economy";
import type { CrawlerTemplate } from "@/lib/templates";
import type { PublicCrawler } from "@/lib/types";
import { fmt } from "@/lib/utils";


export function TemplateCard({ t, running = 0, compact = false }: { t: CrawlerTemplate; running?: number; compact?: boolean }) {
  const { cfg, unit, simulated, price: priceOf, fmtPrice, signLabel } = usePay();
  const STEP: Record<BurnStep, string> = { prepare: "Preparing…", sign: signLabel, confirm: "Checking payment…" };
  const router = useRouter();
  const toast = useToast();
  const { address, signedIn, connect, signIn } = useWallet();
  const [step, setStep] = useState<BurnStep | "busy" | null>(null);
  const price = priceOf(t.tier);

  const buy = async () => {
    if (!address) return connect();
    if (!signedIn) return signIn();
    const payload = {
      name: t.name.slice(0, 24),
      source: t.source,
      chain: t.chain,
      narratives: t.narratives,
      targets: t.targets,
      frequencyMin: t.frequencyMin,
      tier: t.tier,
      spec: t.spec,
      template: t.id,
    };
    try {
      setStep("busy");
      const c =
        simulated ? await post<PublicCrawler>("/api/crawlers", payload) : await spawnWithBurn(payload, setStep);
      toast(`${t.name} is yours and starts crawling now`);
      router.push(`/crawler/${c.id}`);
    } catch (e) {
      toast((e as Error).message, "error");
      setStep(null);
    }
  };

  return (
    <div className="group flex flex-col overflow-hidden rounded-xl border border-line bg-panel transition hover:-translate-y-0.5 hover:border-white/20 hover:shadow-[0_8px_30px_-12px_rgba(255,176,32,0.35)]">
      <div className="relative h-20 overflow-hidden" style={{ background: t.gradient }}>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(0,0,0,0.18)_1px,transparent_0)] bg-[size:12px_12px]" />
        <span className="float-y absolute right-4 bottom-2 text-4xl drop-shadow-lg">{t.emoji}</span>
        <div className="absolute bottom-2 left-3 flex gap-1">
          <span className="rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur">
            {running ? `${running} running` : "be the first"}
          </span>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-1">
            <SourceBadge source={t.source} />
            <TierBadge tier={t.tier} />
          </div>
          <h3 className="font-semibold">{t.name}</h3>
          <p className="text-sm text-muted">{t.tagline}</p>
        </div>
        {!compact && (
          <>
            <p className="text-xs text-muted">{t.description}</p>
            <ul className="space-y-1 text-xs">
              {t.perks.map((p) => (
                <li key={p} className="flex gap-1.5">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-lime" /> {p}
                </li>
              ))}
              <li className="flex gap-1.5 text-muted">
                <Check className="mt-0.5 size-3.5 shrink-0 text-lime" /> {cfg?.termDays ?? 30} days of crawling · up to {TIERS[t.tier].maxTargets} targets
              </li>
            </ul>
          </>
        )}
        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <div className="num text-lg font-semibold text-honey">
            {fmtPrice(price)} <span className="text-xs">{unit}</span>
          </div>
          <div className="flex gap-1.5">
            {!compact && (
              <Link href={`/spawn?template=${t.id}`} title="Open in Spawn and change anything first">
                <Button size="sm" variant="ghost">
                  <SlidersHorizontal className="size-4" />
                </Button>
              </Link>
            )}
            <Button size="sm" onClick={buy} disabled={!!step || !cfg}>
              <ShoppingCart className="size-4" /> {step ? (step === "busy" ? "…" : STEP[step]) : !address ? "Connect" : "Buy"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
