// Robinhood Chain (EVM L2, chain id 4663): оплата спавна и продления в ETH и вход кошельком EVM (MetaMask, Rabby).
// Схема та же, что у SOL: сервер создаёт намерение, кошелёк отправляет перевод ETH в казну с data «crawlhive:spawn:<id>»,
// сервер находит транзакцию в сети и сверяет отправителя, получателя, сумму и data. Включается адресом SPAWN_ETH_RECIPIENT.
import "server-only";
import { randomBytes } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { TIER_PRICE_ETH } from "../economy";
import type { EthConfig, Tier } from "../types";
import { ApiError, isSigUsed, markSigUsed, type SpawnInput } from "./store";
import { intentMemo, type IntentKind } from "./solana";

export const RH_CHAIN_ID = 4663;
const INTENT_TTL_MS = 10 * 60_000;
const GAS_RESERVE_ETH = 0.00005; // перевод с data на L2 стоит доли цента, держим запас

const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
export const isEvmAddress = (a: string) => EVM_RE.test(a);

function env() {
  const recipient = process.env.SPAWN_ETH_RECIPIENT?.trim().toLowerCase() || null;
  return {
    rpc: process.env.ROBINHOOD_RPC_URL?.trim() || "https://rpc.mainnet.chain.robinhood.com",
    recipient: recipient && isEvmAddress(recipient) ? recipient : null,
    prices: ethPrices(),
  };
}

// SPAWN_PRICE_ETH="0.002,0.008,0.03,0.1" (larva,worker,soldier,queen) переопределяет TIER_PRICE_ETH.
function ethPrices(): Record<Tier, number> {
  const raw = process.env.SPAWN_PRICE_ETH?.trim();
  if (!raw) return TIER_PRICE_ETH;
  const v = raw.split(",").map((x) => Number(x.trim()));
  if (v.length !== 4 || v.some((x) => !(x > 0 && x < 100))) {
    console.warn("SPAWN_PRICE_ETH must be 4 positive numbers, using defaults");
    return TIER_PRICE_ETH;
  }
  return { larva: v[0], worker: v[1], soldier: v[2], queen: v[3] };
}

export const ethEnabled = () => !!env().recipient;

export function ethConfig(): EthConfig | null {
  const e = env();
  if (!e.recipient) return null;
  return {
    chainId: RH_CHAIN_ID,
    chainName: "Robinhood Chain",
    rpc: "https://rpc.mainnet.chain.robinhood.com",
    explorer: "https://robin.etherscan.io",
    recipient: e.recipient,
    prices: e.prices,
  };
}

export async function evmRpc<T>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch(env().rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  const j = (await r.json()) as { result?: T; error?: { message?: string } };
  if (j.error) throw new Error(j.error.message ?? method);
  return j.result as T;
}

const WEI = BigInt(10) ** BigInt(18);
const ethToWei = (eth: number) => (BigInt(Math.round(eth * 1e9)) * WEI) / BigInt(1e9);
const weiToEth = (wei: bigint) => Number((wei * BigInt(1e9)) / WEI) / 1e9;
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export async function ethBalance(address: string): Promise<number> {
  return weiToEth(BigInt(await evmRpc<string>("eth_getBalance", [address, "latest"])));
}

// ---------- вход: personal_sign ----------

