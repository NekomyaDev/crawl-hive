// ИИ-арт монеты для нарратива: GET отдаёт уже нарисованный, POST рисует (по кнопке, с дневными лимитами).
import type { NextRequest } from "next/server";
import { body, clientIp, handle } from "@/lib/server/http";
import { cachedArt, makeArt } from "@/lib/server/narrative-media";
import { narrativeById } from "@/lib/server/narrative-radar";
import "@/lib/server/store";

const png = (b: Buffer) => new Response(new Uint8Array(b), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=604800, immutable" } });

export async function GET(req: NextRequest) {
  const b = cachedArt(req.nextUrl.searchParams.get("id") ?? "");
  return b ? png(b) : new Response("not found", { status: 404 });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const { id } = await body<{ id?: string }>(req);
    const n = narrativeById(String(id ?? ""));
    if (!n) throw new Error("Narrative not found");
    await makeArt(n.id, n, clientIp(req));
    return { url: `/api/narratives/art?id=${encodeURIComponent(n.id)}` };
  });
}
