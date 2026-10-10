import type { NextRequest } from "next/server";
import { handle } from "@/lib/server/http";
import { leaderboard, topWallets, type LeaderboardSort } from "@/lib/server/store";

const SORTS: LeaderboardSort[] = ["reputation", "items", "rewards", "uptime", "precision"];

export async function GET(req: NextRequest) {
  return handle(() => {
    const s = req.nextUrl.searchParams.get("sort") as LeaderboardSort;
    return { crawlers: leaderboard(SORTS.includes(s) ? s : "reputation", 50), wallets: topWallets(15) };
  });
}
