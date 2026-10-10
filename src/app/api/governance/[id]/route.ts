import type { NextRequest } from "next/server";
import { body, handle, walletFrom } from "@/lib/server/http";
import { vote } from "@/lib/server/store";

// Голос весом в текущий баланс $CRAWL. Повторный голос заменяет предыдущий.
export async function POST(req: NextRequest, ctx: RouteContext<"/api/governance/[id]">) {
  return handle(async () => {
    const { optionId } = await body<{ optionId: string }>(req);
    return vote(walletFrom(req), (await ctx.params).id, optionId);
  });
}
