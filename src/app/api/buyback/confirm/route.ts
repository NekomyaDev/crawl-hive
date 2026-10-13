// Шаг 2: транзакция подписана и отправлена; проверяем её в сети и записываем в публичную статистику.
import type { NextRequest } from "next/server";
import { body, handle, walletFrom } from "@/lib/server/http";
import { confirmBuyback } from "@/lib/server/buyback";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const wallet = walletFrom(req);
    const { signature } = await body<{ signature: string }>(req);
    return confirmBuyback(wallet, signature);
  });
}
