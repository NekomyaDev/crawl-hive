import type { NextRequest } from "next/server";
import { body, handle, walletFrom } from "@/lib/server/http";
import { ApiError, listCrawlers, spawnCrawler, type SpawnInput } from "@/lib/server/store";
import { isOnchain } from "@/lib/server/solana";

export async function GET(req: NextRequest) {
  return handle(() => {
    const p = req.nextUrl.searchParams;
    return listCrawlers({
      owner: p.get("owner") ?? undefined,
      narrative: p.get("narrative") ?? undefined,
      source: p.get("source") ?? undefined,
      chain: p.get("chain") ?? undefined,
    });
  });
}

// Симулированный спавн. Когда настроен минт, спавн идёт только через /api/spawn/intent + confirm.
export async function POST(req: NextRequest) {
  return handle(async () => {
    if (isOnchain()) throw new ApiError("On-chain burn required: use /api/spawn/intent", 409);
    return spawnCrawler(walletFrom(req), await body<SpawnInput>(req));
  });
}
