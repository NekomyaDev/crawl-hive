// Владелец подтвердил подключение агента к своему боту: выдаём одноразовый код и адрес возврата.
import type { NextRequest } from "next/server";
import { body, handle, walletFrom } from "@/lib/server/http";
import { approve } from "@/lib/server/oauth";

export async function POST(req: NextRequest) {
  return handle(async () => approve(walletFrom(req), await body<Record<string, unknown>>(req)));
}
