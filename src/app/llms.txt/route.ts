// GET /llms.txt — краткое описание сайта для языковых моделей и агентов.
import { connection } from "next/server";
import { llmsTxt } from "@/lib/server/x402";

export async function GET() {
  await connection();
  return new Response(llmsTxt(), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
