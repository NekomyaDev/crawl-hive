// Торговые кошельки живой торговли (как у BonkBot/Trojan): один серверный кошелёк на кошелёк владельца.
// Здесь всё про хранение и доступ: мастер-ключ из env, база, RPC, движок-одиночка и действия владельца
// (создать, выдать ключ, вывести). Сама логика и шифрование лежат в live-core.ts, тут только подключение к сайту.
//
// Без LIVE_WALLET_MASTER_KEY (32 байта base64) функция выключена целиком: кошельки не создаются и не подписывают.
// Секрет расшифровывается только внутри подписи и выдачи владельцу, не логируется и не возвращается API.
// Вывод SOL и токенов только на кошелёк владельца. Решение о хранении ключей и ответственность за них на владельце проекта.
import "server-only";
import { Connection } from "@solana/web3.js";
import { BUYBACK_TREASURY } from "../economy";
import { memDb } from "./memory-db";
import { limitedFetch } from "./rpc-limit";
import { opsAlert } from "./ops-alert";
import { ApiError, getMeta } from "./store";
import { tierAtLeast, tierOf } from "./tiers";
import { issueActionNonce, verifyActionSignature } from "./auth";
import { bestPairs } from "./crawl/dexscreener";
import { STRATEGIES, paperDb } from "./paper-engine";
import { createLiveEngine, initLiveSchema, jupiterClient, LiveError, liveConfig, parseMasterKey, rpcFrom, type LiveEngine, type LiveEvent, type Rpc } from "./live-core";

interface LiveState {
  engine?: LiveEngine;
  schema?: boolean;
  warned?: boolean;
  rpc?: { url: string; rpc: Rpc };
  tiers: Map<string, { at: number; ok: boolean }>;
  hooks: Set<(e: LiveEvent) => void>;
}
const g = globalThis as unknown as { __crawlhiveLive?: LiveState };
const st = (): LiveState => (g.__crawlhiveLive ??= { tiers: new Map(), hooks: new Set() });

// ---------- подключение ----------

function liveDb() {
  const d = memDb();
  if (!d) return null;
  if (!st().schema) {
    initLiveSchema(d.db);
    st().schema = true;
  }
  return d.db;
}

// Мастер-ключ: нет или кривой: функция выключена, один раз пишем в лог и админам.
export function masterKey(): Buffer | null {
  const k = parseMasterKey(process.env.LIVE_WALLET_MASTER_KEY);
  if (!k && !st().warned) {
    st().warned = true;
    console.warn("[live] LIVE_WALLET_MASTER_KEY is missing or is not 32 bytes of base64: live wallets are disabled");
    if (liveConfig().mode !== "off") opsAlert("live-master-key", "Live trading is on, but LIVE_WALLET_MASTER_KEY is missing or invalid (need 32 bytes base64). Live wallets are disabled.", 24 * 3600_000);
  }
  return k;
}

// RPC живой торговли: LIVE_RPC_URL, иначе общий SOLANA_RPC_URL, но только если сайт сам на mainnet (Jupiter только там).
export function liveRpcUrl(): string | null {
  const own = process.env.LIVE_RPC_URL?.trim();
  if (own) return own;
  const cluster = process.env.SOLANA_CLUSTER?.trim() || "devnet";
  return cluster === "mainnet-beta" ? process.env.SOLANA_RPC_URL?.trim() || null : null;
}
function liveRpc(): Rpc | null {
  const url = liveRpcUrl();
  if (!url) return null;
  const s = st();
  if (s.rpc?.url !== url) s.rpc = { url, rpc: rpcFrom(new Connection(url, { commitment: "confirmed", fetch: limitedFetch, disableRetryOnRateLimit: true })) };
  return s.rpc.rpc;
}

// Готовность: почему функция недоступна (для страницы и для старта трейдера).
export function liveReady(): { ok: boolean; reason: string | null } {
  if (!memDb()) return { ok: false, reason: "Storage is unavailable" };
  if (!masterKey()) return { ok: false, reason: "Live wallets are not configured on this server" };
  if (!liveRpcUrl()) return { ok: false, reason: "Mainnet RPC for live trading is not configured" };
  return { ok: true, reason: null };
}

