// On-chain оплата спавна. Два режима, переключаются PAYMENT_TOKEN:
//   sol   — фаза 1, до запуска токена: перевод SOL в казну проекта (будущий байбек токена);
//   token — фаза 2, после запуска токена: burnChecked токена проекта из кошелька пользователя.
// Без PAYMENT_TOKEN сеть работает на симулированных сжиганиях (см. store.ts).
//
// Схема одна для обоих режимов: сервер собирает неподписанную транзакцию с memo «crawlhive:spawn:<id>»,
// Phantom подписывает и отправляет, сервер находит транзакцию в сети и проверяет каждую деталь.
import "server-only";
import { limitedFetch } from "./rpc-limit";
import { randomBytes } from "node:crypto";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type ParsedTransactionWithMeta,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createBurnCheckedInstruction,
  createMintToCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { BUYBACK_TREASURY, SOL_INCINERATOR, TIERS, TIER_PRICE_SOL } from "../economy";
import type { PaymentMode, PublicConfig, Tier } from "../types";
import { ApiError, demoNetwork, isSigUsed, markSigUsed, termDays, type SpawnInput } from "./store";
import { telegramBotName } from "./telegram";
import { ethConfig } from "./robinhood";
import { SPAWN_BURN_DISCOUNT_PCT } from "../burn-math";

export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const INTENT_TTL_MS = 10 * 60_000;
const FAUCET_TOKENS = 250_000;
const FAUCET_SOL_FEES = 0.05; // режим token: SOL только на комиссии
const FAUCET_SOL_SPAWN = 1; // режим sol: хватает на пару спавнов Worker
const FAUCET_COOLDOWN_MS = 10 * 60_000;
const FEE_RESERVE_SOL = 0.00002;

// ---------- конфиг ----------

function env() {
  const raw = process.env.PAYMENT_TOKEN?.trim().toLowerCase();
  const mint = process.env.TOKEN_MINT?.trim() || null;
  let payment: PaymentMode = raw === "sol" ? "sol" : raw === "token" ? "token" : "simulated";
  if (payment === "token" && !mint) {
    console.warn("PAYMENT_TOKEN=token without TOKEN_MINT, falling back to simulated burns");
    payment = "simulated";
  }
  return {
    payment,
    mint,
    cluster: process.env.SOLANA_CLUSTER?.trim() || "devnet",
    rpc: process.env.SOLANA_RPC_URL?.trim() || "https://api.devnet.solana.com",
    decimals: Number(process.env.TOKEN_DECIMALS ?? 6),
    symbol: process.env.TOKEN_SYMBOL?.trim() || "TOKEN",
    solRecipient: process.env.SPAWN_SOL_RECIPIENT?.trim() || BUYBACK_TREASURY,
    // Секретный ключ кошелька-фосета, JSON-массив байт (как в файле solana-keygen). Только для devnet.
    faucetKey: process.env.DEVNET_FAUCET_SECRET?.trim() || null,
    solPrices: solPrices(),
  };
}

// SPAWN_PRICE_SOL="0.001,0.002,0.003,0.005" (larva,worker,soldier,queen) переопределяет TIER_PRICE_SOL —
// например, для теста на mainnet с копеечными суммами.
function solPrices(): Record<Tier, number> {
  const raw = process.env.SPAWN_PRICE_SOL?.trim();
  if (!raw) return TIER_PRICE_SOL;
  const v = raw.split(",").map((x) => Number(x.trim()));
  if (v.length !== 4 || v.some((x) => !(x > 0 && x < 1000))) {
    console.warn("SPAWN_PRICE_SOL must be 4 positive numbers, using defaults");
    return TIER_PRICE_SOL;
  }
  return { larva: v[0], worker: v[1], soldier: v[2], queen: v[3] };
}

// Спавн и продление можно оплатить сжиганием $CRAWLHIVE со скидкой: только когда основной путь платит реальным SOL
// (PAYMENT_TOKEN=sol), токен запущен (TOKEN_MINT) и сеть mainnet, где у токена есть рыночная цена.
export function spawnBurnEnabled() {
  const e = env();
  return e.payment === "sol" && !!e.mint && e.cluster === "mainnet-beta";
}

