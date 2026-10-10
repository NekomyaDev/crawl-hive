// Devnet: тестовые токены проекта и немного SOL на комиссию для подключённого кошелька.
import type { NextRequest } from "next/server";
import { handle, walletFrom } from "@/lib/server/http";
import { faucet } from "@/lib/server/solana";

export async function POST(req: NextRequest) {
  return handle(async () => faucet(walletFrom(req)));
}
