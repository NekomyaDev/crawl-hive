// Server-Sent Events: живой поток сигналов, спавнов и сделок для дашборда.
import { connection } from "next/server";
import { pulse, subscribe, type StreamEvent } from "@/lib/server/store";

export async function GET(req: Request) {
  await connection();
  const enc = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const send = (e: StreamEvent | { type: "ping" }) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          cleanup();
        }
      };
      const unsub = subscribe(send);
      // Таймер двигает симуляцию и держит соединение живым.
      const timer = setInterval(() => {
        pulse();
        send({ type: "ping" });
      }, 1500);
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
