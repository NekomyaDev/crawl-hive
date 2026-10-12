// Изменить бота (имя, над какими краулерами стоит) или отозвать его ключ.
import type { NextRequest } from "next/server";
import { body, handle, walletFrom } from "@/lib/server/http";
import { deleteBot, disconnectApp, updateBot } from "@/lib/server/bots";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const wallet = walletFrom(req);
    const id = (await params).id;
    const b = await body<{ name?: string; crawlerIds?: string[]; disconnect?: number }>(req);
    // disconnect — отключить одного агента, подключённого через Connect (OAuth)
    return typeof b.disconnect === "number" ? disconnectApp(wallet, id, b.disconnect) : updateBot(wallet, id, b);
  });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => deleteBot(walletFrom(req), (await params).id));
}
