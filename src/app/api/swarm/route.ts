import { handle } from "@/lib/server/http";
import { networkStats, recentSignals, swarmGraph } from "@/lib/server/store";

export async function GET() {
  return handle(() => ({ ...swarmGraph(), stats: networkStats(), signals: recentSignals(30) }));
}
