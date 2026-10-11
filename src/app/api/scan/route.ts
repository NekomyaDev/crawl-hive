// Instant Crawl: GET /api/scan?q=<адрес или $тикер> — поток Server-Sent Events: строки лога краулеров,
// затем результат, затем (для Solana и Robinhood Chain) догружается поиск по X и приходит событие done. Без кошелька, с лимитом по IP.
import type { NextRequest } from "next/server";
import { connection } from "next/server";
import { allowScan, attachBuzz, runScan } from "@/lib/server/scan";
import { cachedBuzz, scanX, scanXEnabled } from "@/lib/server/scan-x";

export async function GET(req: NextRequest) {
  await connection();
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 200);
  const chain = req.nextUrl.searchParams.get("chain") ?? undefined; // где искать $ТИКЕР: solana | robinhood
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
        const log = (l: object) => send({ type: "log", ts: Date.now(), ...l });
        const result = await runScan(q, log, chain);
        send({ type: "result", result });
        if ((result.chain === "solana" || result.chain === "robinhood") && scanXEnabled()) {
          const cached = cachedBuzz(result.id);
          if (!cached) log({ crawler: "crawler_x", text: `Grok is reading X for $${result.symbol}: who is talking about it, about a minute…`, tone: "info" });
          // Пустые комментарии раз в 15 с, чтобы прокси не закрыли тихое соединение.
          const ping = setInterval(() => {
            try {
              controller.enqueue(enc.encode(": ping\n\n"));
            } catch {}
          }, 15_000);
          try {
            const x = cached ?? (await scanX(result, ip));
            log({
              crawler: "crawler_x",
              text: `${x.sentiment}${x.warnings.length ? ` · warnings: ${x.warnings.join(", ")}` : ""} · ${x.summary}`,
              tone: x.warnings.length || x.sentiment === "bearish" ? "bad" : x.sentiment === "bullish" ? "ok" : "info",
            });
            attachBuzz(result.id, x);
            send({ type: "x", x });
          } catch (e) {
            log({ crawler: "crawler_x", text: `skipped: ${(e as Error).message.replace(/^(Grok API|.*(timeout|abort)).*/i, "X search is unavailable right now")}`, tone: "warn" });
            send({ type: "x", x: null });
          } finally {
            clearInterval(ping);
          }
        }
        send({ type: "done" });
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
