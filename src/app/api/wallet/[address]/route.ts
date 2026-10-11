import type { NextRequest } from "next/server";
import { handle, isAddress } from "@/lib/server/http";
import { ApiError, walletInfo } from "@/lib/server/store";
import { isOnchain, onchainBalances } from "@/lib/server/solana";
import { ethBalance, ethEnabled, isEvmAddress } from "@/lib/server/robinhood";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/wallet/[address]">) {
  return handle(async () => {
    const { address } = await ctx.params;
    if (!isAddress(address)) throw new ApiError("Bad wallet address");
    const info = walletInfo(address);
    try {
      // Кошелёк EVM: баланс ETH на Robinhood Chain.
      if (isEvmAddress(address)) return ethEnabled() ? { ...info, onchain: { tokens: 0, sol: 0, eth: await ethBalance(address) } } : info;
      if (!isOnchain()) return info;
      return { ...info, onchain: await onchainBalances(address) };
    } catch {
      return info; // RPC недоступен — отдаём хотя бы внутренний баланс
    }
  });
}
