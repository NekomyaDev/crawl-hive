// Launch Radar: свежие запуски, которые платформа просканировала сама. Всем с задержкой, держателям $CRAWLHIVE сразу.
import type { NextRequest } from "next/server";
import { sessionWallet } from "@/lib/server/auth";
import { handle } from "@/lib/server/http";
import { radarFeed } from "@/lib/server/radar";
import { holderMin, isHolder } from "@/lib/server/rewards";
import "@/lib/server/store";

export async function GET(req: NextRequest) {
  return handle(async () => ({ ...radarFeed({ live: await isHolder(sessionWallet(req)) }), holderMin: holderMin() }));
}
