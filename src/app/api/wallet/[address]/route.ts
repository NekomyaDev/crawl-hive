import type { NextRequest } from "next/server";
import { handle, isAddress } from "@/lib/server/http";
import { ApiError, walletInfo } from "@/lib/server/store";
import { isOnchain, onchainBalances } from "@/lib/server/solana";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/wallet/[address]">) {
  return handle(async () => {
    const { address } = await ctx.params;
    if (!isAddress(address)) throw new ApiError("Bad wallet address");
    const info = walletInfo(address);
    if (!isOnchain()) return info;
    try {
      return { ...info, onchain: await onchainBalances(address) };
    } catch {
      return info; // RPC недоступен — отдаём хотя бы внутренний баланс
    }
  });
}
