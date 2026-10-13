// Мини-апп: оповещения Launch Radar и сообщения «через 24 часа» — те же настройки, что у бота.
import type { NextRequest } from "next/server";
import { body, handle } from "@/lib/server/http";
import { tgUserFrom } from "@/lib/server/tg-webapp";
import { setAlerts, setPrefs } from "@/lib/server/telegram-public";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const chat = String(tgUserFrom(req).id);
    const b = await body<{ alerts?: { on?: boolean; mode?: string; minLiq?: number }; followups?: boolean }>(req);
    if (b.alerts)
      setAlerts(chat, {
        ...(typeof b.alerts.on === "boolean" ? { on: b.alerts.on } : {}),
        ...(b.alerts.mode ? { mode: b.alerts.mode === "all" ? "all" : "clean" } : {}),
        ...(b.alerts.minLiq ? { minLiq: [5_000, 25_000, 100_000].includes(b.alerts.minLiq) ? b.alerts.minLiq : 10_000 } : {}),
      });
    if (typeof b.followups === "boolean") setPrefs(chat, { followups: b.followups });
    return { ok: true };
  });
}
