// GET /api/x402/scan-x?q=… — скан токена плюс проверка X через Grok, за USDC по x402.
// Grok платный и ограничен в сутки: если бюджет на сегодня кончился, отвечаем 503 ещё до оплаты.
// Поиск по X идёт 30–60 с, а подписанная агентом транзакция живёт ~60–90 с, поэтому у работы есть срок:
// не успели — 504 без списания, а поиск доработает в фоне и ляжет в кэш на 6 часов, повтор отдаст его сразу.
import type { NextRequest } from "next/server";
import { connection } from "next/server";
import { clientIp } from "@/lib/server/http";
import { runScan, savedBuzz, SCAN_CHAINS } from "@/lib/server/scan";
import { buzzBrief, scanBrief } from "@/lib/server/scan-brief";
import { cachedBuzz, scanX, scanXEnabled, xBudgetLeft } from "@/lib/server/scan-x";
import { ApiError } from "@/lib/server/store";
import { paidCall, scanInput, withDeadline, X402_CORS } from "@/lib/server/x402";

const fresh = (id: string) => cachedBuzz(id) ?? savedBuzz(id);

export async function GET(req: NextRequest) {
  await connection();
  const inp = scanInput(req);
  if (inp instanceof Response) return inp;
  const start = Date.now();
  return paidCall(req, "scan-x", {
    ready: !!inp,
    precheck: () => {
      if (!scanXEnabled()) return "The X check is off right now; /api/x402/scan still works";
      // Свежая сводка по этому адресу уже есть — Grok не нужен, бюджет не важен.
      if (!xBudgetLeft() && !(inp && fresh(inp.q.trim()))) return "Today's X check budget is used up, try again tomorrow; /api/x402/scan still works";
      return null;
    },
    work: async () => {
      const r = await withDeadline(runScan(inp!.q, () => {}, inp!.chain, { record: false, src: "agent" }), 30_000, "The scan took too long, try again in a minute");
      if (!SCAN_CHAINS[r.chain]) throw new ApiError(`The X check covers ${Object.values(SCAN_CHAINS).join(", ")} tokens only`, 400);
      const left = 50_000 - (Date.now() - start);
      const x =
        fresh(r.id) ??
        (await withDeadline(scanX(r, clientIp(req), { paid: true }), Math.max(1_000, left), "The X check is still running. Repeat the request with a new payment in a minute: the result will be cached"));
      return { ...scanBrief(r), x: buzzBrief(x) };
    },
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: X402_CORS });
}
