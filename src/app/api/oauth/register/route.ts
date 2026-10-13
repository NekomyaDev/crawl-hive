// Динамическая регистрация клиента OAuth (RFC 7591): агент регистрируется сам перед кнопкой Connect.
import { connection } from "next/server";
import { CORS, registerClient } from "@/lib/server/oauth";
import { ApiError } from "@/lib/server/store";
import { clientIp } from "@/lib/server/http";

// Регистрация без входа (так требует MCP), поэтому лимит: 10 клиентов в час с одного IP.
const g = globalThis as unknown as { __crawlhiveDcr?: Map<string, number[]> };
const hits = () => (g.__crawlhiveDcr ??= new Map());

export async function POST(req: Request) {
  await connection();
  const ip = clientIp(req);
  const now = Date.now();
  const list = (hits().get(ip) ?? []).filter((t: number) => now - t < 3600_000);
  if (list.length >= 10) return Response.json({ error: "slow_down", error_description: "Too many registrations" }, { status: 429, headers: CORS });
  list.push(now);
  hits().set(ip, list);
  if (hits().size > 10_000) hits().clear();
  try {
    const text = await req.text();
    if (text.length > 8_192) return Response.json({ error: "invalid_client_metadata", error_description: "Metadata too large" }, { status: 400, headers: CORS });
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(text);
    } catch {}
    const c = registerClient(meta);
    return Response.json(
      {
        client_id: c.client_id,
        client_id_issued_at: Math.floor(c.createdAt / 1000),
        client_name: c.client_name,
        redirect_uris: c.redirect_uris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
      { status: 201, headers: CORS },
    );
  } catch (e) {
    const msg = e instanceof ApiError ? e.message : "invalid_client_metadata";
    return Response.json({ error: msg === "invalid_redirect_uri" ? msg : "invalid_client_metadata", error_description: msg }, { status: 400, headers: CORS });
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
