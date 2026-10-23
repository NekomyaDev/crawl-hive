// POST { confirm: true, nonce, signature }: выдать владельцу секретный ключ торгового кошелька (base58, как импорт в Phantom).
// Кроме сессии нужна свежая подпись: nonce из POST /api/live/export/nonce, кошелёк подписывает "CrawlHive export key <nonce>",
// signature в base64. Лимит 3 в UTC-сутки, запись в аудит, админам уходит оповещение без ключа. Ответ: { pubkey, secretKey, format }.
import type { NextRequest } from "next/server";
import { body, clientIp, handle, walletFrom } from "@/lib/server/http";
import { exportLiveKey } from "@/lib/server/live-wallets";
import { noStore } from "../no-store";

export async function POST(req: NextRequest) {
  return noStore(
    await handle(async () => {
      const owner = walletFrom(req);
      const b = await body<{ confirm?: unknown; nonce?: unknown; signature?: unknown }>(req);
      return exportLiveKey(owner, b?.confirm, { nonce: b?.nonce, signature: b?.signature }, clientIp(req));
    }),
  );
}
