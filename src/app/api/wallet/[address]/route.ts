import type { NextRequest } from "next/server";
import { handle, isAddress } from "@/lib/server/http";
import { ApiError, walletInfo } from "@/lib/server/store";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/wallet/[address]">) {
  return handle(async () => {
    const { address } = await ctx.params;
    if (!isAddress(address)) throw new ApiError("Bad wallet address");
    return walletInfo(address);
  });
}
