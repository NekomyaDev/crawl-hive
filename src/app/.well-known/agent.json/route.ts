// Карточка агента A2A: /.well-known/agent-card.json (A2A 0.3+), /.well-known/agent.json — старый путь 0.2.
import { connection } from "next/server";
import { agentCard } from "@/lib/server/a2a";

export async function GET() {
  await connection();
  return Response.json(agentCard(), { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" } });
}