// Адрес, который подписал сообщение (EIP-191 personal_sign), в нижнем регистре.
export function recoverEvmSigner(message: string, signature: Uint8Array): string {
  if (signature.length !== 65) throw new Error("bad signature length");
  const msg = new TextEncoder().encode(message);
  const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${msg.length}`);
  const hash = keccak_256(new Uint8Array([...prefix, ...msg]));
  const v = signature[64];
  const rec = v >= 27 ? v - 27 : v;
  const pub = secp256k1.Signature.fromCompact(signature.slice(0, 64)).addRecoveryBit(rec).recoverPublicKey(hash).toRawBytes(false);
  return `0x${toHex(keccak_256(pub.slice(1)).slice(-20))}`;
}

// ---------- оплата ----------

interface EthIntent {
  id: string;
  kind: IntentKind;
  wallet: string;
  input?: SpawnInput;
  crawlerId?: string;
  amountWei: bigint;
  amount: number;
  createdAt: number;
  used: boolean;
}

interface EthState {
  intents: Map<string, EthIntent>;
  treasury?: { at: number; eth: number };
}
const g = globalThis as unknown as { __crawlhiveEth?: EthState };
const st = (): EthState => (g.__crawlhiveEth ??= { intents: new Map() });

export function createEthSpawnIntent(wallet: string, input: SpawnInput) {
  return createEthIntent(wallet, input.tier, { kind: "spawn", input });
}

export function createEthRenewIntent(wallet: string, crawlerId: string, tier: Tier) {
  return createEthIntent(wallet, tier, { kind: "renew", crawlerId });
}

async function createEthIntent(wallet: string, tier: Tier, what: { kind: "spawn"; input: SpawnInput } | { kind: "renew"; crawlerId: string }) {
  const e = env();
  if (!e.recipient) throw new ApiError("ETH payments on Robinhood Chain are not enabled yet", 400);
  const amount = e.prices[tier];
  const balance = await ethBalance(wallet).catch(() => null);
  if (balance !== null && balance < amount + GAS_RESERVE_ETH)
    throw new ApiError(`Not enough ETH on Robinhood Chain: need ${amount} + gas, have ${balance.toFixed(5)}`);

  const id = randomBytes(9).toString("base64url");
  const amountWei = ethToWei(amount);
  const now = Date.now();
  const s = st();
  for (const [k, v] of s.intents) if (now - v.createdAt > INTENT_TTL_MS) s.intents.delete(k);
  s.intents.set(id, { id, ...what, wallet, amountWei, amount, createdAt: now, used: false });

  return {
    intentId: id,
    // Поля для eth_sendTransaction: перевод ETH в казну, data — memo намерения в UTF-8.
    evm: {
      chainId: RH_CHAIN_ID,
      to: e.recipient,
      value: `0x${amountWei.toString(16)}`,
      data: `0x${Buffer.from(intentMemo(id, what.kind), "utf8").toString("hex")}`,
    },
    amount,
    unit: "ETH",
    expiresAt: now + INTENT_TTL_MS,
  };
}

interface EvmTx {
  from: string;
  to: string | null;
  value: string;
  input: string;
  chainId?: string;
}

export async function verifyEthSpawnPayment(wallet: string, intentId: string, hash: string) {
  const r = await verifyEthPayment(wallet, intentId, hash, "spawn");
  return { ...r, input: r.intent.input! };
}

export async function verifyEthRenewPayment(wallet: string, intentId: string, hash: string, crawlerId: string) {
  const i = st().intents.get(intentId);
  if (i && i.crawlerId !== crawlerId) throw new ApiError("This payment is for another crawler");
  return verifyEthPayment(wallet, intentId, hash, "renew");
}

async function verifyEthPayment(wallet: string, intentId: string, hash: string, kind: IntentKind) {
  const e = env();
  const intent = st().intents.get(intentId);
  if (!intent || intent.kind !== kind) throw new ApiError("Payment intent expired or unknown, start again");
  if (intent.wallet !== wallet) throw new ApiError("Intent belongs to another wallet", 403);
  if (intent.used) throw new ApiError("This intent was already used");
  const h = hash.toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(h)) throw new ApiError("Bad transaction hash");
  if (isSigUsed(h)) throw new ApiError("This transaction was already used");
  intent.used = true;
  try {
    // Ждём, пока транзакция попадёт в блок: на L2 это секунды.
    let receipt: { status: string } | null = null;
    for (let i = 0; i < 30 && !receipt; i++) {
      receipt = await evmRpc<{ status: string } | null>("eth_getTransactionReceipt", [h]).catch(() => null);
      if (!receipt) await new Promise((r) => setTimeout(r, 1500));
    }
    if (!receipt) throw new ApiError("Transaction not found on Robinhood Chain. Is your wallet on that network?", 404);
    if (receipt.status !== "0x1") throw new ApiError("Transaction failed on-chain, nothing was paid");
    const tx = await evmRpc<EvmTx | null>("eth_getTransactionByHash", [h]);
    if (!tx) throw new ApiError("Transaction not found on Robinhood Chain", 404);
    if (tx.chainId && Number(tx.chainId) !== RH_CHAIN_ID) throw new ApiError("Transaction is not on Robinhood Chain");
    if (tx.from.toLowerCase() !== wallet) throw new ApiError("Transaction was not sent from your wallet", 403);
    if (tx.to?.toLowerCase() !== e.recipient) throw new ApiError("Transaction was not sent to the CrawlHive treasury");
    const memo = `0x${Buffer.from(intentMemo(intentId, kind), "utf8").toString("hex")}`;
    if (tx.input.toLowerCase() !== memo) throw new ApiError("Transaction is not linked to this payment (data missing)");
    const paid = BigInt(tx.value);
    if (paid < intent.amountWei) throw new ApiError("Transaction paid less ETH than the tier costs");
    if (isSigUsed(h)) throw new ApiError("This transaction was already used");
    markSigUsed(h);
    return { intent, paidEth: weiToEth(paid), tx: h };
  } catch (err) {
    intent.used = false;
    throw err;
  }
}

// ---------- казна ----------

export async function ethTreasuryBalance(): Promise<number | null> {
  const e = env();
  if (!e.recipient) return null;
  const s = st();
  if (s.treasury && Date.now() - s.treasury.at < 60_000) return s.treasury.eth;
  try {
    const eth = await ethBalance(e.recipient);
    s.treasury = { at: Date.now(), eth };
    return eth;
  } catch {
    return s.treasury?.eth ?? null;
  }
}

// Цена ETH в долларах: Jupiter (wrapped ETH на Solana), запасной — CoinGecko; кэш 5 минут.
const WETH_SOL = "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs";
const usdCache = globalThis as unknown as { __crawlhiveEthUsd?: { at: number; usd: number } };
export async function ethUsd(): Promise<number | null> {
  const c = usdCache.__crawlhiveEthUsd;
  if (c && Date.now() - c.at < 5 * 60_000) return c.usd;
  const sources: [string, (j: unknown) => unknown][] = [
    [`https://lite-api.jup.ag/price/v3?ids=${WETH_SOL}`, (j) => (j as Record<string, { usdPrice?: number }>)[WETH_SOL]?.usdPrice],
    ["https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd", (j) => (j as { ethereum?: { usd?: number } }).ethereum?.usd],
  ];
  for (const [url, pick] of sources) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const usd = Number(pick(await r.json()));
      if (usd > 0) {
        usdCache.__crawlhiveEthUsd = { at: Date.now(), usd };
        return usd;
      }
    } catch {}
  }
  return c?.usd ?? null;
}
