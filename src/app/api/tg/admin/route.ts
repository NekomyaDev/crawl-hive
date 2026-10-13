// Дашборд владельца проекта в мини-аппе: только для админов (Telegram id или username из env).
import type { NextRequest } from "next/server";
import { handle } from "@/lib/server/http";
import { tgUserFrom } from "@/lib/server/tg-webapp";
import { adminStats, isAdmin } from "@/lib/server/admin";
import { ApiError } from "@/lib/server/store";

export async function GET(req: NextRequest) {
  return handle(async () => {
    const u = tgUserFrom(req);
    if (!isAdmin(u)) throw new ApiError(`Not an admin. Your Telegram id: ${u.id}`, 403);
    return adminStats();
  });
}
