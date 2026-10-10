// Шаг 2: кошелёк подписал и отправил транзакцию; проверяем её в сети и создаём краулера.
import type { NextRequest } from "next/server";
import { body, handle, walletFrom } from "@/lib/server/http";
import { spawnCrawlerPaid } from "@/lib/server/store";
import { verifySpawnPayment } from "@/lib/server/solana";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const wallet = walletFrom(req);
    const { intentId, signature } = await body<{ intentId: string; signature: string }>(req);
    const sig = String(signature);
    const r = await verifySpawnPayment(wallet, String(intentId), sig);
    const payment =
      r.payment === "sol"
        ? { unit: "SOL", amount: r.paidSol, tx: sig }
        : { unit: r.symbol, amount: r.burnedTokens, tx: sig };
    return spawnCrawlerPaid(wallet, r.input, payment, r.burnedTokens);
  });
}
