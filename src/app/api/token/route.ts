// Токен проекта для главной: тикер, адрес, цена и пул с DexScreener (кэш 45 с), эмиссия из минта.
import { handle } from "@/lib/server/http";
import { tokenInfo } from "@/lib/server/buyback";

export async function GET() {
  return handle(() => tokenInfo());
}
