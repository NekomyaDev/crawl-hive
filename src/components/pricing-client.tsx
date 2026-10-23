"use client";
// Тарифы: живые пороги в токенах по текущей цене, тариф вошедшего кошелька, покупка Pro сжиганием.
import Link from "next/link";
import { useApi } from "@/lib/client/use-api";
import { fmt } from "@/lib/utils";
import { TOKEN } from "@/lib/token";
import { useBurnPay } from "./burn-pay";
import { useWallet } from "./wallet-provider";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { useT } from "./lang-provider";
import { DATE_LOCALE, type DictKey } from "@/lib/i18n";

export type TierName = "free" | "holder" | "pro" | "whale";
export type TierApi = {
  wallet: string | null;
  tier: TierName;
  balance: number | null;
  proUntil: number | null;
  need: { holder: number; whale: number; pro: number | null; priceUsd: number | null };
  coins: { holder: number; whale: number };
  usd: { holder: number; whale: number; pro: number };
  proDays: number;
  brain: { packs: number[]; usdPer1k: number; credits: number; key: { tail: string; createdAt: number } | null };
};

export const TIER_LABEL: Record<TierName, string> = { free: "Free", holder: "Holder", pro: "Pro", whale: "Whale" };
const TIER_CLS: Record<TierName, string> = { free: "border-line", holder: "border-lime/60", pro: "border-pink/70 shadow-[0_0_40px_rgba(244,114,182,0.18)]", whale: "border-sky/60" };

// Строки таблицы: что даёт каждый тариф по всем частям продукта (ключи словаря, тексты в src/lib/i18n).
const ROWS: [DictKey, DictKey, DictKey, DictKey, DictKey][] = [
  ["price.r.scans", "price.r.scans.0", "price.r.scans.1", "price.r.scans.2", "price.r.scans.3"],
  ["price.r.tg", "price.r.tg.0", "price.r.tg.1", "price.r.tg.2", "price.r.tg.3"],
  ["price.r.x", "price.r.x.all", "price.r.x.all", "price.r.x.all", "price.r.x.all"],
  ["price.r.ext", "price.r.ext.0", "price.r.ext.1", "price.r.ext.2", "price.r.scans.3"],
  ["price.r.radar", "price.r.radar.0", "price.r.radar.1", "price.r.radar.2", "price.r.radar.3"],
  ["price.r.narr", "price.r.narr.0", "price.r.narr.1", "price.r.narr.2", "price.r.scans.3"],
  ["price.r.tracker", "price.r.tracker.0", "price.r.tracker.1", "price.r.tracker.2", "price.r.tracker.3"],
  ["price.r.wl", "price.r.none", "price.r.wl.1", "price.r.wl.2", "price.r.wl.3"],
  ["price.r.auto", "price.r.none", "price.r.none", "price.r.auto.2", "price.r.auto.3"],
  ["price.r.crawlers", "price.r.crawlers.0", "price.r.crawlers.1", "price.r.crawlers.2", "price.r.crawlers.3"],
  ["price.r.brain", "price.r.brain.0", "price.r.brain.1", "price.r.brain.2", "price.r.brain.3"],
  ["price.r.community", "price.r.community.0", "price.r.community.1", "price.r.community.2", "price.r.community.3"],
];

const usd = (n: number) => `$${n % 1 ? n.toFixed(2) : n}`;

