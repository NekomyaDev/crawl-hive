// Репутация разработчика: все монеты кошелька-создателя, которые мы знаем (память роя, pump.fun, Track Record).
// Ярлык, сводка и последние DEV_FREE_ROWS монет бесплатно; полная таблица от DEV_TABLE_TIER, тариф проверяем по сессии.
import { handle } from "@/lib/server/http";
import { sessionWallet } from "@/lib/server/auth";
import { devReputation } from "@/lib/server/dev-reputation";
import { tierAtLeast, tierOf } from "@/lib/server/tiers";
import { DEV_FREE_ROWS, DEV_TABLE_TIER } from "@/lib/tier-gate";
import "@/lib/server/store";

export async function GET(req: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;
  return handle(async () => {
    const rep = await devReputation(address);
    if (rep.coins.length <= DEV_FREE_ROWS) return rep;
    const wallet = sessionWallet(req);
    const tier = wallet ? (await tierOf(wallet).catch(() => null))?.tier ?? "free" : "free";
    if (tierAtLeast(tier, DEV_TABLE_TIER)) return rep;
    return { ...rep, coins: rep.coins.slice(0, DEV_FREE_ROWS), hidden: rep.coins.length - DEV_FREE_ROWS };
  });
}
