// Токен-эндпоинт OAuth: код авторизации (с PKCE) или токен обновления → токен доступа к /mcp.
import { connection } from "next/server";
import { CORS, exchange, OAuthError } from "@/lib/server/oauth";

async function params(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get("content-type") ?? "";
  const out: Record<string, string> = {};
  if (type.includes("application/json")) {
    const j = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    for (const [k, v] of Object.entries(j)) if (typeof v === "string") out[k] = v;
  } else {
    new URLSearchParams(await req.text()).forEach((v, k) => (out[k] = v));
  }
  // client_secret_basic: client_id может прийти в заголовке Authorization
  const basic = req.headers.get("authorization");
  if (!out.client_id && basic?.startsWith("Basic ")) {
    const [id] = Buffer.from(basic.slice(6), "base64").toString().split(":");
    if (id) out.client_id = decodeURIComponent(id);
  }
  return out;
}

export async function POST(req: Request) {
  await connection();
  const headers = { ...CORS, "Cache-Control": "no-store" };
  try {
    return Response.json(exchange(await params(req)), { headers });
  } catch (e) {
    if (e instanceof OAuthError) return Response.json({ error: e.code, error_description: e.message }, { status: e.status, headers });
    console.error("[oauth] token", e);
    return Response.json({ error: "server_error" }, { status: 500, headers });
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
