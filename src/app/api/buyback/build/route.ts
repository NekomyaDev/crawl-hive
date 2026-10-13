// Шаг 1 байбека: только кошелёк казны. Сервер собирает свап SOL → токен через Jupiter и сжигание купленного
// в одной транзакции; подписывает её Phantom казны.
import type { NextRequest } from "next/server";
import { body, handle, walletFrom } from "@/lib/server/http";
import { buildBuyback } from "@/lib/server/buyback";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const wallet = walletFrom(req);
    const { amountSol, slippageBps } = await body<{ amountSol: number; slippageBps?: number }>(req);
    return buildBuyback(wallet, amountSol, slippageBps);
  });
}
