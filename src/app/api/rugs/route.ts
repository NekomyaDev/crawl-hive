// Rug Feed: монеты из Track Record, которые зарутали или рухнули после скана. Публично, кэш 60 с.
import { connection } from "next/server";
import { rugFeed } from "@/lib/server/rugs";
import "@/lib/server/store";

export async function GET() {
  await connection();
  try {
    return Response.json(rugFeed(), { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=60" } });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
