// Сбор на DEX: GET — прогресс; GET ?build=<sol>&wallet=<адрес> — транзакция для Phantom; POST {signature} — засчитать взнос.
import type { NextRequest } from "next/server";
import { ApiError } from "@/lib/server/store";
import { body, clientIp, handle } from "@/lib/server/http";
import { allowHit } from "@/lib/server/scan";
import { buildDexGift, confirmDexGift, dexFundStats } from "@/lib/server/dexfund";

export async function GET(req: NextRequest) {
  const build = req.nextUrl.searchParams.get("build");
  return handle<unknown>(() => {
    if (build == null) return dexFundStats();
    if (!allowHit(`dexbuild:${clientIp(req)}`, 20, 10 * 60_000)) throw new ApiError("Too many requests, slow down", 429);
    return buildDexGift(req.nextUrl.searchParams.get("wallet") ?? "", build);
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    if (!allowHit(`dexconfirm:${clientIp(req)}`, 30, 10 * 60_000)) throw new ApiError("Too many requests, slow down", 429);
    const { signature } = await body<{ signature?: string }>(req);
    return confirmDexGift(String(signature ?? ""));
  });
}
