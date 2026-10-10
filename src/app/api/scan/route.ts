// Instant Crawl: GET /api/scan?q=<адрес или $тикер> — поток Server-Sent Events: строки лога краулеров,
// затем результат. Без кошелька и входа, с лимитом по IP.
import type { NextRequest } from "next/server";
import { connection } from "next/server";
import { allowScan, runScan } from "@/lib/server/scan";

export async function GET(req: NextRequest) {
  await connection();
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 200);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: unknown) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {}
      };
      try {
        if (!q.trim()) throw new Error("Paste a token contract address or a $TICKER");
        if (!allowScan(ip)) throw new Error("Too many scans from your network. Try again in a few minutes.");
        const result = await runScan(q, (l) => send({ type: "log", ts: Date.now(), ...l }));
        send({ type: "result", result });
      } catch (e) {
        send({ type: "error", message: (e as Error).message || "Scan failed" });
      } finally {
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