export function PricingClient() {
  const { data, reload } = useApi<TierApi>("/api/tier", 120_000);
  const { signedIn } = useWallet();
  const { pay, busy } = useBurnPay(() => reload());
  const { t, lang } = useT();
  const tr = t; // внутри карточек тарифов имя t занято тарифом
  const need = data?.need;
  const amount = (n: number | null | undefined) => (n ? `${fmt(n)} $${TOKEN.symbol}` : "…");
  // Порог показываем одним числом в токенах (столько и проверяется на кошельке), доллары только для ориентира.
  const approx = (n: number | null | undefined) => (n && need?.priceUsd ? t("price.aboutNow", { usd: (n * need.priceUsd).toFixed(n * need.priceUsd < 10 ? 2 : 0) }) : "");

  return (
    <div className="space-y-6">
      {/* твой тариф */}
      <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <div className="flex-1">
          <div className="text-sm text-muted">{t("price.yourTier")}</div>
          <div className="text-3xl font-black">{data ? TIER_LABEL[data.tier] : "…"}</div>
          <div className="mt-1 text-sm text-muted">
            {!signedIn
              ? t("price.signInHint")
              : data?.proUntil
                ? t("price.proUntil", { date: new Date(data.proUntil).toLocaleDateString(DATE_LOCALE[lang], { month: "short", day: "numeric" }) })
                : t("price.youHold", { amount: `${fmt(Math.round(data?.balance ?? 0))} $${TOKEN.symbol}` })}
          </div>
        </div>
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <Button onClick={() => pay("pro")} disabled={!!busy || !need?.pro} className="bg-pink text-black hover:bg-pink/90">
            🔥 {data?.proUntil ? t("price.extendPro") : t("price.goPro")}: {t("price.burnAmount", { amount: amount(need?.pro) })}
          </Button>
          <div className="text-xs text-muted">{busy ?? t("price.aboutFor", { usd: usd(data?.usd.pro ?? 10), days: data?.proDays ?? 30 })}</div>
        </div>
      </Card>

      {/* карточки тарифов */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(["free", "holder", "pro", "whale"] as TierName[]).map((t) => (
          <Card key={t} className={`border-2 p-5 ${TIER_CLS[t]} ${data?.tier === t ? "ring-2 ring-honey/60" : ""}`}>
            <div className="flex items-center justify-between">
              <div className="text-xl font-black">{TIER_LABEL[t]}</div>
              {data?.tier === t && <span className="rounded bg-honey px-1.5 text-[10px] font-black text-black">{tr("price.you")}</span>}
            </div>
            <div className="mt-2 text-sm text-fg/85">
              {t === "free" && tr("price.freeDesc")}
              {t === "holder" && (
                <>
                  {tr("price.hold")} <b>{amount(need?.holder)}</b><span className="text-muted">{approx(need?.holder)}</span>
                </>
              )}
              {t === "pro" && (
                <>
                  {tr("price.burn")} <b>{amount(need?.pro)}</b> <span className="text-muted">{tr("price.aboutPer", { usd: usd(data?.usd.pro ?? 10), days: data?.proDays ?? 30 })}</span>
                </>
              )}
              {t === "whale" && (
                <>
                  {tr("price.hold")} <b>{amount(need?.whale)}</b><span className="text-muted">{approx(need?.whale)}</span>
                </>
              )}
            </div>
          </Card>
        ))}
      </div>

      {/* таблица */}
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="p-3 text-muted">{t("price.feature")}</th>
              {(["free", "holder", "pro", "whale"] as TierName[]).map((t) => (
                <th key={t} className={`p-3 font-black ${t === "pro" ? "text-pink" : ""}`}>
                  {TIER_LABEL[t]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([f, ...cells]) => (
              <tr key={f} className="border-b border-line/60 align-top">
                <td className="p-3 font-semibold">{t(f)}</td>
                {cells.map((c, i) => (
                  <td key={i} className="p-3 text-fg/85">
                    {t(c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="p-5 text-sm text-fg/85">
        <div className="text-lg font-bold text-fg">{t("price.how")}</div>
        <ul className="mt-2 space-y-1.5">
          <li>• {t("price.how1")}</li>
          <li>• {t("price.how2")}</li>
          <li>• {t("price.how3")}</li>
          <li>
            • {t("price.how4a")}{" "}
            <Link href="/brain" className="text-honey hover:underline">
              {t("price.how4b")}
            </Link>
            .
          </li>
          <li>• {t("price.how5")}</li>
        </ul>
      </Card>
    </div>
  );
}
