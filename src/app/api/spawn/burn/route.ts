// Спавн сжиганием $CRAWLHIVE со скидкой (spawn-burn.ts):
// GET ?tier=worker — котировка для показа; POST {action:"build", ...параметры спавна} — неподписанная транзакция сжигания;
// POST {action:"confirm", quoteId, signature} — проверка в сети и создание краулера.
import type { NextRequest } from "next/server";
import { body, handle, walletFrom } from "@/lib/server/http";
import { allowHit } from "@/lib/server/scan";
import { ApiError, type SpawnInput } from "@/lib/server/store";
import { buildSpawnBurn, confirmSpawnBurn, quoteSpawnBurn } from "@/lib/server/spawn-burn";

export async function GET(req: NextRequest) {
  return handle(() => quoteSpawnBurn(req.nextUrl.searchParams.get("tier") ?? "worker"));
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const w = walletFrom(req);
    const b = await body<SpawnInput & { action?: string; quoteId?: string; signature?: string }>(req);
    if (!allowHit(`spawnburn:${b.action}:${w}`, 20, 10 * 60_000)) throw new ApiError("Too many requests, wait a moment", 429);
    if (b.action === "build") return buildSpawnBurn(w, b);
    if (b.action === "confirm") return confirmSpawnBurn(w, b.quoteId, b.signature);
    throw new ApiError("Unknown action");
  });
}
