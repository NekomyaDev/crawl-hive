// Crawler Arena (arena.ts). GET: текущий раунд (заявки со счётом, лента событий, таймер), победители прошлых раундов
// с раскрытыми правилами; общая часть в кэше 5 с. Вошедшему ещё его заявка (me), админу флаг для заметки о призе.
// POST { strategy: "u<число>" }: войти в текущий раунд своей стратегией (только Holder и выше, окно записи 2 ч).
// PATCH { note }: админ (isAdminWallet) пишет заметку о призе текущего раунда; выплат здесь нет. Только бумага.
import type { NextRequest } from "next/server";
import { body, handle, walletFrom } from "@/lib/server/http";
import { sessionWallet } from "@/lib/server/auth";
import { isAdminWallet } from "@/lib/server/admin";
import { arenaMe, arenaState, enterArena, setPrizeNote } from "@/lib/server/arena";
import { ApiError } from "@/lib/server/store";

export async function GET(req: NextRequest) {
  return handle(async () => {
    const w = sessionWallet(req);
    return { ...arenaState(), me: w ? await arenaMe(w) : null, admin: isAdminWallet(w) };
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const owner = walletFrom(req);
    const b = await body<{ strategy?: unknown }>(req);
    return enterArena(owner, b.strategy);
  });
}

export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const w = walletFrom(req);
    if (!isAdminWallet(w)) throw new ApiError("Admins only", 403);
    const b = await body<{ note?: unknown }>(req);
    return setPrizeNote(b.note);
  });
}
