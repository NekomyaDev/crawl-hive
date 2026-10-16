// Лаунчпад: GET — включён ли он и последние запуски с сайта; GET ?status=<подпись> — дошёл ли отложенный запуск.
import type { NextRequest } from "next/server";
import { handle } from "@/lib/server/http";
import { launchStatus, recentLaunches } from "@/lib/server/launch";

export async function GET(req: NextRequest) {
  const sig = req.nextUrl.searchParams.get("status");
  return handle<unknown>(() => (sig ? launchStatus(sig) : recentLaunches()));
}
