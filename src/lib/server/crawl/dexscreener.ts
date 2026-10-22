// DexScreener public API (без ключа): новые профили токенов, бусты, поиск, пары по адресу.
// Лимиты: 60 запросов/мин на профили и бусты, 300/мин на пары и поиск.
import "server-only";

const BASE = "https://api.dexscreener.com";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`DexScreener ${res.status} on ${path}`);
  return (await res.json()) as T;
}

export interface TokenListing {
  chainId: string;
  tokenAddress: string;
  description?: string;
  url?: string;
  icon?: string;
}

export interface PairInfo {
  chainId: string;
  dexId?: string;
  pairAddress: string;
  url: string;
  baseToken: { address: string; name: string; symbol: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
  volume?: { m5?: number; h1?: number; h6?: number; h24?: number };
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: { imageUrl?: string };
}

export const latestProfiles = () => get<TokenListing[]>("/token-profiles/latest/v1");
export const latestBoosts = () => get<TokenListing[]>("/token-boosts/latest/v1");
export const searchPairs = async (q: string) => (await get<{ pairs?: PairInfo[] }>(`/latest/dex/search?q=${encodeURIComponent(q)}`)).pairs ?? [];

// Пары по адресам токенов (до 30 за запрос); для каждого токена берём самую ликвидную пару.
export async function bestPairs(chainId: string, addresses: string[]): Promise<Map<string, PairInfo>> {
  const out = new Map<string, PairInfo>();
  for (let i = 0; i < addresses.length; i += 30) {
    const batch = addresses.slice(i, i + 30);
    const pairs = await get<PairInfo[]>(`/tokens/v1/${chainId}/${batch.join(",")}`);
    for (const p of pairs ?? []) {
      // Адреса EVM бывают в разном регистре: ключом остаётся написание из запроса.
      const addr = batch.find((b) => b.toLowerCase() === p.baseToken?.address?.toLowerCase());
      if (!addr) continue;
      const prev = out.get(addr);
      if (!prev || (p.liquidity?.usd ?? 0) > (prev.liquidity?.usd ?? 0)) out.set(addr, p);
    }
  }
  return out;
}

// Все пары одного токена (пакетный tokens/v1 отдаёт по одной паре на токен — основную по мнению DexScreener).
// Нужно, чтобы увидеть миграцию с кривой на пул и ликвидность, разбросанную по нескольким пулам.
export async function tokenPairs(chainId: string, address: string): Promise<PairInfo[]> {
  const pairs = await get<PairInfo[] | null>(`/token-pairs/v1/${chainId}/${address}`);
  return Array.isArray(pairs) ? pairs : [];
}

export const priceOf = (p?: PairInfo) => (p?.priceUsd ? Number(p.priceUsd) : undefined);
