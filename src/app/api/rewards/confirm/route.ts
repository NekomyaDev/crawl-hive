// Проверяем выплату в сети (подписант, получатель — победитель, memo дня) и публично записываем.
import type { NextRequest } from "next/server";
import { body, handle, walletFrom } from "@/lib/server/http";
import { confirmRewardPayout } from "@/lib/server/rewards";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const wallet = walletFrom(req);
    const { day, signature } = await body<{ day: string; signature: string }>(req);
    return confirmRewardPayout(wallet, day, signature);
  });
}
