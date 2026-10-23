"use client";
// Замок на полном разборе скана для тех, у кого тариф ниже DEEP_SCAN_TIER. Вместо данных размытая заглушка
// (настоящих чисел в ней нет), сверху: какой тариф нужен, сколько держать по текущей цене, кнопки на /pricing и вход.
import Link from "next/link";
import { Lock, Wallet } from "lucide-react";
import { useWallet } from "@/components/wallet-provider";
import { useViewerTier } from "@/lib/client/use-tier";
import { DEEP_SCAN_TIER, TIER_NAME } from "@/lib/tier-gate";
import { TOKEN } from "@/lib/token";
import { cn, fmt } from "@/lib/utils";
import { useT } from "@/components/lang-provider";
import type { DictKey } from "@/lib/i18n";

export const DEEP_SECTIONS = ["Bubble map and operators", "First 20 buyers", "Wallet roles", "Insiders, snipers and bundles", "Score breakdown", "Dev history and launch", "Second look", "Since last scan"];
// Подписи разделов на языке интерфейса; неизвестный раздел показывается как есть.
const SECTION_KEY: Record<string, DictKey> = {
  "Bubble map and operators": "lock.s.bubble",
  "First 20 buyers": "lock.s.first",
  "Wallet roles": "lock.s.roles",
  "Insiders, snipers and bundles": "lock.s.insiders",
  "Score breakdown": "lock.s.score",
  "Dev history and launch": "lock.s.dev",
  "Second look": "lock.s.second",
  "Since last scan": "lock.s.since",
};

export function DeepLock({ sections = DEEP_SECTIONS, className }: { sections?: string[]; className?: string }) {
  const { address, signedIn, connect, signIn } = useWallet();
  const { data, loading } = useViewerTier();
  const paid = DEEP_SCAN_TIER === "free" ? null : DEEP_SCAN_TIER;
  const need = paid ? data?.need[paid] : null;
  const usd = paid ? data?.usd[paid] : null;
  const name = TIER_NAME[DEEP_SCAN_TIER];
  const { t } = useT();
  const how = DEEP_SCAN_TIER === "pro" ? t("lock.burn") : t("lock.hold");
  if (loading)
    return <div className={cn("h-40 animate-pulse rounded-xl border border-line bg-panel-2/40", className)} />;
  return (
    <div className={cn("relative overflow-hidden rounded-xl border border-honey/30 bg-panel-2/40", className)}>
      {/* Заглушка под размытием: одинаковые полосы, без данных токена. */}
      <div aria-hidden className="pointer-events-none space-y-2 p-4 blur-[3px] select-none">
        {sections.map((s, i) => (
          <div key={s} className="flex items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2 text-xs">
            <span className="size-6 shrink-0 rounded-full bg-line" />
            <span className="font-semibold text-fg/70">{SECTION_KEY[s] ? t(SECTION_KEY[s]) : s}</span>
            <span className="ml-auto h-2 rounded bg-line" style={{ width: `${30 + ((i * 17) % 40)}%` }} />
          </div>
        ))}
      </div>
      <div className="absolute inset-0 grid place-items-center bg-bg/55 p-4 text-center backdrop-blur-[1px]">
        <div className="max-w-sm">
          <div className="mx-auto mb-2 grid size-10 place-items-center rounded-full border border-honey/50 bg-honey/10 text-honey">
            <Lock className="size-4" />
          </div>
          <div className="text-base font-bold">{t("lock.title", { symbol: TOKEN.symbol })}</div>
          <p className="mt-1 text-xs text-muted">
            {t("lock.needs", { name, how, amount: need ? `${fmt(need)} $${TOKEN.symbol}` : `$${TOKEN.symbol}`, usd: usd ? t("lock.about", { usd }) : "" })}
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <Link href="/pricing" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-honey px-4 text-sm font-semibold text-black hover:bg-[#ffc24d]">
              {t("lock.unlock", { name })}
            </Link>
            {!signedIn && (
              <button
                type="button"
                onClick={() => (address ? signIn() : connect()).catch(() => {})}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-sm hover:border-honey/60 hover:text-honey"
              >
                <Wallet className="size-4" /> {address ? t("wallet.signIn") : t("wallet.connectWallet")}
              </button>
            )}
          </div>
          <p className="mt-2 text-[11px] text-muted">
            {signedIn ? t("lock.signedIn", { tier: TIER_NAME[data?.tier ?? "free"], name }) : t("lock.already")}
          </p>
        </div>
      </div>
    </div>
  );
}
