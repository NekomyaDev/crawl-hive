import type { NextRequest } from "next/server";
import { body, handle, walletFrom } from "@/lib/server/http";
import { listCrawlers, spawnCrawler, type SpawnInput } from "@/lib/server/store";

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

// Спавн: сжигаем $CRAWL и создаём краулера.
export async function POST(req: NextRequest) {
  return handle(async () => spawnCrawler(walletFrom(req), await body<SpawnInput>(req)));
}