export function isOnchain() {
  return env().payment !== "simulated";
}

export function publicConfig(): PublicConfig {
  const e = env();
  return {
    payment: e.payment,
    cluster: e.cluster,
    mint: e.payment === "token" ? e.mint : null,
    symbol: e.payment === "token" ? e.symbol : null,
    decimals: e.decimals,
    solRecipient: e.payment === "sol" ? e.solRecipient : null,
    solBurned: e.payment === "sol" && e.solRecipient === SOL_INCINERATOR,
    buyback: e.payment === "sol" && e.solRecipient === BUYBACK_TREASURY,
    prices:
      e.payment === "sol"
        ? e.solPrices
        : { larva: TIERS.larva.burn, worker: TIERS.worker.burn, soldier: TIERS.soldier.burn, queen: TIERS.queen.burn },
    // Фосет только на devnet и только если у сервера есть ключ кошелька-фосета.
    faucet: e.payment !== "simulated" && e.cluster === "devnet" && !!e.faucetKey,
    termDays: termDays(),
    demoNetwork: demoNetwork(),
    telegramBot: telegramBotName(),
    eth: ethConfig(),
    spawnBurn: spawnBurnEnabled() ? { discountPct: SPAWN_BURN_DISCOUNT_PCT, mint: e.mint! } : null,
  };
}

// Цена спавна в текущем режиме: для UI и для сверки суммы.
export function spawnPrice(tier: Tier): { amount: number; unit: string } {
  const e = env();
  return e.payment === "sol" ? { amount: e.solPrices[tier], unit: "SOL" } : { amount: TIERS[tier].burn, unit: e.symbol };
}

// ---------- состояние (на globalThis, как и store) ----------

interface Intent {
  id: string;
  kind: IntentKind;
  wallet: string;
  input?: SpawnInput; // для спавна
  crawlerId?: string; // для продления
  payment: "sol" | "token";
  amountRaw: bigint; // лампорты или минимальные единицы токена
  createdAt: number;
  used: boolean;
}

const g = globalThis as unknown as {
  __crawlhiveChain?: {
    conn: Connection;
    rpc: string;
    intents: Map<string, Intent>;
    mintProgram?: PublicKey;
    faucetAt: Map<string, number>;
  };
};

function chain() {
  const e = env();
  if (!g.__crawlhiveChain || g.__crawlhiveChain.rpc !== e.rpc) {
    g.__crawlhiveChain = {
      // Свой ограничитель вместо слепых повторов web3.js на 429 (см. rpc-limit.ts).
      conn: new Connection(e.rpc, { commitment: "confirmed", fetch: limitedFetch, disableRetryOnRateLimit: true }),
      rpc: e.rpc,
      intents: new Map(),
      faucetAt: new Map(),
    };
  }
  return g.__crawlhiveChain;
}

function mintKey(): PublicKey {
  const m = env().mint;
  if (!m) throw new ApiError("Project token mint is not configured", 400);
  return new PublicKey(m);
}

// Классический SPL Token или Token-2022: смотрим, какой программе принадлежит минт.
async function mintProgram(): Promise<PublicKey> {
  const c = chain();
  if (c.mintProgram) return c.mintProgram;
  const info = await c.conn.getAccountInfo(mintKey());
  if (!info) throw new ApiError("Project token mint not found on this cluster", 500);
  if (!info.owner.equals(TOKEN_PROGRAM_ID) && !info.owner.equals(TOKEN_2022_PROGRAM_ID))
    throw new ApiError("TOKEN_MINT is not a token mint", 500);
  c.mintProgram = info.owner;
  return info.owner;
}

const tokensToRaw = (tokens: number) => BigInt(tokens) * BigInt(10) ** BigInt(env().decimals);
const solToLamports = (sol: number) => BigInt(Math.round(sol * LAMPORTS_PER_SOL));

// ---------- балансы ----------

