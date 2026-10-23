// Strategy builder: личные бумажные стратегии вошедшего кошелька. Список с лимитом тарифа (GET), создать (POST {name, config, enabled}),
// поправить (PATCH {id, name?, config?, enabled?}), удалить (DELETE ?id=u<число>). Владелец только из подписанной сессии.
import type { NextRequest } from "next/server";
import { body, handle, walletFrom } from "@/lib/server/http";
import { createStrategy, deleteStrategy, myStrategies, updateStrategy } from "@/lib/server/user-strategies";

export async function GET(req: NextRequest) {
  return handle(() => myStrategies(walletFrom(req)));
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const owner = walletFrom(req);
    return createStrategy(owner, await body<{ name?: unknown; config?: unknown; enabled?: unknown }>(req));
  });
}

export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const owner = walletFrom(req);
    return updateStrategy(owner, await body<{ id?: unknown; name?: unknown; config?: unknown; enabled?: unknown }>(req));
  });
}

export async function DELETE(req: NextRequest) {
  return handle(() => deleteStrategy(walletFrom(req), new URL(req.url).searchParams.get("id")));
}
