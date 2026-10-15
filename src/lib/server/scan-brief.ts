// Скан токена в виде для агентов: без логов и служебных полей. Один формат для MCP (scan_token)
// и платных запросов x402 (/api/x402/scan), чтобы агент получал одно и то же, как бы ни пришёл.
import "server-only";
import type { ScanResult } from "./scan";
import type { XBuzz } from "./scan-x";

export function scanBrief(r: ScanResult) {
  return {
    token: { address: r.id, chain: r.chain, symbol: r.symbol, name: r.name },
    score: r.score,
    verdict: r.verdict,
    reason: r.reason,
    flags: r.factors.filter((f) => f.impact !== 0).map((f) => `${f.label} (${f.impact > 0 ? "+" : ""}${f.impact}): ${f.note}`),
    market: r.market,
    holders: r.holders,
    bundles: r.bundles ? { linkedGroups: r.bundles.clusters, freshWallets: r.bundles.fresh } : undefined,
    dev: r.dev,
    evm: r.evm,
    contractXray: r.xray,
    copycats: r.clones,
    original: r.original,
    page: `https://crawlhive.xyz/scan/${r.id}`,
  };
}

// Сводка из X для агента: аватары и служебное время не нужны.
export function buzzBrief(x: XBuzz) {
  return {
    sentiment: x.sentiment,
    summary: x.summary,
    warnings: x.warnings,
    voices: (x.voices ?? []).map((v) => ({ handle: v.handle, stance: v.stance, followers: v.followers, posts: v.posts, text: v.text, url: v.url })),
    posts: x.posts,
    checkedAt: new Date(x.at).toISOString(),
  };
}
