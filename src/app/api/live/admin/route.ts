// POST { kill: boolean, closeAll?: boolean }: админ (isAdminWallet) включает или снимает выключатель живой торговли,
// closeAll продаёт все открытые позиции всех пользователей. Ответ: { kill: { on, at, by }, closing }.
import type { NextRequest } from "next/server";
import { body, handle, walletFrom } from "@/lib/server/http";
import { adminLive } from "@/lib/server/live-trader";
import { noStore } from "../no-store";

export async function POST(req: NextRequest) {
  return noStore(
    await handle(async () => {
      const w = walletFrom(req);
      const b = await body<{ kill?: unknown; closeAll?: unknown }>(req);
      return adminLive(w, b ?? {});
    }),
  );
}
