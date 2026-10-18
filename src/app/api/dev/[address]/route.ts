// Репутация разработчика: монеты кошелька-создателя на pump.fun и их судьба.
import { handle } from "@/lib/server/http";
import { devProfile } from "@/lib/server/dev-profile";
import "@/lib/server/store";

export async function GET(_req: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;
  return handle(() => devProfile(address));
}
