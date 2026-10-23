// POST { asset: "SOL" | <mint>, amount: number | string | "all", to? }: вывод с торгового кошелька. Только на кошелёк
// владельца (to, если передан, обязан совпасть). Ответ: { sig, confirmed, asset, amount, to, feesPaidSol }.
import type { NextRequest } from "next/server";
import { body, clientIp, handle, walletFrom } from "@/lib/server/http";
import { withdrawLive } from "@/lib/server/live-wallets";
import { ApiError } from "@/lib/server/store";
import { noStore } from "../no-store";

export async function POST(req: NextRequest) {
  return noStore(
    await handle(async () => {
      const owner = walletFrom(req);
      const b = await body<Record<string, unknown>>(req);
      if (!b || typeof b !== "object" || Array.isArray(b)) throw new ApiError("Body must be an object");
      return withdrawLive(owner, b, clientIp(req));
    }),
  );
}
