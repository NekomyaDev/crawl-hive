// Продление краулера, шаг 1: неподписанная транзакция оплаты ещё одного срока.
// Без on-chain оплаты (локальная разработка) срок продлевается за внутренние credits сразу.
import type { NextRequest } from "next/server";
import { handle, walletFrom } from "@/lib/server/http";
import { renewableCrawler, renewCrawlerWithCredits } from "@/lib/server/store";
import { createRenewIntent, isOnchain } from "@/lib/server/solana";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/crawlers/[id]/renew">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const wallet = walletFrom(req);
    const { tier } = renewableCrawler(wallet, id);
    if (!isOnchain()) return { crawler: renewCrawlerWithCredits(wallet, id) };
    return createRenewIntent(wallet, id, tier);
  });
}
