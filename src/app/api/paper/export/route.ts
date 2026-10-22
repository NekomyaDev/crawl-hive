// Экспорт Paper Engine для разбора: все сделки с признаками входа и исходом. ?since=<мс> — только закрытые позже.
import { handle } from "@/lib/server/http";
import { paperExport } from "@/lib/server/paper-engine";

export async function GET(req: Request) {
  return handle(() => {
    const since = Number(new URL(req.url).searchParams.get("since") ?? 0);
    return paperExport(Number.isFinite(since) && since > 0 ? since : 0);
  });
}
