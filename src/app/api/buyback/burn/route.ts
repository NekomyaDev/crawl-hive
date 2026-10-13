// Сжечь весь остаток токена в казне (пыль сверх гарантированного минимума после байбеков). Только кошелёк казны.
import type { NextRequest } from "next/server";
import { handle, walletFrom } from "@/lib/server/http";
import { buildBurnLeftover } from "@/lib/server/buyback";

export async function POST(req: NextRequest) {
  return handle(() => buildBurnLeftover(walletFrom(req)));
}
