// GET /openapi.json — описание API для агентов и каталогов x402 (см. openApi в x402.ts).
import { connection } from "next/server";
import { openApi } from "@/lib/server/x402";

export async function GET() {
  await connection();
  return Response.json(openApi(), { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" } });
}
