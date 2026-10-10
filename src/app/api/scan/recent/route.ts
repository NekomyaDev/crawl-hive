// Последние сканы для таблицы «recently scanned» на главной.
import { handle } from "@/lib/server/http";
import { recentScans } from "@/lib/server/scan";

export async function GET() {
  return handle(() => recentScans());
}
