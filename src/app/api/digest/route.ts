// Ежедневный дайджест (то же, что уходит в Telegram по /digest): Rug Feed за сутки, Track Record v2,
// лучшие бумажные сигналы, нарративы, сжигания. Публично, данные кэшируются на 10 минут (daily.ts).
import { connection } from "next/server";
import { digestData } from "@/lib/server/daily";
import "@/lib/server/store";

export async function GET() {
  await connection();
  try {
    return Response.json(await digestData(), { headers: { "Cache-Control": "public, max-age=600, stale-while-revalidate=300" } });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
