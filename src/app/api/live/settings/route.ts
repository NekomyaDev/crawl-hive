// POST { enabled?, strategies?, tradeSol?, slippagePct? }: настройки живой торговли владельца. Включение требует
// Holder и режим не off и снимает паузу. Ответ: итоговые настройки.
import type { NextRequest } from "next/server";
import { body, clientIp, handle, walletFrom } from "@/lib/server/http";
import { setLiveSettings } from "@/lib/server/live-trader";
import { ApiError } from "@/lib/server/store";
import { noStore } from "../no-store";

export async function POST(req: NextRequest) {
  return noStore(
    await handle(async () => {
      const owner = walletFrom(req);
      const b = await body<Record<string, unknown>>(req);
      if (!b || typeof b !== "object" || Array.isArray(b)) throw new ApiError("Body must be an object");
      return setLiveSettings(owner, b, clientIp(req));
    }),
  );
}
