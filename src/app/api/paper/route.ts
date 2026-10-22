// Paper Trading: живой бумажный движок стратегий (paper-engine.ts) и старый расчёт задним числом (paper.ts) в legacy.
import { handle } from "@/lib/server/http";
import { paperStats } from "@/lib/server/paper";
import { paperEngineStats } from "@/lib/server/paper-engine";

export async function GET() {
  return handle(() => {
    let legacy = null;
    try {
      legacy = paperStats();
    } catch {
      // старый расчёт не обязателен, страница живёт и без него
    }
    return { engine: paperEngineStats(), legacy };
  });
}
