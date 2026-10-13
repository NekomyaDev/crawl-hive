// Мини-апп: добавить токен в список наблюдения или убрать его. Список общий с ботом.
import type { NextRequest } from "next/server";
import { body, handle } from "@/lib/server/http";
import { tgUserFrom } from "@/lib/server/tg-webapp";
import { watchAdd, watchRemove } from "@/lib/server/telegram-public";
import { ApiError } from "@/lib/server/store";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const u = tgUserFrom(req);
    const { id } = await body<{ id?: string }>(req);
    if (!id || id.length > 64) throw new ApiError("Token address is required");
    const r = await watchAdd(String(u.id), id.trim());
    if (!r.ok) throw new ApiError(r.error);
    return { ok: true, symbol: r.watch.symbol };
  });
}

export async function DELETE(req: NextRequest) {
  return handle(() => {
    const u = tgUserFrom(req);
    watchRemove(String(u.id), req.nextUrl.searchParams.get("id") ?? "");
    return { ok: true };
  });
}
