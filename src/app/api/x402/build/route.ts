// GET /api/x402/build?wallet=<адрес>&route=scan|scan-x — неподписанная транзакция оплаты x402 для Phantom
// (страница /agents). Денег не двигает: без подписи кошелька и фасилитатора транзакция ничего не стоит.
import type { NextRequest } from "next/server";
import { ApiError } from "@/lib/server/store";
import { clientIp, handle } from "@/lib/server/http";
import { allowHit } from "@/lib/server/scan";
import { buildPaymentTx } from "@/lib/server/x402";

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet") ?? "";
  const route = req.nextUrl.searchParams.get("route") === "scan-x" ? "scan-x" : "scan";
  return handle(() => {
    if (!allowHit(`x402build:${clientIp(req)}`, 20, 10 * 60_000)) throw new ApiError("Too many requests, slow down", 429);
    return buildPaymentTx(route, wallet);
  });
}
