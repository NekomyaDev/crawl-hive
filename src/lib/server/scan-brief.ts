// Скан токена в виде для агентов: без логов и служебных полей. Один формат для MCP (scan_token)
// и платных запросов x402 (/api/x402/scan), чтобы агент получал одно и то же, как бы ни пришёл.
import "server-only";
import type { ScanResult } from "./scan";
import type { XBuzz } from "./scan-x";
import type { DumpProjection } from "./scan-dump";
import type { FirstBuyersReport } from "./scan-first-buyers";

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
    dump: dumpBrief(r.dump),
    firstBuyers: firstBuyersBrief(r.firstBuyers),
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

// «Probable dump» для агента: те же поля, что на странице скана, плюс пояснение, что это «если продадут», а не прогноз.
// shown = meaningful: сайт и бот показывают блок только от DUMP_MIN_PCT эмиссии у подозрительных кошельков.
export function dumpBrief(d: DumpProjection | undefined) {
  if (!d) return undefined;
  const { meaningful, ...rest } = d;
  return {
    ...rest,
    shown: meaningful,
    note: "Estimate, not a prediction: how far the price would fall if these wallets sold everything they hold now into the current liquidity, in one go.",
  };
}

// Первые покупатели: счётчики по статусам и сам список (20 строк, без лишних полей).
export function firstBuyersBrief(f: FirstBuyersReport | undefined) {
  if (!f) return undefined;
  const n = (s: string) => f.buyers.filter((b) => b.status === s).length;
  return {
    total: f.buyers.length,
    holding: n("holding"),
    added: n("added"),
    soldPart: n("sold_part"),
    soldAll: n("sold_all"),
    movedOut: n("moved"),
    unknown: n("unknown"),
    groups: f.groups,
    window: f.window,
    partial: !!f.partial,
    buyers: f.buyers,
  };
}

// Короткие имена категорий «Probable dump» для одной строки (бот): «if snipers and linked wallets sell».
const DUMP_WHO: [string, string][] = [
  ["Creator", "the creator"],
  ["Linked", "linked wallets"],
  ["Snipers", "snipers"],
  ["Fresh", "fresh wallets"],
];
export function dumpWho(d: DumpProjection) {
  const who = d.breakdown.map((b) => DUMP_WHO.find(([k]) => b.label.startsWith(k))?.[1] ?? b.label.toLowerCase());
  if (!who.length) return "suspicious wallets";
  return who.length === 1 ? who[0] : `${who.slice(0, -1).join(", ")} and ${who[who.length - 1]}`;
}
