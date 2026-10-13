// Мини-апп: кто открыл, его список наблюдения с живой ценой, настройки, а если к Telegram привязан кошелёк —
// его краулеры и последние сигналы (приватные: отдаём только владельцу, личность подтверждена подписью Telegram).
import type { NextRequest } from "next/server";
import { handle } from "@/lib/server/http";
import { tgUserFrom, walletsOf } from "@/lib/server/tg-webapp";
import { prefs, watchList } from "@/lib/server/telegram-public";
import { bestPairs } from "@/lib/server/crawl/dexscreener";
import { listCrawlers, mySignals } from "@/lib/server/store";

export async function GET(req: NextRequest) {
  return handle(async () => {
    const u = tgUserFrom(req);
    const chat = String(u.id);
    const list = watchList(chat);
    // Живая цена наблюдаемых токенов: не больше 5 штук, по одному запросу на сеть.
    const now = new Map<string, { price?: number; liq?: number }>();
    for (const chain of new Set(list.map((w) => w.chain))) {
      const ids = list.filter((w) => w.chain === chain).map((w) => w.id);
      const pairs = await bestPairs(chain, ids).catch(() => new Map());
      for (const id of ids) {
        const p = pairs.get(id);
        now.set(id, { price: p?.priceUsd ? Number(p.priceUsd) : undefined, liq: p?.liquidity?.usd });
      }
    }
    const wallets = walletsOf(u);
    const crawlers = wallets.flatMap((w) => listCrawlers({ owner: w }, w));
    const signals = wallets.flatMap((w) => mySignals(w, { limit: 30 })).sort((a, b) => b.ts - a.ts).slice(0, 30);
    const p = prefs(chat);
    return {
      user: { id: u.id, name: u.first_name ?? u.username ?? "", username: u.username ?? null },
      wallets,
      watchlist: list.map((w) => {
        const n = now.get(w.id);
        return {
          id: w.id,
          chain: w.chain,
          symbol: w.symbol,
          verdict: w.verdict,
          at: w.at,
          changePct: n?.price ? Math.round(((n.price - w.price0) / w.price0) * 1000) / 10 : null,
          liq: n?.liq ?? null,
          liq0: w.liq0,
          alerted: w.alerted,
          gone: now.has(w.id) && !n?.price,
        };
      }),
      prefs: { alerts: p.alerts ?? { on: false, mode: "clean", minLiq: 10_000 }, followups: p.followups !== false },
      crawlers: crawlers.map((c) => ({
        id: c.id,
        name: c.name,
        source: c.source,
        status: c.status,
        tier: c.tier,
        reputation: c.reputation,
        signals: c.stats.signals,
        hits: c.stats.hits,
        scored: c.stats.scored ?? 0,
        expiresAt: c.expiresAt ?? null,
      })),
      signals,
    };
  });
}
