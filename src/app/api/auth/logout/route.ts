// Выйти на всех устройствах: все токены сессии этого кошелька перестают действовать.
import type { NextRequest } from "next/server";
import { handle, walletFrom } from "@/lib/server/http";
import { revokeSessions } from "@/lib/server/auth";

export async function POST(req: NextRequest) {
  return handle(() => revokeSessions(walletFrom(req)));
}
