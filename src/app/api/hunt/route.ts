// Gem Hunter (gem-hunter.ts). GET: таблицы за сегодня, вчера и за всё время, победители дней, свои итоги, если вошёл
// (сессия кошелька или initData мини-аппа). POST { id }: засчитать свой скан с сайта или из мини-аппа (тот же IP,
// 10 минут). POST { day, tx }: админ (Telegram, admin.ts) вписывает подпись транзакции приза; выплат здесь нет.
import type { NextRequest } from "next/server";
import { body, clientIp, handle } from "@/lib/server/http";
import { sessionWallet } from "@/lib/server/auth";
import { gemHunterClaim, huntMe, huntStats, setPrizeTx } from "@/lib/server/gem-hunter";
import { tgUserFrom, verifyInitData, walletsOf } from "@/lib/server/tg-webapp";
import { isAdmin } from "@/lib/server/admin";
import { ApiError } from "@/lib/server/store";

// Кошельки игрока: подписанная сессия сайта, иначе кошельки, привязанные к Telegram мини-аппа.
function playerWallets(req: Request): { wallets: string[]; src: "web" | "telegram" } {
  const w = sessionWallet(req);
  if (w) return { wallets: [w], src: "web" };
  const u = verifyInitData(req.headers.get("x-tg-init") ?? "");
  return { wallets: u ? walletsOf(u) : [], src: "telegram" };
}

export async function GET(req: NextRequest) {
  return handle(async () => {
    const { wallets } = playerWallets(req);
    const me = wallets.length ? await huntMe(wallets[0]) : null;
    return { ...huntStats(), me };
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await body<{ id?: unknown; day?: unknown; tx?: unknown }>(req);
    if (typeof b.day === "string") {
      const u = tgUserFrom(req);
      if (!isAdmin(u)) throw new ApiError("Admins only", 403);
      return setPrizeTx(b.day, typeof b.tx === "string" ? b.tx : null);
    }
    if (typeof b.id !== "string" || !b.id.trim() || b.id.length > 100) throw new ApiError("Missing coin address", 400);
    const { wallets, src } = playerWallets(req);
    return gemHunterClaim(wallets, clientIp(req), b.id.trim(), src);
  });
}
