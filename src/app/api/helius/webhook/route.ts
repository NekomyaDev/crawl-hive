// Вебхук Helius для wallet tracker: свопы отслеживаемых кошельков. Принимаем только с секретом в Authorization.
import { timingSafeEqual } from "node:crypto";
import { ingestHelius, webhookSecret } from "@/lib/server/wallet-watch";
import { ingestTracked } from "@/lib/server/wallet-tracker";
import "@/lib/server/store";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function POST(req: Request) {
  const secret = webhookSecret();
  if (!secret || !same(req.headers.get("authorization") ?? "", secret)) return new Response("forbidden", { status: 403 });
  if (Number(req.headers.get("content-length") ?? 0) > 2_000_000) return new Response("too large", { status: 413 });
  const body = await req.json().catch(() => null);
  if (!body) return new Response("bad json", { status: 400 });
  const out = ingestHelius(body);
  // Wallet tracker людей: вердикт может требовать скана до 30 с, поэтому Helius получает ответ сразу, а алерты
  // собираются в фоне.
  void ingestTracked(body).catch((e) => console.warn("[tracker] ingest:", (e as Error).message));
  return Response.json(out);
}
