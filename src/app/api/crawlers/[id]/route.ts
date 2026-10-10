import type { NextRequest } from "next/server";
import { body, handle, walletFrom } from "@/lib/server/http";
import { ApiError, getCrawler, setCrawlerStatus, updateCrawlerConfig } from "@/lib/server/store";
import type { CrawlerSpec } from "@/lib/types";

// Владелец/арендатор видит спецификацию и полные сигналы, остальные — публичную часть.
export async function GET(req: NextRequest, ctx: RouteContext<"/api/crawlers/[id]">) {
  return handle(async () => getCrawler((await ctx.params).id, walletFrom(req, false) || undefined));
}

// Пауза/запуск, либо смена целей, частоты и спецификации.
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/crawlers/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const wallet = walletFrom(req);
    const b = await body<{
      status?: "active" | "paused";
      targets?: string[];
      frequencyMin?: number;
      spec?: Partial<CrawlerSpec>;
    }>(req);
    if (b.status) {
      if (b.status !== "active" && b.status !== "paused") throw new ApiError("Bad status");
      return setCrawlerStatus(wallet, id, b.status);
    }
    if (b.targets || b.frequencyMin !== undefined || b.spec)
      return updateCrawlerConfig(wallet, id, { targets: b.targets, frequencyMin: b.frequencyMin, spec: b.spec });
    throw new ApiError("Nothing to update");
  });
}
