// Встроенный Grok Bot под краулером: какие краулеры кошелька под ним и переключатель.
import type { NextRequest } from "next/server";
import { body, handle, walletFrom } from "@/lib/server/http";
import { dutyFor, setDuty } from "@/lib/server/grok-duty";

export async function GET(req: NextRequest) {
  return handle(() => dutyFor(walletFrom(req)));
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await body<{ crawlerId?: string; on?: boolean }>(req);
    return setDuty(walletFrom(req), String(b.crawlerId ?? ""), !!b.on);
  });
}
