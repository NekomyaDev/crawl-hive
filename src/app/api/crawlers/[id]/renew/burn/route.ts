// Продление сжиганием $CRAWLHIVE со скидкой (spawn-burn.ts):
// POST {action:"build"} — неподписанная транзакция сжигания; POST {action:"confirm", quoteId, signature} — проверка и продление.
import type { NextRequest } from "next/server";
import { body, handle, walletFrom } from "@/lib/server/http";
import { allowHit } from "@/lib/server/scan";
import { ApiError } from "@/lib/server/store";
import { buildRenewBurn, confirmRenewBurn } from "@/lib/server/spawn-burn";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/crawlers/[id]/renew/burn">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const w = walletFrom(req);
    const b = await body<{ action?: string; quoteId?: string; signature?: string }>(req);
    if (!allowHit(`renewburn:${b.action}:${w}`, 20, 10 * 60_000)) throw new ApiError("Too many requests, wait a moment", 429);
    if (b.action === "build") return buildRenewBurn(w, id);
    if (b.action === "confirm") return confirmRenewBurn(w, id, b.quoteId, b.signature);
    throw new ApiError("Unknown action");
  });
}
