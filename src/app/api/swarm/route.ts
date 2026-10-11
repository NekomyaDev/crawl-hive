import type { NextRequest } from "next/server";
import { handle, walletFrom } from "@/lib/server/http";
import { networkStats, recentSignals, swarmGraph } from "@/lib/server/store";
import { botsByCrawler } from "@/lib/server/bots";

export async function GET(req: NextRequest) {
  return handle(() => {
    // Над краулером стоит Grok Bot — на карте он превращается в осьминога с лицом бота.
    const g = swarmGraph();
    const bots = botsByCrawler();
    const nodes = bots.size ? g.nodes.map((n) => (bots.has(n.id) ? { ...n, bots: bots.get(n.id)!.count, botLive: bots.get(n.id)!.live } : n)) : g.nodes;
    return { ...g, nodes, stats: networkStats(), signals: recentSignals(30, walletFrom(req, false) || undefined) };
  });
}
