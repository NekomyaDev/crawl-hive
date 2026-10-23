// POST: одноразовый nonce для выдачи ключа. Ответ: { nonce, message, expiresAt }; message кошелёк подписывает как есть
// ("CrawlHive export key <nonce>"), подпись уходит в POST /api/live/export в течение 5 минут. Новый nonce гасит прежний.
import type { NextRequest } from "next/server";
import { handle, walletFrom } from "@/lib/server/http";
import { exportNonce } from "@/lib/server/live-wallets";
import { noStore } from "../../no-store";

export async function POST(req: NextRequest) {
  return noStore(await handle(() => exportNonce(walletFrom(req))));
}
