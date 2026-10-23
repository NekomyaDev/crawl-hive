// Wallet tracker вошедшего кошелька: список с лимитом по тарифу, последние сделки, добавить (POST {wallet, label})
// и убрать (DELETE ?wallet=). Алерты о покупках и продажах уходят в Telegram (wallet-tracker.ts).
import type { NextRequest } from "next/server";
import { body, handle, walletFrom } from "@/lib/server/http";
import { addTracked, removeTracked, trackedState } from "@/lib/server/wallet-tracker";

export async function GET(req: NextRequest) {
  return handle(() => trackedState(walletFrom(req)));
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const owner = walletFrom(req);
    const b = await body<{ wallet?: string; label?: string }>(req);
    return addTracked(owner, b.wallet, b.label);
  });
}

export async function DELETE(req: NextRequest) {
  return handle(() => ({ removed: removeTracked(walletFrom(req), new URL(req.url).searchParams.get("wallet")) }));
}
