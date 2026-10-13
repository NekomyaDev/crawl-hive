// Публичная статистика байбеков: сколько SOL потрачено, сколько токена сожжено, список транзакций.
// Кошельку казны дополнительно — остаток токена в казне и подсказка о комиссиях создателя.
import type { NextRequest } from "next/server";
import { handle, walletFrom } from "@/lib/server/http";
import { buybackStats, creatorFeesHint, tokenConfig, treasuryLeftover } from "@/lib/server/buyback";

export async function GET(req: NextRequest) {
  return handle(async () => {
    const stats = await buybackStats();
    if (walletFrom(req, false) !== tokenConfig().treasury) return stats;
    const [leftover, creatorFees] = await Promise.all([treasuryLeftover().catch(() => 0), creatorFeesHint()]);
    return { ...stats, owner: { leftover, creatorFees } };
  });
}