export async function onchainBalances(wallet: string): Promise<{ tokens: number; sol: number }> {
  const c = chain();
  const owner = new PublicKey(wallet);
  const lamports = await c.conn.getBalance(owner);
  let tokens = 0;
  if (env().payment === "token") {
    const accounts = await c.conn.getParsedTokenAccountsByOwner(owner, { mint: mintKey() });
    let raw = BigInt(0);
    for (const a of accounts.value) raw += BigInt(a.account.data.parsed.info.tokenAmount.amount);
    tokens = Number(raw) / 10 ** env().decimals;
  }
  return { tokens, sol: lamports / LAMPORTS_PER_SOL };
}

// ---------- оплата: намерение → подпись в кошельке → проверка ----------
// Через намерения идут спавн и продление краулера. Memo в транзакции привязывает оплату к намерению.

export type IntentKind = "spawn" | "renew";

export function intentMemo(id: string, kind: IntentKind = "spawn") {
  return `crawlhive:${kind}:${id}`;
}

function memoIx(owner: PublicKey, id: string, kind: IntentKind) {
  // Подписант в memo: программа memo сама проверит, что его подписал владелец кошелька.
  return new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: [{ pubkey: owner, isSigner: true, isWritable: false }],
    data: Buffer.from(intentMemo(id, kind), "utf8"),
  });
}

export function createSpawnIntent(wallet: string, input: SpawnInput) {
  return createIntent(wallet, input.tier, { kind: "spawn", input });
}

// Продление стоит столько же, сколько спавн того же тира, и добавляет ещё один срок работы.
export function createRenewIntent(wallet: string, crawlerId: string, tier: Tier) {
  return createIntent(wallet, tier, { kind: "renew", crawlerId });
}

async function createIntent(
  wallet: string,
  tier: Tier,
  what: { kind: "spawn"; input: SpawnInput } | { kind: "renew"; crawlerId: string },
) {
  const e = env();
  if (e.payment === "simulated") throw new ApiError("On-chain payment is not enabled", 400);
  const c = chain();
  const owner = new PublicKey(wallet);
  const { tokens, sol } = await onchainBalances(wallet);
  const price = spawnPrice(tier);

  const id = randomBytes(9).toString("base64url");
  const { blockhash, lastValidBlockHeight } = await c.conn.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: owner, blockhash, lastValidBlockHeight });
  let amountRaw: bigint;

  if (e.payment === "sol") {
    amountRaw = solToLamports(price.amount);
    if (sol < price.amount + FEE_RESERVE_SOL)
      throw new ApiError(`Not enough SOL: need ${price.amount} + fee, have ${sol.toFixed(4)}`);
    tx.add(SystemProgram.transfer({ fromPubkey: owner, toPubkey: new PublicKey(e.solRecipient), lamports: amountRaw }));
  } else {
    const mint = mintKey();
    const program = await mintProgram();
    amountRaw = tokensToRaw(price.amount);
    if (tokensToRaw(Math.floor(tokens)) < amountRaw)
      throw new ApiError(`Not enough ${e.symbol} in your wallet: need ${price.amount.toLocaleString()}, have ${Math.floor(tokens).toLocaleString()}`);
    if (sol < FEE_RESERVE_SOL) throw new ApiError("Your wallet has no SOL to pay the network fee");
    const ata = getAssociatedTokenAddressSync(mint, owner, false, program);
    tx.add(createBurnCheckedInstruction(ata, mint, owner, amountRaw, e.decimals, [], program));
  }
  tx.add(memoIx(owner, id, what.kind));

  // Чистим протухшие намерения.
  const now = Date.now();
  for (const [k, v] of c.intents) if (now - v.createdAt > INTENT_TTL_MS) c.intents.delete(k);
  c.intents.set(id, { id, ...what, wallet, payment: e.payment, amountRaw, createdAt: now, used: false });

  return {
    intentId: id,
    transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
    amount: price.amount,
    unit: price.unit,
    expiresAt: now + INTENT_TTL_MS,
  };
}

