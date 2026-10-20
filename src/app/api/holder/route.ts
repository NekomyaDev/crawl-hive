// Статус держателя $CRAWLHIVE для вошедшего кошелька: баланс, порог и есть ли бонусы.
import type { NextRequest } from "next/server";
import { sessionWallet } from "@/lib/server/auth";
import { handle } from "@/lib/server/http";
import { holderMin, tokenBalance } from "@/lib/server/rewards";

export async function GET(req: NextRequest) {
  return handle(async () => {
    const w = sessionWallet(req);
    const balance = w ? await tokenBalance(w) : null;
    return { wallet: w, balance, min: holderMin(), holder: balance != null && balance >= holderMin() };
  });
}
