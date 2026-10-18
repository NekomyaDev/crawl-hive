// Короткий вердикт для браузерного расширения CrawlHive. GET ?url=<адрес страницы терминала> или ?q=<CA>&chain=.
import type { NextRequest } from "next/server";
import { clientIp, handle } from "@/lib/server/http";
import { allowScan } from "@/lib/server/scan";
import { ApiError } from "@/lib/server/store";
import { extVerdict } from "@/lib/server/ext";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const res = await handle(async () => {
    if (!allowScan(clientIp(req))) throw new ApiError("Too many scans from your network. Try again in a few minutes.", 429);
    return extVerdict({ url: sp.get("url")?.slice(0, 500) ?? undefined, q: sp.get("q")?.slice(0, 100) ?? undefined, chain: sp.get("chain") ?? undefined });
  });
  res.headers.set("Access-Control-Allow-Origin", "*");
  return res;
}
