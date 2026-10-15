// GET /api/x402/scan?q=<адрес | $ТИКЕР | ссылка>&chain=solana|robinhood|bsc — скан токена за USDC по x402,
// без аккаунта и ключа. Без оплаты — 402 с требованиями, с оплатой — тот же JSON, что у MCP scan_token.
// Порядок и защита от повторов — в x402.ts.
import type { NextRequest } from "next/server";
import { connection } from "next/server";
import { runScan } from "@/lib/server/scan";
import { scanBrief } from "@/lib/server/scan-brief";
import { paidCall, scanInput, withDeadline, X402_CORS } from "@/lib/server/x402";

export async function GET(req: NextRequest) {
  await connection();
  const inp = scanInput(req);
  if (inp instanceof Response) return inp;
  return paidCall(req, "scan", {
    ready: !!inp,
    work: async () =>
      scanBrief(
        await withDeadline(
          runScan(inp!.q, () => {}, inp!.chain, { record: false, src: "agent" }),
          45_000,
          "The scan took too long, try again in a minute",
        ),
      ),
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: X402_CORS });
}
