// Доставка сигналов в Telegram: статус привязки, ссылка для привязки, отвязка.
import type { NextRequest } from "next/server";
import { handle, walletFrom } from "@/lib/server/http";
import { ApiError } from "@/lib/server/store";
import { chatFor, linkCode, telegramBotName, telegramEnabled, unlink } from "@/lib/server/telegram";

export async function GET(req: NextRequest) {
  return handle(async () => {
    const wallet = walletFrom(req);
    return { enabled: telegramEnabled(), bot: telegramBotName(), linked: !!chatFor(wallet) };
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const wallet = walletFrom(req);
    if (!telegramEnabled()) throw new ApiError("Telegram delivery is not configured on this server", 503);
    return linkCode(wallet);
  });
}

export async function DELETE(req: NextRequest) {
  return handle(async () => {
    unlink(walletFrom(req));
    return { linked: false };
  });
}
