// Личная лента сигналов: только краулеры подписанного кошелька (свои и арендованные).
import type { NextRequest } from "next/server";
import { handle, walletFrom } from "@/lib/server/http";
import { mySignals } from "@/lib/server/store";

export async function GET(req: NextRequest) {
  return handle(() => {
    const p = req.nextUrl.searchParams;
    return mySignals(walletFrom(req), {
      crawlerId: p.get("crawler") ?? undefined,
      status: p.get("status") ?? undefined,
      limit: Number(p.get("limit") ?? 200),
    });
  });
}
