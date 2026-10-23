// POST: создать торговый кошелёк для вошедшего Solana-кошелька (Holder и выше). Повтор возвращает тот же адрес.
// Ответ: { pubkey, createdAt, created }. Секрет генерируется и шифруется на сервере, наружу не уходит.
import type { NextRequest } from "next/server";
import { clientIp, handle, walletFrom } from "@/lib/server/http";
import { createLiveWallet } from "@/lib/server/live-wallets";
import { noStore } from "../no-store";

export async function POST(req: NextRequest) {
  return noStore(await handle(() => createLiveWallet(walletFrom(req), clientIp(req))));
}
