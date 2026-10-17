// Прокси картинок из постов X (только pbs.twimg.com): для формы запуска и генератора баннера без CORS.
import type { NextRequest } from "next/server";
import { twimg } from "@/lib/server/narrative-media";

export async function GET(req: NextRequest) {
  const img = await twimg(req.nextUrl.searchParams.get("u") ?? "");
  if (!img) return new Response("not found", { status: 404 });
  return new Response(img.bytes, { headers: { "Content-Type": img.type, "Cache-Control": "public, max-age=86400, immutable" } });
}
