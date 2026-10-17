// Clean Launch на EVM, шаг 2: хэш транзакции из кошелька → проверка, чек, адрес монеты, скан при рождении.
import { body, handle } from "@/lib/server/http";
import { submitEvmLaunch } from "@/lib/server/launch-evm";
import "@/lib/server/store";

export async function POST(req: Request) {
  return handle(async () => submitEvmLaunch(await body<Record<string, unknown>>(req)));
}
