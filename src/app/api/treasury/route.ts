// Счётчик казны: сколько SOL собрано за спавны и продления и текущий баланс кошелька казны.
import { handle } from "@/lib/server/http";
import { paymentTotals, templateCounts } from "@/lib/server/store";
import { publicConfig, treasuryBalance } from "@/lib/server/solana";

export async function GET() {
  return handle(async () => {
    const cfg = publicConfig();
    return {
      ...paymentTotals(),
      balance: await treasuryBalance(),
      address: cfg.solRecipient,
      cluster: cfg.cluster,
      buyback: cfg.buyback,
      templates: templateCounts(),
    };
  });
}
