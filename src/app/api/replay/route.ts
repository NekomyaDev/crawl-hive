// Gem Replay и Rug Replay: попадания сканера из Track Record вместе со счётчиками промахов.
import { handle } from "@/lib/server/http";
import { replayFeed } from "@/lib/server/track";
import "@/lib/server/store";

export async function GET() {
  return handle(() => replayFeed());
}
