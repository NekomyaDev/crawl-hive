// Счётчик казны: сколько SOL собрано за спавны и продления, текущий баланс кошелька казны и цена SOL.
import { handle } from "@/lib/server/http";
import { paymentTotals, templateCounts } from "@/lib/server/store";
import { publicConfig, solUsd, treasuryBalance } from "@/lib/server/solana";

export async function GET() {
  return handle(async () => {
    const cfg = publicConfig();
    const [balance, usd] = await Promise.all([treasuryBalance(), solUsd()]);
    return {
      ...paymentTotals(),
      balance,
      solUsd: usd,
      address: cfg.solRecipient,
      cluster: cfg.cluster,
      buyback: cfg.buyback,
      templates: templateCounts(),
    };
  });
}
