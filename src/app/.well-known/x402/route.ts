// GET /.well-known/x402 — каталог платных вызовов x402 для агентов и индексаторов (x402scan и др.).
import { connection } from "next/server";
import { x402Manifest, x402Off, X402_CORS } from "@/lib/server/x402";

export async function GET() {
  await connection();
  const m = await x402Manifest();
  if (!m) return x402Off();
  return Response.json(m, { headers: { ...X402_CORS, "Cache-Control": "public, max-age=300" } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: X402_CORS });
}
