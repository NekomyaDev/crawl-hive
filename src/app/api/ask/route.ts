// Ask CrawlHive (ask.ts). GET: включён ли чат и сколько вопросов осталось сегодня. POST { question, history, lang? }:
// ответ потоком Server-Sent Events: text (куски ответа), tool (какой инструмент работает), done (остаток), error.
// Без ANTHROPIC_API_KEY обе ручки отвечают 503 {disabled:true}, страница показывает «coming soon».
// Кто спрашивает: подписанная сессия сайта или initData мини-аппа Telegram, иначе IP.
import type { NextRequest } from "next/server";
import { connection } from "next/server";
import { body, handle } from "@/lib/server/http";
import { ApiError } from "@/lib/server/store";
import { ASK_MAX_CHARS, askAccess, askApiFailed, askEnabled, askQuota, parseAsk, refundQuestion, runAsk, takeQuestion } from "@/lib/server/ask";

const DISABLED = () => Response.json({ disabled: true, error: "Ask CrawlHive is coming soon" }, { status: 503 });

export async function GET(req: NextRequest) {
  await connection();
  if (!askEnabled()) return DISABLED();
  return handle(async () => ({ enabled: true, maxChars: ASK_MAX_CHARS, ...askQuota(await askAccess(req)) }));
}

export async function POST(req: NextRequest) {
  await connection();
  if (!askEnabled()) return DISABLED();
  let input: ReturnType<typeof parseAsk>;
  let access: Awaited<ReturnType<typeof askAccess>>;
  let remaining: number;
  try {
    input = parseAsk(await body(req));
    access = await askAccess(req);
    remaining = takeQuestion(access);
  } catch (e) {
    if (e instanceof ApiError) return Response.json({ error: e.message }, { status: e.status });
    console.error(e);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: unknown) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {}
      };
      try {
        await runAsk({ ...input, access, signal: req.signal }, send);
        send({ type: "done", remaining });
      } catch (e) {
        // Не ответили по нашей вине или из-за API: вопрос не списываем.
        refundQuestion(access);
        if (!req.signal.aborted) send({ type: "error", message: askApiFailed(e), remaining: remaining + 1 });
      } finally {
        try {
          controller.close();
        } catch {}
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
}
