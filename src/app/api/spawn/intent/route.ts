// Шаг 1 on-chain спавна: проверяем параметры и отдаём неподписанную транзакцию оплаты.
// Кошелёк Solana платит в SOL (Phantom), кошелёк EVM — в ETH на Robinhood Chain.
import type { NextRequest } from "next/server";
import { body, handle, walletFrom } from "@/lib/server/http";
import { validateSpawn, type SpawnInput } from "@/lib/server/store";
import { createSpawnIntent } from "@/lib/server/solana";
import { createEthSpawnIntent, isEvmAddress } from "@/lib/server/robinhood";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const wallet = walletFrom(req);
    const input = validateSpawn(await body<SpawnInput>(req));
    return isEvmAddress(wallet) ? createEthSpawnIntent(wallet, input) : createSpawnIntent(wallet, input);
  });
}
