// Clean Launch на EVM (Robinhood Chain через Pons): GET — включён ли и комиссия лаунчпада, POST — подготовка вызова.
import type { NextRequest } from "next/server";
import { ApiError } from "@/lib/server/store";
import { clientIp, handle } from "@/lib/server/http";
import { evmLaunchInfo, prepareEvmLaunch } from "@/lib/server/launch-evm";

const MAX = 3_000_000;

export async function GET(req: NextRequest) {
  return handle(() => evmLaunchInfo((req.nextUrl.searchParams.get("chain") ?? "robinhood") as "robinhood"));
}

export async function POST(req: Request) {
  return handle(async () => {
    if (Number(req.headers.get("content-length") ?? 0) > MAX) throw new ApiError("Request body too large", 413);
    const text = await req.text();
    if (text.length > MAX) throw new ApiError("Request body too large", 413);
    let b: Record<string, unknown>;
    try {
      b = JSON.parse(text);
    } catch {
      throw new ApiError("Body must be JSON");
    }
    return prepareEvmLaunch(clientIp(req), b ?? {});
  });
}
