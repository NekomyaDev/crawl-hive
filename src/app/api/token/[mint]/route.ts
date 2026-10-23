// Публичная сводка токена для /token/<адрес>: сканы, вердикты по времени, исход Track Record, память роя,
// итоги голосов сообщества и последние комментарии. Вошедший кошелёк дополнительно видит свои голоса.
import type { NextRequest } from "next/server";
import { handle, isAddress } from "@/lib/server/http";
import { sessionWallet } from "@/lib/server/auth";
import { ApiError } from "@/lib/server/store";
import { tokenSummary } from "@/lib/server/token-profile";

export async function GET(req: NextRequest, ctx: { params: Promise<{ mint: string }> }) {
  return handle(async () => {
    const { mint } = await ctx.params;
    const id = mint.startsWith("0x") ? mint.toLowerCase() : mint;
    if (!isAddress(id)) throw new ApiError("Bad token address");
    return tokenSummary(id, sessionWallet(req));
  });
}
