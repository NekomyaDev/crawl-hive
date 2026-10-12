// Для страницы подтверждения: имя приложения, которое просит доступ, и проверка адреса возврата.
import type { NextRequest } from "next/server";
import { handle } from "@/lib/server/http";
import { clientFor } from "@/lib/server/oauth";

export async function GET(req: NextRequest) {
  return handle(() => {
    const c = clientFor(req.nextUrl.searchParams.get("client_id") ?? "", req.nextUrl.searchParams.get("redirect_uri") ?? "");
    return { name: c.client_name, redirectHost: new URL(c.redirect_uris[0]).host || c.redirect_uris[0] };
  });
}
