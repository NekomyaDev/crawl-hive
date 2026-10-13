// «Crawler of the day»: топ-3 текущих суток UTC (кэш минута), последний победитель и история выплат.
// Плательщику (казна или CREATOR_WALLET) — подсказка о накопленных комиссиях создателя на pump.fun.
import type { NextRequest } from "next/server";
import { handle, walletFrom } from "@/lib/server/http";
import { lastWinner, rewardPayers, rewardsBoard } from "@/lib/server/rewards";
import { creatorFeesHint } from "@/lib/server/buyback";

export async function GET(req: NextRequest) {
  return handle(async () => {
    const [board, winners] = await Promise.all([rewardsBoard(), lastWinner()]);
    const payers = rewardPayers();
    const me = walletFrom(req, false);
    return { board, ...winners, payers, creatorFees: me && payers.includes(me) ? await creatorFeesHint() : undefined };
  });
}
