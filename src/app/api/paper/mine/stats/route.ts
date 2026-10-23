// Strategy builder: итоги личных стратегий вошедшего кошелька, посчитанные как таблица лидеров проекта
// (сделки, win rate, P&L, PF, просадка, без лучшей сделки, 95% диапазон), плюс открытые позиции и последние сделки.
import type { NextRequest } from "next/server";
import { handle, walletFrom } from "@/lib/server/http";
import { userStrategyStats } from "@/lib/server/paper-engine";

export async function GET(req: NextRequest) {
  return handle(() => userStrategyStats(walletFrom(req)));
}
