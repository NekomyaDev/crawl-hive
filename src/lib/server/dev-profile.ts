// Репутация разработчика: все монеты, которые кошелёк создал на pump.fun, и чем каждая кончилась. Список создания —
// из расширенного API транзакций Helius (тип CREATE), счётчики запусков и миграций — из аккаунтов кривых pump.fun,
// текущий рынок — DexScreener, руги и обвалы — наш Track Record. Кэш на 6 часов: страница дешёвая.
import "server-only";
import { rpcConnection } from "./solana";
import { bestPairs } from "./crawl/dexscreener";
import { launchesOf, PUBLIC_RPC } from "./scan-dev";
import { trackOutcomes } from "./track";
import { ApiError } from "./store";

export interface DevCoin {
  mint: string;
  symbol: string | null;
  name: string | null;
  createdAt: number;
  status: "live" | "dead" | "graduated" | "rugged" | "dumped";
  fdv: number | null;
  liq: number | null;
  url: string | null;
}
export interface DevProfile {
  creator: string;
  launched: number; // по аккаунтам кривых pump.fun (может быть больше, чем монет в списке)
  graduated: number;
  coins: DevCoin[];
  summary: { live: number; dead: number; rugged: number; graduated: number; bestFdv: number | null };
  verdict: "serial" | "weak" | "solid" | "new" | "mixed";
  checkedAt: number;
}

const TTL = 6 * 3600_000;
const QUOTE = new Set(["So11111111111111111111111111111111111111112", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"]);
const g = globalThis as unknown as { __crawlhiveDevProfiles?: Map<string, DevProfile> };
const cache = () => (g.__crawlhiveDevProfiles ??= new Map());
const gq = globalThis as unknown as { __crawlhiveDevQuota?: { day: string; n: number } };
const heliusKey = () => process.env.HELIUS_API_KEY?.trim() || process.env.SOLANA_RPC_FALLBACK?.match(/api-key=([0-9a-f-]{20,})/i)?.[1] || "";

// Транзакции создания монет этим кошельком: до 3 страниц по 100.
async function createdMints(creator: string) {
  const key = heliusKey();
  if (!key) return [];
  const out: { mint: string; at: number }[] = [];
  let before = "";
  for (let page = 0; page < 3; page++) {
    const r = await fetch(`https://api.helius.xyz/v0/addresses/${creator}/transactions?api-key=${key}&type=CREATE&limit=100${before ? `&before=${before}` : ""}`, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
    const list = (r?.ok ? await r.json().catch(() => []) : []) as { signature: string; timestamp: number; source?: string; tokenTransfers?: { mint?: string }[] }[];
    if (!Array.isArray(list) || !list.length) break;
    for (const tx of list) {
      const mints = [...new Set((tx.tokenTransfers ?? []).map((t) => t.mint).filter((m): m is string => !!m && !QUOTE.has(m)))];
      const mint = mints.find((m) => m.endsWith("pump")) ?? mints[0];
      if (mint && !out.some((x) => x.mint === mint)) out.push({ mint, at: tx.timestamp * 1000 });
    }
    if (list.length < 100) break;
    before = list[list.length - 1].signature;
  }
  return out;
}

export async function devProfile(creator: string): Promise<DevProfile> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(creator)) throw new ApiError("Not a Solana wallet address");
  const hit = cache().get(creator);
  if (hit && Date.now() - hit.checkedAt < TTL) return hit;
  // Каждый новый профиль — до трёх запросов к Helius: дневной потолок, чтобы перебором адресов не выжечь кредиты.
  const day = new Date().toISOString().slice(0, 10);
  const q = (gq.__crawlhiveDevQuota ??= { day, n: 0 });
  if (q.day !== day) Object.assign(q, { day, n: 0 });
  if (q.n >= Number(process.env.DEV_PROFILES_DAILY ?? 400)) {
    if (hit) return hit;
    throw new ApiError("Dev lookups are busy today, try again tomorrow", 429);
  }
  q.n++;
  const [mints, counts] = await Promise.all([
    createdMints(creator),
    launchesOf(rpcConnection().rpcEndpoint, creator).catch(() => launchesOf(PUBLIC_RPC, creator).catch(() => ({ launched: 0, graduated: 0 }))),
  ]);
  const list = mints.slice(0, 60);
  const pairs = await bestPairs("solana", list.map((m) => m.mint)).catch(() => new Map());
  const track = trackOutcomes();
  const coins: DevCoin[] = list.map(({ mint, at }) => {
    const p = pairs.get(mint);
    const t = track.get(mint);
    const liq = p?.liquidity?.usd ?? null;
    const status: DevCoin["status"] = t?.rugged ? "rugged" : !p || (liq ?? 0) < 1000 ? "dead" : t?.dumped ? "dumped" : p.dexId && p.dexId !== "pumpfun" ? "graduated" : "live";
    return { mint, symbol: p?.baseToken.symbol ?? null, name: p?.baseToken.name ?? null, createdAt: at, status, fdv: p?.fdv ?? p?.marketCap ?? null, liq, url: p?.url ?? null };
  });
  const n = (s: DevCoin["status"]) => coins.filter((c) => c.status === s).length;
  const launched = Math.max(counts.launched, coins.length);
  const graduated = Math.max(counts.graduated, n("graduated"));
  const dead = n("dead") + n("rugged");
  const verdict: DevProfile["verdict"] =
    launched <= 1 ? "new" : launched >= 10 && graduated === 0 ? "serial" : graduated / launched >= 0.3 ? "solid" : launched >= 3 && dead / Math.max(1, coins.length) >= 0.8 ? "weak" : "mixed";
  const bestFdv = coins.reduce<number | null>((m, c) => (c.fdv && (m === null || c.fdv > m) ? c.fdv : m), null);
  const profile: DevProfile = { creator, launched, graduated, coins, summary: { live: n("live") + n("graduated"), dead: n("dead"), rugged: n("rugged"), graduated, bestFdv }, verdict, checkedAt: Date.now() };
  if (cache().size > 2000) cache().clear();
  cache().set(creator, profile);
  return profile;
}
