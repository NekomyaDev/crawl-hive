import type { NextRequest } from "next/server";
import { body, handle, walletFrom } from "@/lib/server/http";
import { ApiError, getCrawler, setCrawlerStatus, updateCrawlerTargets } from "@/lib/server/store";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/crawlers/[id]">) {
  return handle(async () => getCrawler((await ctx.params).id));
}

// Пауза/запуск или смена целей и частоты.
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/crawlers/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const wallet = walletFrom(req);
    const b = await body<{ status?: "active" | "paused"; targets?: string[]; frequencyMin?: number }>(req);
    if (b.status) {
      if (b.status !== "active" && b.status !== "paused") throw new ApiError("Bad status");
      return setCrawlerStatus(wallet, id, b.status);
    }
    if (b.targets) return updateCrawlerTargets(wallet, id, b.targets, b.frequencyMin ?? 30);
    throw new ApiError("Nothing to update");
  });
}
