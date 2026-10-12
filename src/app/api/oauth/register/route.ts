// Динамическая регистрация клиента OAuth (RFC 7591): агент регистрируется сам перед кнопкой Connect.
import { connection } from "next/server";
import { CORS, registerClient } from "@/lib/server/oauth";
import { ApiError } from "@/lib/server/store";

export async function POST(req: Request) {
  await connection();
  try {
    const c = registerClient(await req.json().catch(() => ({})));
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