// Сумма, которую транзакция действительно перевела на получателя (sol) или сожгла (token) от имени кошелька.
async function paidAmount(tx: ParsedTransactionWithMeta, wallet: string, payment: "sol" | "token"): Promise<bigint> {
  let total = BigInt(0);
  const e = env();
  const program = payment === "token" ? (await mintProgram()).toBase58() : SystemProgram.programId.toBase58();
  for (const ix of tx.transaction.message.instructions) {
    if (ix.programId.toBase58() !== program || !("parsed" in ix)) continue;
    const { type, info } = ix.parsed ?? {};
    if (payment === "sol") {
      if (type === "transfer" && info.source === wallet && info.destination === e.solRecipient) total += BigInt(info.lamports);
    } else if (type === "burn" || type === "burnChecked") {
      const authority = info.authority ?? info.multisigAuthority;
      if (info.mint === e.mint && authority === wallet) total += BigInt(info.tokenAmount?.amount ?? info.amount);
    }
  }
  return total;
}

export async function verifySpawnPayment(wallet: string, intentId: string, signature: string) {
  const r = await verifyPayment(wallet, intentId, signature, "spawn");
  return { ...r, input: r.intent.input! };
}

export async function verifyRenewPayment(wallet: string, intentId: string, signature: string, crawlerId: string) {
  const c = chain().intents.get(intentId);
  if (c && c.crawlerId !== crawlerId) throw new ApiError("This payment is for another crawler");
  return verifyPayment(wallet, intentId, signature, "renew");
}

// Ждём транзакцию в RPC (она может появиться с задержкой) и проверяем, что это ровно наша оплата.
async function verifyPayment(wallet: string, intentId: string, signature: string, kind: IntentKind) {
  const c = chain();
  const intent = c.intents.get(intentId);
  if (!intent || intent.kind !== kind) throw new ApiError("Payment intent expired or unknown, start again");
  if (intent.wallet !== wallet) throw new ApiError("Intent belongs to another wallet", 403);
  if (intent.used) throw new ApiError("This intent was already used");
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(signature)) throw new ApiError("Bad signature");
  if (isSigUsed(signature)) throw new ApiError("This transaction was already used");
  // Занимаем намерение до сетевых запросов: второй параллельный confirm не должен пройти по той же оплате.
  intent.used = true;
  try {
    let tx: ParsedTransactionWithMeta | null = null;
    for (let i = 0; i < 20 && !tx; i++) {
      tx = await c.conn.getParsedTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      if (!tx) await new Promise((r) => setTimeout(r, 1500));
    }
    if (!tx) throw new ApiError(`Transaction not found on ${env().cluster}. Is your wallet on the same network?`, 404);
    if (tx.meta?.err) throw new ApiError("Transaction failed on-chain, nothing was paid");

    const signer = tx.transaction.message.accountKeys.find((k) => k.signer && k.pubkey.toBase58() === wallet);
    if (!signer) throw new ApiError("Transaction was not signed by your wallet", 403);

    const memoOk = tx.transaction.message.instructions.some(
      (ix) => ix.programId.equals(MEMO_PROGRAM_ID) && "parsed" in ix && ix.parsed === intentMemo(intentId, kind),
    );
    if (!memoOk) throw new ApiError("Transaction is not linked to this payment (memo missing)");

    const paid = await paidAmount(tx, wallet, intent.payment);
    if (paid < intent.amountRaw)
      throw new ApiError(intent.payment === "sol" ? "Transaction paid less SOL than the tier costs" : `Transaction burned less ${env().symbol} than the tier requires`);
    if (isSigUsed(signature)) throw new ApiError("This transaction was already used");

    markSigUsed(signature);
    return {
      intent,
      payment: intent.payment,
      // В статистику сети «сожжённого» идёт только реальное сжигание токена проекта.
      burnedTokens: intent.payment === "token" ? Number(paid / BigInt(10) ** BigInt(env().decimals)) : 0,
      paidSol: intent.payment === "sol" ? Number(paid) / LAMPORTS_PER_SOL : 0,
      symbol: env().symbol,
    };
  } catch (e) {
    intent.used = false; // проверка не прошла — можно повторить с правильной транзакцией
    throw e;
  }
}

// Общее подключение к RPC для других модулей (скан токенов).
export const rpcConnection = () => chain().conn;

