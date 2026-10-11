// Шаг 2: кошелёк подписал и отправил транзакцию; проверяем её в сети и создаём краулера.
import type { NextRequest } from "next/server";
import { body, handle, walletFrom } from "@/lib/server/http";
import { spawnCrawlerPaid } from "@/lib/server/store";
import { verifySpawnPayment } from "@/lib/server/solana";
import { isEvmAddress, verifyEthSpawnPayment } from "@/lib/server/robinhood";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const wallet = walletFrom(req);
    const { intentId, signature } = await body<{ intentId: string; signature: string }>(req);
    const sig = String(signature);
    if (isEvmAddress(wallet)) {
      const r = await verifyEthSpawnPayment(wallet, String(intentId), sig);
      return spawnCrawlerPaid(wallet, r.input, { unit: "ETH", amount: r.paidEth, tx: r.tx }, 0);
    }
    const r = await verifySpawnPayment(wallet, String(intentId), sig);
    const payment =
      r.payment === "sol"
        ? { unit: "SOL", amount: r.paidSol, tx: sig }
        : { unit: r.symbol, amount: r.burnedTokens, tx: sig };
    return spawnCrawlerPaid(wallet, r.input, payment, r.burnedTokens);
  });
}
