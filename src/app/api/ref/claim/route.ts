// Привязка приглашения после первого входа: код из ?ref=, который сайт сохранил в localStorage.
import type { NextRequest } from "next/server";
import { body, handle, walletFrom } from "@/lib/server/http";
import { allowHit } from "@/lib/server/scan";
import { ApiError } from "@/lib/server/store";
import { claimSite } from "@/lib/server/referrals";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const w = walletFrom(req);
    if (!allowHit(`refclaim:${w}`, 5, 3600_000)) throw new ApiError("Too many tries, try again later", 429);
    const b = await body<{ code?: string }>(req);
    return claimSite(w, b.code);
  });
}
