// On-chain: DexScreener. Ленты новых профилей токенов, бустов и поиска по ключевым словам
// фильтруются по ликвидности, объёму, FDV и возрасту из спецификации. Цели-адреса — вотчлист:
// по ним ловим всплеск объёма. Если есть Grok и инструкции владельца — модель отбирает подходящие.
import "server-only";
import type { LiveJob } from "../../store";
import { bestPairs, latestBoosts, latestProfiles, searchPairs, type PairInfo } from "../dexscreener";
import { contractsIn, finalize, matchesKeywords, specBrief, type Candidate } from "../analyze";
import { extractJson, grok, grokEnabled } from "../grok";
import type { SourceResult } from "./types";

const usd = (n?: number) => (n === undefined ? "?" : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${n.toFixed(0)}`);

export async function crawlOnchain(job: LiveJob): Promise<SourceResult> {
  const { onchain: f, keywords } = job.spec;
  const descriptions = new Map<string, string>();
  const addresses = new Set<string>();

  if (f.feeds.includes("profiles"))
    for (const t of await latestProfiles()) if (t.chainId === job.chain) (addresses.add(t.tokenAddress), descriptions.set(t.tokenAddress, t.description ?? ""));
  if (f.feeds.includes("boosts"))
    for (const t of await latestBoosts()) if (t.chainId === job.chain) (addresses.add(t.tokenAddress), descriptions.set(t.tokenAddress, t.description ?? ""));
  const searched: PairInfo[] = [];
  if (f.feeds.includes("search"))
    for (const k of keywords.slice(0, 5)) searched.push(...(await searchPairs(k)).filter((p) => p.chainId === job.chain));

  const watch = job.targets.flatMap((t) => contractsIn(t, job.chain));
  const pairs = await bestPairs(job.chain, [...new Set([...addresses, ...watch])]);
  for (const p of searched) {
    const prev = pairs.get(p.baseToken.address);
    if (!prev || (p.liquidity?.usd ?? 0) > (prev.liquidity?.usd ?? 0)) pairs.set(p.baseToken.address, p);
  }

  const now = Date.now();
  const candidates: Candidate[] = [];
  // Клоны: несколько токенов с одним тикером — частая ловушка, помечаем в тексте сигнала.
  const bySymbol = new Map<string, number>();
  for (const p of pairs.values()) bySymbol.set(p.baseToken.symbol.toUpperCase(), (bySymbol.get(p.baseToken.symbol.toUpperCase()) ?? 0) + 1);
  for (const [addr, p] of pairs) {
    const liq = p.liquidity?.usd ?? 0;
    const vol1h = p.volume?.h1 ?? 0;
    const ageH = p.pairCreatedAt ? (now - p.pairCreatedAt) / 3600_000 : Infinity;
    const clones = bySymbol.get(p.baseToken.symbol.toUpperCase()) ?? 1;
    const label = `${p.baseToken.name} ($${p.baseToken.symbol}, CA ${addr.slice(0, 4)}…${addr.slice(-4)}${clones > 1 ? `, ⚠ ${clones} tokens share this ticker` : ""})`;
    const facts = `liq ${usd(liq)}, vol 1h ${usd(vol1h)}, FDV ${usd(p.fdv)}, 1h ${p.priceChange?.h1 ?? 0}%`;

    if (watch.includes(addr)) {
      // Вотчлист: объём за 5 минут в 3+ раза выше среднего за час.
      const m5 = p.volume?.m5 ?? 0;
      const avg5 = vol1h / 12;
      if (avg5 > 0 && m5 > avg5 * 3 && m5 > 1000)
        candidates.push({
          kind: "whale_buy",
          contract: addr,
          ticker: p.baseToken.symbol,
          summary: `Volume spike on ${label}: ${usd(m5)} in 5 min, ${(m5 / avg5).toFixed(1)}x the hourly average (${facts})`,
          confidence: Math.min(0.9, 0.5 + Math.log10(m5 / avg5) / 2),
          urls: [p.url],
        });
      continue;
    }
    if (liq < f.minLiquidityUsd || vol1h < f.minVolume1hUsd) continue;
    if (f.maxFdvUsd && (p.fdv ?? 0) > f.maxFdvUsd) continue;
    if (f.maxAgeHours && ageH > f.maxAgeHours) continue;
    const text = `${p.baseToken.name} ${p.baseToken.symbol} ${descriptions.get(addr) ?? ""}`;
    if (!matchesKeywords(text, f.feeds.includes("search") ? [] : keywords, job.spec.excludeKeywords)) continue;
    candidates.push({
      kind: "new_pair",
      contract: addr,
      ticker: p.baseToken.symbol,
      summary: `${label}: ${ageH < 48 ? `new pair ${ageH.toFixed(1)}h old, ` : ""}${facts}${descriptions.get(addr) ? `. "${descriptions.get(addr)!.slice(0, 120)}"` : ""}`,
      confidence: Math.min(0.9, 0.45 + Math.min(0.25, vol1h / 200_000) + (ageH < 6 ? 0.1 : 0)),
      urls: [p.url],
    });
  }

  // Индивидуализация: Grok выбирает из кандидатов те, что подходят под инструкции владельца.
  let picked = candidates;
  if (grokEnabled() && job.spec.instructions && candidates.length) {
    const list = candidates.slice(0, 40).map((c, i) => `#${i + 1} ${c.summary}`).join("\n");
    const { text } = await grok({
      system: 'You filter on-chain token candidates for a memecoin crawler. Reply with JSON only: {"keep":[candidate numbers], "confidence":{"<number>":0.0-1.0}}',
      user: `${specBrief(job)}\n\nCandidates:\n${list}`,
    });
    const r = extractJson<{ keep?: number[]; confidence?: Record<string, number> }>(text);
    if (r?.keep)
      picked = r.keep
        .map((n) => candidates[n - 1])
        .filter(Boolean)
        .map((c, i) => ({ ...c, confidence: r.confidence?.[String(r.keep![i])] ?? c.confidence }));
  }

  const known = new Map<string, PairInfo | undefined>([...pairs].map(([a, p]) => [a, p]));
  const fin = await finalize(job, picked, known);
  return { items: pairs.size, signals: fin.signals, cursor: fin.cursor };
}
