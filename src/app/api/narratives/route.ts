// Narrative Radar: нарративы, которые охотник платформы нашёл в X.
import { handle } from "@/lib/server/http";
import { narrativeFeed } from "@/lib/server/narrative-radar";
import "@/lib/server/store";

export async function GET() {
  return handle(() => narrativeFeed());
}
