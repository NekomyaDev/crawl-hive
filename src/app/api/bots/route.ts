// Grok Bots владельца: список и создание. Ключ возвращается один раз, в ответе на создание.
import type { NextRequest } from "next/server";
import { body, handle, walletFrom } from "@/lib/server/http";
import { createBot, listBots } from "@/lib/server/bots";

export async function GET(req: NextRequest) {
  return handle(() => listBots(walletFrom(req)));
}

export async function POST(req: NextRequest) {
  return handle(async () => createBot(walletFrom(req), await body<{ name?: string; crawlerIds?: string[] }>(req)));
}
