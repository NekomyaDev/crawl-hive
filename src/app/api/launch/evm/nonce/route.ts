// BNB Chain (four.meme): одноразовый nonce для текста входа, который пользователь подписывает в кошельке.
import { body, handle } from "@/lib/server/http";
import { fourNonce } from "@/lib/server/launch-evm";
import "@/lib/server/store";

export async function POST(req: Request) {
  return handle(async () => fourNonce(String((await body<{ address?: string }>(req)).address ?? "")));
}