// Выключатель: meta liveKill. Стоп новых входов для всех; открытые позиции живут, пока их не закроют.
export interface LiveKill {
  on: boolean;
  at: number;
  by: string;
}
export function liveKill(): LiveKill {
  try {
    const v = JSON.parse(getMeta("liveKill") ?? "null") as LiveKill | null;
    return v && typeof v.on === "boolean" ? v : { on: false, at: 0, by: "" };
  } catch {
    return { on: false, at: 0, by: "" };
  }
}

// Тариф держателя: tierOf ходит в RPC за балансом, кэшируем на 5 минут на владельца.
async function tierOk(owner: string) {
  const c = st().tiers.get(owner);
  if (c && Date.now() - c.at < 5 * 60_000) return c.ok;
  const ok = tierAtLeast((await tierOf(owner)).tier, "holder");
  st().tiers.set(owner, { at: Date.now(), ok });
  if (st().tiers.size > 5000) st().tiers.clear();
  return ok;
}

// Жива ли бумажная позиция: есть в paper_positions: да; уже в paper_trades: закрыта; иначе неизвестно.
function paperOpen(id: number): boolean | null {
  const d = paperDb();
  if (!d) return null;
  if (d.prepare("SELECT 1 FROM paper_positions WHERE id = ?").get(id)) return true;
  if (d.prepare("SELECT 1 FROM paper_trades WHERE id = ?").get(id)) return false;
  return null;
}

async function prices(tokens: string[]) {
  const pairs = await bestPairs("solana", tokens);
  const out = new Map<string, number>();
  for (const [t, p] of pairs) {
    const v = Number(p.priceUsd);
    if (v > 0) out.set(t, v);
  }
  return out;
}

export function emitLive(e: LiveEvent) {
  for (const cb of st().hooks)
    queueMicrotask(() => {
      try {
        cb(e);
      } catch (err) {
        console.warn("[live] hook failed", (err as Error).message);
      }
    });
}
export function liveHooks() {
  return st().hooks;
}

// Один движок на процесс (globalThis): у Next разные графы модулей, а очереди и блокировки должны быть общими.
export function liveEngine(): LiveEngine | null {
  const s = st();
  if (s.engine) return s.engine;
  const db = liveDb();
  if (!db) return null;
  const cfg = liveConfig();
  s.engine = createLiveEngine({
    db,
    cfg: () => liveConfig(),
    master: masterKey,
    rpc: liveRpc,
    jupiter: jupiterClient(cfg.jupiterBases, cfg.jupiterKey),
    treasury: BUYBACK_TREASURY,
    killed: () => liveKill().on,
    tierOk,
    paperOpen,
    exits: (id) => STRATEGIES.find((x) => x.id === id)?.exits,
    prices,
    alert: (key, text, everyMs) => opsAlert(key, text, everyMs),
    emit: emitLive,
  });
  return s.engine;
}

// Ошибки ядра в ошибки API.
export async function liveCall<T>(fn: (e: LiveEngine) => T | Promise<T>): Promise<T> {
  const e = liveEngine();
  if (!e) throw new ApiError("Live trading storage is unavailable", 503);
  try {
    return await fn(e);
  } catch (err) {
    if (err instanceof LiveError) throw new ApiError(err.message, err.status);
    throw err;
  }
}

// ---------- действия владельца ----------

export const createLiveWallet = (owner: string, ip: string | null) => liveCall((e) => e.createWallet(owner, ip));

// Выдача ключа: кроме сессии нужна свежая подпись кошелька владельца под "CrawlHive export key <nonce>"
// (nonce одноразовый, живёт 5 минут). Украденного токена сессии мало, чтобы унести ключ.
export const EXPORT_PURPOSE = "export key";
export const exportNonce = (owner: string) => issueActionNonce(owner, EXPORT_PURPOSE);
export const exportLiveKey = (owner: string, confirm: unknown, proof: { nonce?: unknown; signature?: unknown }, ip: string | null) =>
  liveCall((e) => {
    if (confirm !== true) throw new ApiError("Set confirm to true to export the private key");
    verifyActionSignature(owner, EXPORT_PURPOSE, proof.nonce, proof.signature);
    return e.exportKey(owner, confirm, ip);
  });
export const withdrawLive = (owner: string, b: Record<string, unknown>, ip: string | null) => liveCall((e) => e.withdraw(owner, b, ip));
