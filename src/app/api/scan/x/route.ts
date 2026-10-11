// GET /api/scan/x?id=<адрес> — поиск по X через Grok для уже просканированного токена, по нажатию кнопки.
// Поток Server-Sent Events в том же формате, что /api/scan: строки лога, событие x, затем done.
import type { NextRequest } from "next/server";
import { connection } from "next/server";
import { attachBuzz, savedBuzz, savedScan } from "@/lib/server/scan";
import { buzzLine, scanX, scanXEnabled } from "@/lib/server/scan-x";

export async function GET(req: NextRequest) {
  await connection();
  const id = (req.nextUrl.searchParams.get("id") ?? "").slice(0, 64);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: unknown) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {}
      };
      const log = (l: object) => send({ type: "log", ts: Date.now(), ...l });
      // Пустые комментарии раз в 15 с, чтобы прокси не закрыли тихое соединение.
      const ping = setInterval(() => {
        try {
          controller.enqueue(enc.encode(": ping\n\n"));
        } catch {}
      }, 15_000);
      try {
        const r = savedScan(id);
        if (!r || (r.chain !== "solana" && r.chain !== "robinhood")) throw new Error("Scan the token first");
        if (!scanXEnabled()) throw new Error("X check is off right now");
        if (!savedBuzz(r.id)) log({ crawler: "crawler_x", text: `Grok is reading X for $${r.symbol}: who is talking about it, about half a minute…`, tone: "info" });
        const x = savedBuzz(r.id) ?? (await scanX(r, ip));
        log(buzzLine(x));
        attachBuzz(r.id, x);
        send({ type: "x", x });
      } catch (e) {
        log({ crawler: "crawler_x", text: `skipped: ${(e as Error).message.replace(/^(Grok API|.*(timeout|abort)).*/i, "X search is unavailable right now")}`, tone: "warn" });
        send({ type: "x", x: null });
      } finally {
        clearInterval(ping);
        send({ type: "done" });
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
