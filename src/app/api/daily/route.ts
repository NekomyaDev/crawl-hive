// Сводка дня (агрегаты) для ежедневного контента: гем и руг дня, цифры роя, нарратив дня, байбеки.
import { handle } from "@/lib/server/http";
import { dailyDigest } from "@/lib/server/daily";
import "@/lib/server/store";

export async function GET() {
  return handle(() => dailyDigest());
}
