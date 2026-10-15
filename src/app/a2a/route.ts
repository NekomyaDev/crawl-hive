// A2A (Agent2Agent): POST /a2a — JSON-RPC 2.0, методы SendMessage (A2A 1.0) и message/send (0.3). См. a2a.ts.
import { connection } from "next/server";
import { body, clientIp } from "@/lib/server/http";
import { handleA2A } from "@/lib/server/a2a";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, A2A-Version, A2A-Extensions",
};

export async function POST(req: Request) {
  await connection();
  let raw: unknown;
  try {
    raw = await body(req);
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { headers: HEADERS });
  }
  return Response.json(await handleA2A(raw, clientIp(req), req.headers.get("a2a-version")), { headers: HEADERS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: HEADERS });
}
