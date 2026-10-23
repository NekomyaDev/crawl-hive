// Голос держателя за токен: { analysis?: 1 | -1 | 0, token?: 1 | -1 | 0, comment?: string }. 0 снимает голос.
// Только подписанная сессия кошелька с тарифом Holder и выше. Голоса справочные, в балл не идут.
import type { NextRequest } from "next/server";
import { body, handle, isAddress, walletFrom } from "@/lib/server/http";
import { ApiError } from "@/lib/server/store";
import { castVote, type VoteInput } from "@/lib/server/token-profile";

export async function POST(req: NextRequest, ctx: { params: Promise<{ mint: string }> }) {
  return handle(async () => {
    const wallet = walletFrom(req);
    const { mint } = await ctx.params;
    const id = mint.startsWith("0x") ? mint.toLowerCase() : mint;
    if (!isAddress(id)) throw new ApiError("Bad token address");
    const b = await body<VoteInput>(req);
    if (!b || typeof b !== "object") throw new ApiError("Body must be an object");
    return castVote(wallet, id, { analysis: b.analysis, token: b.token, comment: typeof b.comment === "string" ? b.comment : undefined });
  });
}
