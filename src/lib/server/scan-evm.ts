// Проверка токена на Robinhood Chain (EVM): держатели и флаг honeypot из GeckoTerminal, владелец контракта из RPC.
// У EVM нет mint/freeze authority, как у Solana: их роль играет владелец контракта, который часто может менять
// комиссии, ставить торговлю на паузу или чеканить. Отказался от владения — этих рычагов больше нет.
import "server-only";
import { evmRpc } from "./robinhood";

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

async function ownerOf(token: string): Promise<string | null> {
  try {
    const out = await evmRpc<string>("eth_call", [{ to: token, data: "0x8da5cb5b" }, "latest"]); // owner()
    if (!out || out.length < 66) return null;
    const a = `0x${out.slice(-40)}`.toLowerCase();
    return a === ZERO || a === DEAD ? null : a;
  } catch {
    return null; // функции owner() нет — управлять контрактом некому
  }
}

async function gecko(token: string) {
  const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/robinhood/tokens/${token.toLowerCase()}/info`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`GeckoTerminal ${r.status}`);
  const a = ((await r.json()) as { data?: { attributes?: Record<string, unknown> } }).data?.attributes ?? {};
  const h = a.holders as { count?: number; distribution_percentage?: { top_10?: string } } | undefined;
  const top10 = Number(h?.distribution_percentage?.top_10);
  return {
    holders: typeof h?.count === "number" ? h.count : undefined,
    top10: Number.isFinite(top10) && top10 > 0 ? top10 : undefined,
    honeypot: typeof a.is_honeypot === "boolean" ? a.is_honeypot : undefined,
  };
}

export async function traceEvm(token: string): Promise<EvmReport> {
  const key = token.toLowerCase();
  const hit = cache().get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.r;
  const [gt, owner] = await Promise.all([gecko(token).catch(() => ({})), ownerOf(token)]);
  const r: EvmReport = { ...gt, owner };
  cache().set(key, { at: Date.now(), r });
  return r;
}