// Баланс казны (куда идёт SOL за спавны) для счётчика на главной. Кэш на 2 минуты, чтобы не дёргать RPC.
export async function treasuryBalance(): Promise<number | null> {
  const e = env();
  if (e.payment !== "sol") return null;
  const c = chain() as ReturnType<typeof chain> & { treasury?: { at: number; sol: number } };
  if (c.treasury && Date.now() - c.treasury.at < 120_000) return c.treasury.sol;
  try {
    const sol = (await c.conn.getBalance(new PublicKey(e.solRecipient))) / LAMPORTS_PER_SOL;
    c.treasury = { at: Date.now(), sol };
    return sol;
  } catch {
    return c.treasury?.sol ?? null;
  }
}

// Цена SOL в долларах для счётчика казны: Jupiter, запасной — CoinGecko; кэш 5 минут.
const SOL_MINT = "So11111111111111111111111111111111111111112";
const solUsdCache = globalThis as unknown as { __crawlhiveSolUsd?: { at: number; usd: number } };
export async function solUsd(): Promise<number | null> {
  const c = solUsdCache.__crawlhiveSolUsd;
  if (c && Date.now() - c.at < 5 * 60_000) return c.usd;
  const sources: [string, (j: unknown) => unknown][] = [
    [`https://lite-api.jup.ag/price/v3?ids=${SOL_MINT}`, (j) => (j as Record<string, { usdPrice?: number }>)[SOL_MINT]?.usdPrice],
    ["https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd", (j) => (j as { solana?: { usd?: number } }).solana?.usd],
  ];
  for (const [url, pick] of sources) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const usd = Number(pick(await r.json()));
      if (usd > 0) {
        solUsdCache.__crawlhiveSolUsd = { at: Date.now(), usd };
        return usd;
      }
    } catch {}
  }
  return c?.usd ?? null;
}

// ---------- devnet-фосет ----------

function faucetKeypair(): Keypair {
  const secret = env().faucetKey;
  if (!secret) throw new ApiError("Faucet is not configured", 400);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret)));
}

// Режим sol: даёт тестовый SOL на спавн. Режим token: тестовые токены проекта плюс немного SOL на комиссию.
export async function faucet(wallet: string) {
  if (!publicConfig().faucet) throw new ApiError("Faucet works on devnet only", 400);
  const c = chain();
  const last = c.faucetAt.get(wallet) ?? 0;
  if (Date.now() - last < FAUCET_COOLDOWN_MS)
    throw new ApiError(`Faucet cooldown: try again in ${Math.ceil((FAUCET_COOLDOWN_MS - (Date.now() - last)) / 60000)} min`, 429);

  const authority = faucetKeypair();
  const owner = new PublicKey(wallet);
  const tx = new Transaction();
  let tokens = 0;
  let sol = 0;

  if (env().payment === "sol") {
    sol = FAUCET_SOL_SPAWN;
  } else {
    const mint = mintKey();
    const program = await mintProgram();
    const ata = getAssociatedTokenAddressSync(mint, owner, false, program);
    tx.add(createAssociatedTokenAccountIdempotentInstruction(authority.publicKey, ata, owner, mint, program));
    tx.add(createMintToCheckedInstruction(mint, ata, authority.publicKey, tokensToRaw(FAUCET_TOKENS), env().decimals, [], program));
    tokens = FAUCET_TOKENS;
    if ((await c.conn.getBalance(owner)) < 0.01 * LAMPORTS_PER_SOL) sol = FAUCET_SOL_FEES;
  }
  if (sol)
    tx.add(SystemProgram.transfer({ fromPubkey: authority.publicKey, toPubkey: owner, lamports: Math.round(sol * LAMPORTS_PER_SOL) }));

  c.faucetAt.set(wallet, Date.now());
  try {
    const sig = await c.conn.sendTransaction(tx, [authority]);
    await c.conn.confirmTransaction(sig, "confirmed");
    return { signature: sig, tokens, sol };
  } catch (err) {
    c.faucetAt.delete(wallet);
    console.error("faucet", err);
    throw new ApiError("Faucet transaction failed. The faucet wallet may be out of devnet SOL.", 502);
  }
}
