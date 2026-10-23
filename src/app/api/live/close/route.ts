// POST { positionId } или { all: true }: продать свою позицию (или все) по рынку. Ответ: { queued }.
import type { NextRequest } from "next/server";
import { body, handle, walletFrom } from "@/lib/server/http";
import { closeLive } from "@/lib/server/live-trader";
import { noStore } from "../no-store";

export async function POST(req: NextRequest) {
  return noStore(
    await handle(async () => {
      const owner = walletFrom(req);
      const b = await body<{ positionId?: unknown; all?: unknown }>(req);
      return closeLive(owner, b ?? {});
    }),
  );
}
