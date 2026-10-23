// Рефералка вошедшего кошелька: код, ссылки, сколько приглашено и текущий бонус. Без входа: { wallet: null }.
import type { NextRequest } from "next/server";
import { handle, walletFrom } from "@/lib/server/http";
import { refState } from "@/lib/server/referrals";

export async function GET(req: NextRequest) {
  return handle(async () => {
    const w = walletFrom(req, false);
    return w ? refState(w) : { wallet: null };
  });
}
