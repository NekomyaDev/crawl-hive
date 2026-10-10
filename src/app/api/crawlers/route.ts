import type { NextRequest } from "next/server";
import { body, handle, walletFrom } from "@/lib/server/http";
import { ApiError, listCrawlers, spawnCrawler, type SpawnInput } from "@/lib/server/store";
import { isOnchain } from "@/lib/server/solana";

export async function GET(req: NextRequest) {
  return handle(() => {
    const p = req.nextUrl.searchParams;
    // Свой список (со спецификациями) — только для подписанного кошелька.
    const mine = p.get("mine") === "1" ? walletFrom(req) : undefined;
    return listCrawlers(
      {
        owner: mine ?? p.get("owner") ?? undefined,
        narrative: p.get("narrative") ?? undefined,
        source: p.get("source") ?? undefined,
        chain: p.get("chain") ?? undefined,
      },
      mine,
    );
  });
}

// Симулированный спавн. Когда настроен минт, спавн идёт только через /api/spawn/intent + confirm.
export async function POST(req: NextRequest) {
  return handle(async () => {
    if (isOnchain()) throw new ApiError("On-chain payment required: use /api/spawn/intent", 409);
    return spawnCrawler(walletFrom(req), await body<SpawnInput>(req));
  });
}
