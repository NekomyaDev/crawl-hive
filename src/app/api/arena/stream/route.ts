// Server-Sent Events Crawler Arena: открытия и закрытия сделок копий в текущем раунде и новые заявки.
// Счёт целиком клиент перечитывает из GET /api/arena (кэш 5 с), поток только подсказывает, когда и что анимировать.
import { connection } from "next/server";
import { subscribeArena, type ArenaFeedEvent } from "@/lib/server/arena";

export async function GET(req: Request) {
  await connection();
  const enc = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const send = (e: { type: "arena"; event: ArenaFeedEvent } | { type: "ping" }) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          cleanup();
        }
      };
      const unsub = subscribeArena((event) => send({ type: "arena", event }));
      // Пинг держит соединение живым через прокси.
      const timer = setInterval(() => send({ type: "ping" }), 20_000);
      send({ type: "ping" });
      cleanup = () => {
        clearInterval(timer);
        unsub();
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
