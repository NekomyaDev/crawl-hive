// Проверка токена в EVM-сетях (Robinhood Chain, BNB Chain, Base): держатели и флаг honeypot из GeckoTerminal,
// владелец контракта из RPC сети.
// У EVM нет mint/freeze authority, как у Solana: их роль играет владелец контракта, который часто может менять
// комиссии, ставить торговлю на паузу или чеканить. Отказался от владения — этих рычагов больше нет.
import "server-only";
import { evmRpc } from "./robinhood";

// Сети EVM, которые умеет сканер: chainId DexScreener → сеть GeckoTerminal и RPC.
export const EVM_SCAN: Record<string, { gecko: string; rpc?: () => string }> = {
  robinhood: { gecko: "robinhood" },
  bsc: { gecko: "bsc", rpc: () => process.env.BSC_RPC_URL?.trim() || "https://bsc-dataseed.bnbchain.org" },
  // mainnet.base.org режет частые запросы, publicnode держит нагрузку сканера.
  base: { gecko: "base", rpc: () => process.env.BASE_RPC_URL?.trim() || "https://base-rpc.publicnode.com" },
};

export async function chainRpc<T>(chain: string, method: string, params: unknown[]): Promise<T> {
  const url = EVM_SCAN[chain]?.rpc?.();
  if (!url) return evmRpc<T>(method, params); // Robinhood Chain — общий RPC из robinhood.ts
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  const j = (await r.json()) as { result?: T; error?: { message?: string } };
  if (j.error) throw new Error(j.error.message ?? method);
  return j.result as T;
}

export interface EvmReport {
  holders?: number; // сколько кошельков держат токен
  top10?: number; // % эмиссии у топ-10 (вместе с пулом ликвидности)
  honeypot?: boolean; // GeckoTerminal: купить можно, продать нельзя
  owner?: string | null; // владелец контракта; null — от владения отказались или функции owner() нет
}

const ZERO = "0x0000000000000000000000000000000000000000";
const DEAD = "0x000000000000000000000000000000000000dead";
const CACHE_MS = 10 * 60_000;

const g = globalThis as unknown as { __crawlhiveEvmScan?: Map<string, { at: number; r: EvmReport }> };
const cache = () => (g.__crawlhiveEvmScan ??= new Map());

async function ownerOf(chain: string, token: string): Promise<string | null> {
  try {
    const out = await chainRpc<string>(chain, "eth_call", [{ to: token, data: "0x8da5cb5b" }, "latest"]); // owner()
    if (!out || out.length < 66) return null;
    const a = `0x${out.slice(-40)}`.toLowerCase();
    return a === ZERO || a === DEAD ? null : a;
  } catch {
    return null; // функции owner() нет — управлять контрактом некому
  }
}

async function gecko(chain: string, token: string) {
  const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/${EVM_SCAN[chain]?.gecko ?? chain}/tokens/${token.toLowerCase()}/info`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`GeckoTerminal ${r.status}`);
  const a = ((await r.json()) as { data?: { attributes?: Record<string, unknown> } }).data?.attributes ?? {};
  const h = a.holders as { count?: number; distribution_percentage?: { top_10?: string } } | undefined;
  const top10 = Number(h?.distribution_percentage?.top_10);
  return {
    holders: typeof h?.count === "number" ? h.count : undefined,
    // Для некоторых токенов (часть эмиссии сожжена) GeckoTerminal отдаёт долю больше 100% — такому числу не верим.
    top10: Number.isFinite(top10) && top10 > 0 && top10 <= 100 ? top10 : undefined,
    honeypot: typeof a.is_honeypot === "boolean" ? a.is_honeypot : undefined,
  };
}

export async function traceEvm(token: string, chain = "robinhood"): Promise<EvmReport> {
  const key = `${chain}:${token.toLowerCase()}`;
  const hit = cache().get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.r;
  const [gt, owner] = await Promise.all([gecko(chain, token).catch(() => ({})), ownerOf(chain, token)]);
  const r: EvmReport = { ...gt, owner };
  cache().set(key, { at: Date.now(), r });
  return r;
}
