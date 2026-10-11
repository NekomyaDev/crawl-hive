// Продление, шаг 2: кошелёк подписал и отправил оплату; проверяем её в сети и добавляем срок.
import type { NextRequest } from "next/server";
import { body, handle, walletFrom } from "@/lib/server/http";
import { renewCrawler } from "@/lib/server/store";
import { verifyRenewPayment } from "@/lib/server/solana";
import { isEvmAddress, verifyEthRenewPayment } from "@/lib/server/robinhood";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/crawlers/[id]/renew/confirm">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const wallet = walletFrom(req);
    const { intentId, signature } = await body<{ intentId: string; signature: string }>(req);
    const sig = String(signature);
    if (isEvmAddress(wallet)) {
      const r = await verifyEthRenewPayment(wallet, String(intentId), sig, id);
      return renewCrawler(wallet, id, { unit: "ETH", amount: r.paidEth, tx: r.tx });
    }
    const r = await verifyRenewPayment(wallet, String(intentId), sig, id);
    const payment =
      r.payment === "sol" ? { unit: "SOL", amount: r.paidSol, tx: sig } : { unit: r.symbol, amount: r.burnedTokens, tx: sig };
    return renewCrawler(wallet, id, payment);
  });
}
