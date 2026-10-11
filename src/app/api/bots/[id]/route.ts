// Изменить бота (имя, над какими краулерами стоит) или отозвать его ключ.
import type { NextRequest } from "next/server";
import { body, handle, walletFrom } from "@/lib/server/http";
import { deleteBot, updateBot } from "@/lib/server/bots";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => updateBot(walletFrom(req), (await params).id, await body<{ name?: string; crawlerIds?: string[] }>(req)));
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => deleteBot(walletFrom(req), (await params).id));
}
