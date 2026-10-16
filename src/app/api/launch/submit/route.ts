// Лаунчпад, шаг 2: транзакция, подписанная ключом минта и кошельком автора. Отправляется, только если сообщение
// байт в байт то, что собрал сервер.
import { body, handle } from "@/lib/server/http";
import { submitLaunch } from "@/lib/server/launch";

export async function POST(req: Request) {
  return handle(async () => submitLaunch(await body<Record<string, unknown>>(req)));
}
