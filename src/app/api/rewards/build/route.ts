// Выплата победителю дня: перевод SOL из кошелька казны или создателя с memo дня. Подписывает Phantom.
import type { NextRequest } from "next/server";
import { body, handle, walletFrom } from "@/lib/server/http";
import { buildRewardPayout } from "@/lib/server/rewards";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const wallet = walletFrom(req);
    const { day, amountSol } = await body<{ day: string; amountSol: number }>(req);
    return buildRewardPayout(wallet, day, amountSol);
  });
}
