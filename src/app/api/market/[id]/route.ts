import type { NextRequest } from "next/server";
import { handle, walletFrom } from "@/lib/server/http";
import { buyListing, cancelListing } from "@/lib/server/store";

// Купить или арендовать.
export async function POST(req: NextRequest, ctx: RouteContext<"/api/market/[id]">) {
  return handle(async () => buyListing(walletFrom(req), (await ctx.params).id));
}

// Снять с продажи.
export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/market/[id]">) {
  return handle(async () => {
    cancelListing(walletFrom(req), (await ctx.params).id);
    return { ok: true };
  });
}
