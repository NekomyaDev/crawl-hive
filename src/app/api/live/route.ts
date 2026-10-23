// Живая торговля (live-trader.ts). GET: режим, готовность, выключатель, стратегии, лимиты, комиссия; вошедшему ещё
// его торговый кошелёк (адрес, баланс, настройки, позиции, история, уведомления), админу сводка. Ключей в ответе нет.
import type { NextRequest } from "next/server";
import { handle } from "@/lib/server/http";
import { sessionWallet } from "@/lib/server/auth";
import { liveStatus } from "@/lib/server/live-trader";
import { noStore } from "./no-store";

export async function GET(req: NextRequest) {
  return noStore(await handle(() => liveStatus(sessionWallet(req))));
}
