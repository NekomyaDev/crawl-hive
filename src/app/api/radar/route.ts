// Launch Radar: свежие запуски, которые платформа просканировала сама (с задержкой для всех).
import { handle } from "@/lib/server/http";
import { radarFeed } from "@/lib/server/radar";
import "@/lib/server/store";

export async function GET() {
  return handle(() => radarFeed());
}
