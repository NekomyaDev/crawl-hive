import type { NextRequest } from "next/server";
import { handle, walletFrom } from "@/lib/server/http";
import { networkStats, recentSignals, swarmGraph } from "@/lib/server/store";

export async function GET(req: NextRequest) {
  return handle(() => ({ ...swarmGraph(), stats: networkStats(), signals: recentSignals(30, walletFrom(req, false) || undefined) }));
}
