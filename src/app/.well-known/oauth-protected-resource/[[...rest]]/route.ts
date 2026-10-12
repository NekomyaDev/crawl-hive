// Метаданные OAuth для MCP-клиентов (RFC 9728 / RFC 8414). Клиенты спрашивают и с суффиксом пути (/mcp).
import { connection } from "next/server";
import { CORS, protectedResourceMeta } from "@/lib/server/oauth";

export async function GET() {
  await connection();
  return Response.json(protectedResourceMeta(), { headers: { ...CORS, "Cache-Control": "public, max-age=3600" } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
