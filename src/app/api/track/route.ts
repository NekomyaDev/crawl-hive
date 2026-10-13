// Track Record: сбылись ли вердикты сканера за сутки после скана.
import { handle } from "@/lib/server/http";
import { trackStats } from "@/lib/server/track";
import { signalTrack } from "@/lib/server/store";

export async function GET() {
  return handle(() => ({ ...trackStats(), signals: signalTrack() }));
}
