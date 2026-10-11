// Счётчик казны: сколько SOL и ETH собрано за спавны и продления, текущие балансы казны и цены SOL и ETH.
import { handle } from "@/lib/server/http";
import { paymentTotals, templateCounts } from "@/lib/server/store";
import { publicConfig, solUsd, treasuryBalance } from "@/lib/server/solana";
import { ethTreasuryBalance, ethUsd } from "@/lib/server/robinhood";

export async function GET() {
  return handle(async () => {
    const cfg = publicConfig();
    const [balance, usd, ethBalance, ethPrice] = await Promise.all([treasuryBalance(), solUsd(), ethTreasuryBalance(), ethUsd()]);
    return {
      ...paymentTotals(),
      balance,
      solUsd: usd,
      address: cfg.solRecipient,
      cluster: cfg.cluster,
      buyback: cfg.buyback,
      // Казна на Robinhood Chain: ETH за спавны тоже идёт в фонд выкупа.
      ethAddress: cfg.eth?.recipient ?? null,
      ethBalance,
      ethUsd: ethPrice,
      templates: templateCounts(),
    };
  });
}
