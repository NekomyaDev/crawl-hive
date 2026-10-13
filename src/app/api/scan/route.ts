// Instant Crawl: GET /api/scan?q=<адрес или $тикер> — поток Server-Sent Events: строки лога краулеров,
// затем результат, затем сводка из X, если она уже есть в кэше (иначе xoffer — кнопка для /api/scan/x), и событие done. Без кошелька, с лимитом по IP.
import type { NextRequest } from "next/server";
import { clientIp } from "@/lib/server/http";
import { connection } from "next/server";
import { allowScan, runScan, savedBuzz, SCAN_CHAINS } from "@/lib/server/scan";
import { buzzLine, cachedBuzz, scanXEnabled } from "@/lib/server/scan-x";

export async function GET(req: NextRequest) {
  await connection();
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 200);
  const chain = req.nextUrl.searchParams.get("chain") ?? undefined; // где искать $ТИКЕР: solana | robinhood
  const ip = clientIp(req);
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
        // Поиск по X платный (Grok), поэтому сам он не запускается: готовая сводка из кэша отдаётся сразу,
        // иначе клиент показывает кнопку и зовёт /api/scan/x по нажатию.
        if (SCAN_CHAINS[result.chain]) {
          const cached = cachedBuzz(result.id) ?? savedBuzz(result.id);
          if (cached) {
            log(buzzLine(cached));
            send({ type: "x", x: cached });
          } else if (scanXEnabled()) send({ type: "xoffer" });
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
