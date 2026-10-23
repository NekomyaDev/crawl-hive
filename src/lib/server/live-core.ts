// Живая торговля: ядро без Next и без состояния сайта. Шифрование ключей, математика комиссии, лимиты,
// клиент Jupiter, разбор транзакций и движок исполнения с внедрёнными зависимостями (база, RPC, Jupiter, цены).
// Файл нарочно не импортирует server-only и алиасы @/: локальные тесты гоняют его через node --experimental-strip-types
// с поддельными RPC и Jupiter. Подключают ядро live-wallets.ts (хранение ключей) и live-trader.ts (сделки по сигналам).
//
// Модель хранения: на каждый кошелёк владельца сервер держит один торговый кошелёк. Секрет зашифрован AES-256-GCM
// мастер-ключом из env (LIVE_WALLET_MASTER_KEY), IV случайный на каждую запись, AAD привязывает шифротекст к паре
// владелец + адрес: подменить запись другой строкой из базы нельзя, расшифровка упадёт. Расшифровка только внутри
// подписи (withKey) и выдачи ключа владельцу; секрет не пишется в лог и не уходит в ответы API.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Keypair, PublicKey, SystemProgram, Transaction, VersionedTransaction, type Connection, type TransactionInstruction } from "@solana/web3.js";
import {
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import type { DatabaseSync } from "node:sqlite";

// ---------- константы ----------

// Стратегии, по которым разрешена живая торговля: самые устойчивые на бумаге. Новая = новый id здесь.
export const LIVE_STRATEGIES = ["s12", "s19", "s40"] as const;
export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const LAMPORTS = 1_000_000_000;
const TX_FEE = 5000; // базовая комиссия за одну подпись
const RENT_MIN = 890_880; // минимум на системном аккаунте без данных, меньше нельзя (кроме ровно нуля)
const DAY = 86_400_000;
const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const JUPITER_V6 = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const SYSTEM = SystemProgram.programId.toBase58();

// base58 (алфавит Bitcoin): подписи транзакций и экспорт ключа в формате Phantom. Свой, чтобы не тянуть типы bs58.
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function b58encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}
const bs58 = { encode: b58encode };

export const sol = (lamports: number) => Math.round(lamports) / LAMPORTS;
export const lamportsOf = (s: number) => Math.round(s * LAMPORTS);
export const utcDayStart = (t: number) => Math.floor(t / DAY) * DAY;

// Ошибка с HTTP-статусом: обёртки превращают её в ApiError, ядро о Next не знает.
export class LiveError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

// ---------- настройки из env ----------

export type LiveMode = "off" | "dryrun" | "live";
type Env = Record<string, string | undefined>;

export function liveMode(env: Env = process.env): LiveMode {
  const v = env.LIVE_TRADING?.trim().toLowerCase();
  return v === "live" ? "live" : v === "dryrun" ? "dryrun" : "off";
}

const posNum = (v: string | undefined, d: number) => {
  if (v === undefined || v.trim() === "") return d;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};
const nonNeg = (v: string | undefined, d: number) => {
  if (v === undefined || v.trim() === "") return d;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : d;
};

export interface LiveConfig {
  mode: LiveMode;
  maxWalletSol: number; // выше этого баланса новые входы стоят: на сервере не держим больше, чем готовы рисковать
  maxTradeSol: number;
  minTradeSol: number;
  defaultTradeSol: number;
  maxOpen: number; // открытых позиций на пользователя
  dailyLossSol: number; // реализованный убыток за UTC-сутки, после которого входы стоят до следующих суток
  feeReserveSol: number; // остаётся в кошельке на комиссии продаж
  profitFeePct: number; // доля прибыли сделки в казну
  buybackSharePct: number; // доля комиссии, помеченная в журнале под байбек и сжигание
  defaultSlippagePct: number;
  maxSlippagePct: number; // потолок, который может выставить пользователь
  sellMaxSlippagePct: number; // потолок для повторов продажи
  sellSlippageStepPct: number;
  maxPriorityLamports: number;
  maxImpactPct: number; // покупка с влиянием на цену выше этого отменяется
  concurrency: number; // одновременных сделок на весь сервер
  feeMinSol: number; // комиссии копятся до этой суммы, потом один перевод в казну
  exportsPerDay: number;
  withdrawsPerDay: number;
  confirmMaxMs: number;
  jupiterBases: string[];
  jupiterKey: string | null;
  extraPrograms: string[]; // дополнительные программы, разрешённые в транзакции свапа (проверка guardSwapTx)
}

export function liveConfig(env: Env = process.env): LiveConfig {
  const maxTradeSol = posNum(env.LIVE_MAX_TRADE_SOL, 0.5);
  const custom = env.LIVE_JUPITER_URL?.trim().replace(/\/$/, "");
  return {
    mode: liveMode(env),
    maxWalletSol: posNum(env.LIVE_MAX_WALLET_SOL, 5),
    maxTradeSol,
    minTradeSol: Math.min(0.01, maxTradeSol),
    defaultTradeSol: Math.min(0.1, maxTradeSol),
    maxOpen: Math.max(1, Math.floor(posNum(env.LIVE_MAX_OPEN, 10))),
    dailyLossSol: posNum(env.LIVE_DAILY_LOSS_SOL, 1),
    feeReserveSol: posNum(env.LIVE_FEE_RESERVE_SOL, 0.02),
    profitFeePct: Math.min(50, nonNeg(env.LIVE_PROFIT_FEE_PCT, 10)),
    buybackSharePct: 50,
    defaultSlippagePct: 15,
    maxSlippagePct: Math.min(50, posNum(env.LIVE_MAX_SLIPPAGE_PCT, 30)),
    sellMaxSlippagePct: Math.min(90, posNum(env.LIVE_SELL_MAX_SLIPPAGE_PCT, 50)),
    sellSlippageStepPct: 10,
    maxPriorityLamports: Math.floor(posNum(env.LIVE_PRIORITY_MAX_LAMPORTS, 1_000_000)),
    maxImpactPct: posNum(env.LIVE_MAX_IMPACT_PCT, 10),
    concurrency: Math.max(1, Math.floor(posNum(env.LIVE_CONCURRENCY, 4))),
    feeMinSol: posNum(env.LIVE_FEE_MIN_SOL, 0.001),
    exportsPerDay: 3,
    withdrawsPerDay: 20,
    confirmMaxMs: 180_000,
    // lite-api бесплатный и без ключа; api.jup.ag запасной (там нужен JUPITER_API_KEY). Пути у обоих одинаковые.
    jupiterBases: custom ? [custom] : ["https://lite-api.jup.ag/swap/v1", "https://api.jup.ag/swap/v1"],
    jupiterKey: env.JUPITER_API_KEY?.trim() || null,
    extraPrograms: (env.LIVE_EXTRA_PROGRAMS ?? "").split(",").map((x) => x.trim()).filter(Boolean),
  };
}

// ---------- шифрование ----------

// Мастер-ключ: ровно 32 байта в base64. Иначе null, и вся функция выключена.
export function parseMasterKey(raw: string | undefined): Buffer | null {
  const v = raw?.trim();
  if (!v || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(v)) return null;
  const b = Buffer.from(v.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  return b.length === 32 ? b : null;
}

export interface Sealed {
  enc: string;
  iv: string;
  tag: string;
}
export const aadFor = (owner: string, pubkey: string) => `crawlhive:live-wallet:v1:${owner}:${pubkey}`;

export function sealSecret(master: Buffer, secret: Uint8Array, aad: string): Sealed {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", master, iv);
  c.setAAD(Buffer.from(aad));
  const enc = Buffer.concat([c.update(secret), c.final()]);
  return { enc: enc.toString("base64"), iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64") };
}

// Бросает на любой подмене шифротекста, IV, тега или AAD (GCM проверяет тег).
export function openSecret(master: Buffer, s: Sealed, aad: string): Buffer {
  const d = createDecipheriv("aes-256-gcm", master, Buffer.from(s.iv, "base64"));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(Buffer.from(s.tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(s.enc, "base64")), d.final()]);
}

// Затираем секрет внутри Keypair после подписи (web3.js держит ссылку на массив). Лучшее, что можно в JS.
function wipe(kp: Keypair) {
  try {
    (kp as unknown as { _keypair?: { secretKey?: Uint8Array } })._keypair?.secretKey?.fill(0);
  } catch {}
}

// ---------- чистая математика ----------

// Комиссия только с прибыли: profit = выручка продажи минус потраченное на покупку (в лампортах).
// Убыток или ноль: комиссии нет. Половина комиссии помечается в журнале под байбек и сжигание.
export function profitFee(solIn: number, solOut: number, pct: number, buybackSharePct = 50) {
  const profit = Math.round(solOut - solIn);
  if (!(profit > 0) || !(pct > 0)) return { profit, fee: 0, buyback: 0 };
  const fee = Math.floor((profit * pct) / 100);
  return { profit, fee, buyback: Math.floor((fee * buybackSharePct) / 100) };
}

export type EntryBlock =
  | "off"
  | "kill"
  | "disabled"
  | "paused"
  | "strategy"
  | "tier"
  | "max_open"
  | "trade_size"
  | "daily_loss"
  | "balance_unknown"
  | "wallet_above_cap"
  | "low_balance";

export interface EntryCheck {
  mode: LiveMode;
  killed: boolean;
  enabled: boolean;
  paused: boolean;
  strategyOn: boolean;
  tierOk: boolean;
  open: number;
  tradeLamports: number;
  balanceLamports: number | null; // null в dryrun: баланс не проверяется
  dayPnlLamports: number;
  cfg: LiveConfig;
}

// Почему вход нельзя (null: можно). Порядок: глобальные запреты, настройки пользователя, лимиты, деньги.
export function entryBlock(c: EntryCheck): EntryBlock | null {
  const { cfg } = c;
  if (c.mode === "off") return "off";
  if (c.killed) return "kill";
  if (!c.enabled) return "disabled";
  if (c.paused) return "paused";
  if (!c.strategyOn) return "strategy";
  if (!c.tierOk) return "tier";
  if (c.open >= cfg.maxOpen) return "max_open";
  if (c.tradeLamports > lamportsOf(cfg.maxTradeSol) || c.tradeLamports < lamportsOf(cfg.minTradeSol)) return "trade_size";
  if (c.dayPnlLamports <= -lamportsOf(cfg.dailyLossSol)) return "daily_loss";
  if (c.mode === "live") {
    if (c.balanceLamports === null) return "balance_unknown";
    if (c.balanceLamports > lamportsOf(cfg.maxWalletSol)) return "wallet_above_cap";
    if (c.balanceLamports < c.tradeLamports + lamportsOf(cfg.feeReserveSol)) return "low_balance";
  }
  return null;
}

// Владелец: только обычный Solana-кошелёк на кривой (не EVM и не PDA).
export function solanaOwner(owner: string): PublicKey {
  let pk: PublicKey;
  try {
    pk = new PublicKey(owner);
  } catch {
    throw new LiveError("Live trading needs a Solana wallet", 400);
  }
  if (pk.toBase58() !== owner || !PublicKey.isOnCurve(pk.toBytes())) throw new LiveError("Live trading needs a Solana wallet", 400);
  return pk;
}

// Вывод только на кошелёк владельца. Другой адрес в запросе: отказ, а не молчаливая подмена.
export function withdrawDestination(owner: string, to?: unknown): PublicKey {
  const pk = solanaOwner(owner);
  if (to !== undefined && to !== null && to !== "" && to !== owner) throw new LiveError("Withdrawals only go to your own connected wallet", 400);
  return pk;
}

// Десятичная сумма в сырые единицы без потери точности. "all" сюда не попадает.
export function toRaw(amount: unknown, decimals: number): bigint {
  let s: string;
  if (typeof amount === "number") {
    if (!Number.isFinite(amount) || amount <= 0) throw new LiveError("Amount must be a positive number");
    s = amount.toFixed(Math.min(decimals, 20));
  } else if (typeof amount === "string") s = amount.trim();
  else throw new LiveError("Amount must be a positive number or \"all\"");
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new LiveError("Amount must be a positive number or \"all\"");
  const frac = (m[2] ?? "").slice(0, decimals).padEnd(decimals, "0");
  const raw = BigInt(m[1]) * 10n ** BigInt(decimals) + (frac ? BigInt(frac) : 0n);
  if (raw <= 0n) throw new LiveError("Amount must be a positive number");
  return raw;
}

// Лестница проскальзывания для повторов продажи: от настройки пользователя шагами до потолка.
export function sellSlippages(userPct: number, cfg: LiveConfig): number[] {
  const out: number[] = [];
  const start = Math.min(Math.max(1, userPct), cfg.sellMaxSlippagePct);
  for (let p = start; p < cfg.sellMaxSlippagePct; p += cfg.sellSlippageStepPct) out.push(Math.round(p * 100) / 100);
  out.push(cfg.sellMaxSlippagePct);
  return [...new Set(out)];
}

// ---------- проверка транзакции свапа ----------

// Транзакцию собирает Jupiter, а подписывает наш ключ: прежде чем подписать, смотрим, что внутри только свап.
// Плательщик комиссии наш кошелёк, подпись одна, программы из короткого списка; перевод SOL только на свой wSOL,
// из инструкций токен-программы только syncNative и закрытие своего аккаунта с возвратом себе.
export function guardSwapTx(tx: VersionedTransaction, wallet: string, extraPrograms: string[] = []) {
  const m = tx.message;
  const keys = m.staticAccountKeys.map((k) => k.toBase58());
  if (keys[0] !== wallet) throw new LiveError("Swap transaction fee payer is not the trading wallet", 502);
  if (m.header.numRequiredSignatures !== 1) throw new LiveError("Swap transaction asks for extra signers", 502);
  const token = TOKEN_PROGRAM_ID.toBase58();
  const token22 = TOKEN_2022_PROGRAM_ID.toBase58();
  const allowed = new Set([COMPUTE_BUDGET, ATA_PROGRAM, JUPITER_V6, SYSTEM, token, token22, ...extraPrograms]);
  const wsol = getAssociatedTokenAddressSync(NATIVE_MINT, new PublicKey(wallet), false, TOKEN_PROGRAM_ID).toBase58();
  for (const ix of m.compiledInstructions) {
    const prog = keys[ix.programIdIndex];
    if (!prog || !allowed.has(prog)) throw new LiveError(`Swap transaction calls an unexpected program ${prog ?? "?"}`, 502);
    const data = ix.data;
    if (prog === SYSTEM) {
      const kind = data.length >= 4 ? data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24) : -1;
      const dest = keys[ix.accountKeyIndexes[1]];
      if (kind !== 2 || dest !== wsol) throw new LiveError("Swap transaction moves SOL somewhere unexpected", 502);
    } else if (prog === token || prog === token22) {
      const kind = data[0];
      if (kind === 17) continue; // syncNative
      if (kind === 9 && keys[ix.accountKeyIndexes[1]] === wallet) continue; // closeAccount с возвратом себе
      throw new LiveError("Swap transaction has an unexpected token instruction", 502);
    }
  }
}

// ---------- разбор исполненной транзакции ----------

type KeyLike = string | { toBase58(): string } | { pubkey: { toBase58(): string } | string };
const keyStr = (k: KeyLike): string =>
  typeof k === "string" ? k : "pubkey" in k ? (typeof k.pubkey === "string" ? k.pubkey : k.pubkey.toBase58()) : k.toBase58();

interface TokenBal {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string; decimals: number };
}
// Минимум полей getParsedTransaction, которые нам нужны (тесты подсовывают такие объекты).
export interface TxLike {
  transaction: { message: { accountKeys: KeyLike[] } };
  meta: { err: unknown; preBalances: number[]; postBalances: number[]; preTokenBalances?: TokenBal[] | null; postTokenBalances?: TokenBal[] | null } | null;
}

// Реальное исполнение: изменение SOL кошелька (уже с комиссиями сети и арендой) и токенов по минту.
export function fillFromTx(tx: TxLike, wallet: string, mint: string) {
  if (!tx.meta) throw new Error("transaction has no meta");
  const keys = tx.transaction.message.accountKeys.map(keyStr);
  const i = keys.indexOf(wallet);
  if (i < 0) throw new Error("trading wallet is not in the transaction");
  const sum = (list: TokenBal[] | null | undefined) =>
    (list ?? []).filter((b) => b.mint === mint && b.owner === wallet).reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), 0n);
  const any = [...(tx.meta.postTokenBalances ?? []), ...(tx.meta.preTokenBalances ?? [])].find((b) => b.mint === mint);
  return {
    lamportsDelta: tx.meta.postBalances[i] - tx.meta.preBalances[i],
    tokenDelta: sum(tx.meta.postTokenBalances) - sum(tx.meta.preTokenBalances),
    decimals: any?.uiTokenAmount.decimals ?? null,
  };
}

// ---------- Jupiter ----------

export interface JupQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  slippageBps: number;
  priceImpactPct: string;
  [k: string]: unknown;
}
export interface Jupiter {
  quote(p: { inputMint: string; outputMint: string; amount: string; slippageBps: number }): Promise<JupQuote>;
  swap(quote: JupQuote, userPublicKey: string, maxPriorityLamports: number): Promise<{ swapTransaction: string; lastValidBlockHeight: number }>;
}

// Клиент Metis Swap API v1: GET /quote и POST /swap (одинаково на lite-api.jup.ag и api.jup.ag).
export function jupiterClient(bases: string[], key: string | null, f: typeof fetch = fetch): Jupiter {
  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    let last = "";
    for (const base of bases) {
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
        if (key && base.includes("api.jup.ag") && !base.includes("lite-api")) headers["x-api-key"] = key;
        const r = await f(base + path, { ...init, headers, signal: AbortSignal.timeout(15_000) });
        const j = (await r.json().catch(() => ({}))) as T & { error?: string; errorCode?: string };
        if (r.ok && !j.error) return j;
        last = j.error || j.errorCode || `HTTP ${r.status}`;
        // Понятный отказ (нет маршрута, мало ликвидности): запасной адрес ответит то же самое.
        if (r.status >= 400 && r.status < 500 && ![401, 403, 404, 429].includes(r.status)) break;
      } catch (e) {
        last = (e as Error).message;
      }
    }
    throw new LiveError(`Jupiter: ${last}`, 502);
  }
  return {
    async quote(p) {
      const q = new URLSearchParams({ inputMint: p.inputMint, outputMint: p.outputMint, amount: p.amount, slippageBps: String(p.slippageBps), restrictIntermediateTokens: "true" });
      const j = await call<JupQuote>(`/quote?${q}`);
      // Ответ должен быть ровно про наш запрос: другие минты или сумма значат сбой, а не котировку.
      if (j.inputMint !== p.inputMint || j.outputMint !== p.outputMint || j.inAmount !== p.amount || !/^\d+$/.test(String(j.outAmount)))
        throw new LiveError("Jupiter returned a quote for something else", 502);
      return j;
    },
    async swap(quote, userPublicKey, maxPriorityLamports) {
      const j = await call<{ swapTransaction?: string; lastValidBlockHeight?: number }>("/swap", {
        method: "POST",
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey,
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: maxPriorityLamports, priorityLevel: "veryHigh" } },
        }),
      });
      if (!j.swapTransaction || !(Number(j.lastValidBlockHeight) > 0)) throw new LiveError("Jupiter did not return a swap transaction", 502);
      return { swapTransaction: j.swapTransaction, lastValidBlockHeight: Number(j.lastValidBlockHeight) };
    },
  };
}

// ---------- RPC ----------

export interface TokenAccount {
  address: string;
  amount: bigint;
  decimals: number;
  program: string;
  lamports: number;
}
export interface Rpc {
  balance(pubkey: string): Promise<number>;
  tokenAccounts(owner: string, mint: string): Promise<TokenAccount[]>;
  send(raw: Uint8Array): Promise<string>;
  status(sig: string): Promise<{ ok: boolean; err: unknown } | null>;
  blockHeight(): Promise<number>;
  blockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
  tx(sig: string): Promise<TxLike | null>;
}

export function rpcFrom(conn: Connection): Rpc {
  return {
    balance: (pk) => conn.getBalance(new PublicKey(pk), "confirmed"),
    async tokenAccounts(owner, mint) {
      const r = await conn.getParsedTokenAccountsByOwner(new PublicKey(owner), { mint: new PublicKey(mint) }, "confirmed");
      return r.value.map((a) => {
        const info = (a.account.data as { parsed?: { info?: { tokenAmount?: { amount: string; decimals: number } } } }).parsed?.info;
        return {
          address: a.pubkey.toBase58(),
          amount: BigInt(info?.tokenAmount?.amount ?? "0"),
          decimals: info?.tokenAmount?.decimals ?? 0,
          program: a.account.owner.toBase58(),
          lamports: a.account.lamports,
        };
      });
    },
    // Отправляем сами и повторяем сами (maxRetries 0), без preflight, как советует Jupiter.
    send: (raw) => conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }),
    async status(sig) {
      const v = (await conn.getSignatureStatuses([sig], { searchTransactionHistory: true })).value[0];
      if (!v) return null;
      return { ok: !v.err && (v.confirmationStatus === "confirmed" || v.confirmationStatus === "finalized"), err: v.err };
    },
    blockHeight: () => conn.getBlockHeight("confirmed"),
    blockhash: () => conn.getLatestBlockhash("confirmed"),
    tx: (sig) => conn.getParsedTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }) as Promise<TxLike | null>,
  };
}

// ---------- база ----------

export function initLiveSchema(db: DatabaseSync) {
  db.exec(`
    -- Торговый кошелёк на владельца. enc/iv/tag: секрет под AES-256-GCM, в открытом виде нигде не лежит.
    CREATE TABLE IF NOT EXISTS live_wallets (owner TEXT PRIMARY KEY, pubkey TEXT NOT NULL UNIQUE, enc TEXT NOT NULL, iv TEXT NOT NULL, tag TEXT NOT NULL,
      created_at INTEGER NOT NULL, paused INTEGER NOT NULL DEFAULT 0, paused_reason TEXT, enabled INTEGER NOT NULL DEFAULT 0,
      strategies TEXT NOT NULL DEFAULT '[]', trade_sol REAL NOT NULL DEFAULT 0.1, slippage_pct REAL NOT NULL DEFAULT 15, updated_at INTEGER NOT NULL);
    -- Позиция: opening (покупка в пути), open, closing (продажа в пути), closed, failed (покупка не прошла, позиции нет).
    -- Лампорты целые: sol_in потрачено на покупку (с комиссиями сети и арендой), sol_out получено с продажи.
    CREATE TABLE IF NOT EXISTS live_positions (id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, wallet TEXT NOT NULL, strategy TEXT NOT NULL,
      token TEXT NOT NULL, chain TEXT NOT NULL, symbol TEXT NOT NULL, paper_id INTEGER NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL,
      trade_lamports INTEGER NOT NULL, slippage_bps INTEGER NOT NULL, entry_price_usd REAL, sol_in INTEGER, token_amount TEXT, entry_at INTEGER,
      buy_sig TEXT, sell_sig TEXT, sol_out INTEGER, exit_at INTEGER, exit_reason TEXT, pnl_lamports INTEGER, fee_lamports INTEGER,
      sell_attempts INTEGER NOT NULL DEFAULT 0, retry_at INTEGER, close_requested TEXT, last_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS live_positions_idem ON live_positions (owner, strategy, token, paper_id);
    CREATE INDEX IF NOT EXISTS live_positions_status ON live_positions (status);
    CREATE INDEX IF NOT EXISTS live_positions_owner ON live_positions (owner, status);
    CREATE INDEX IF NOT EXISTS live_positions_paper ON live_positions (paper_id);
    -- Каждая попытка в сети или симуляция: buy, sell, fee, withdraw. sol_lamports со знаком (изменение баланса кошелька).
    CREATE TABLE IF NOT EXISTS live_trades (id INTEGER PRIMARY KEY AUTOINCREMENT, position_id INTEGER, owner TEXT NOT NULL, mode TEXT NOT NULL, side TEXT NOT NULL,
      token TEXT, sol_lamports INTEGER, token_amount TEXT, slippage_bps INTEGER, sig TEXT, status TEXT NOT NULL, error TEXT, at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS live_trades_owner ON live_trades (owner, at);
    -- Журнал комиссий с прибыли: buyback_lamports помечены под байбек и сжигание (сервер ничего не покупает и не жжёт).
    CREATE TABLE IF NOT EXISTS live_fees (id INTEGER PRIMARY KEY AUTOINCREMENT, position_id INTEGER NOT NULL UNIQUE, owner TEXT NOT NULL, mode TEXT NOT NULL,
      profit_lamports INTEGER NOT NULL, fee_lamports INTEGER NOT NULL, buyback_lamports INTEGER NOT NULL, status TEXT NOT NULL, sig TEXT,
      at INTEGER NOT NULL, paid_at INTEGER);
    CREATE INDEX IF NOT EXISTS live_fees_status ON live_fees (status, owner);
    -- Аудит: создание, настройки, вывод, выдача ключа, уведомления. Секретов здесь нет никогда.
    CREATE TABLE IF NOT EXISTS live_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL, ip TEXT, at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS live_audit_owner ON live_audit (owner, kind, at);
  `);
}

export interface WalletRow extends Sealed {
  owner: string;
  pubkey: string;
  created_at: number;
  paused: number;
  paused_reason: string | null;
  enabled: number;
  strategies: string;
  trade_sol: number;
  slippage_pct: number;
  updated_at: number;
}
export type PosStatus = "opening" | "open" | "closing" | "closed" | "failed";
export interface PositionRow {
  id: number;
  owner: string;
  wallet: string;
  strategy: string;
  token: string;
  chain: string;
  symbol: string;
  paper_id: number;
  mode: "dryrun" | "live";
  status: PosStatus;
  trade_lamports: number;
  slippage_bps: number;
  entry_price_usd: number | null;
  sol_in: number | null;
  token_amount: string | null;
  entry_at: number | null;
  buy_sig: string | null;
  sell_sig: string | null;
  sol_out: number | null;
  exit_at: number | null;
  exit_reason: string | null;
  pnl_lamports: number | null;
  fee_lamports: number | null;
  sell_attempts: number;
  retry_at: number | null;
  close_requested: string | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

// Видимая часть позиции для API: суммы в SOL, без внутренних полей.
export function positionView(p: PositionRow) {
  return {
    id: p.id,
    strategy: p.strategy,
    token: p.token,
    symbol: p.symbol,
    mode: p.mode,
    status: p.status,
    tradeSol: sol(p.trade_lamports),
    solIn: p.sol_in != null ? sol(p.sol_in) : null,
    solOut: p.sol_out != null ? sol(p.sol_out) : null,
    pnlSol: p.pnl_lamports != null ? sol(p.pnl_lamports) : null,
    feeSol: p.fee_lamports != null ? sol(p.fee_lamports) : null,
    tokenAmount: p.token_amount,
    entryAt: p.entry_at,
    exitAt: p.exit_at,
    exitReason: p.exit_reason,
    buySig: p.buy_sig,
    sellSig: p.sell_sig,
    sellAttempts: p.sell_attempts,
    lastError: p.last_error,
    createdAt: p.created_at,
  };
}
export type LivePositionView = ReturnType<typeof positionView>;

export const parseStrategies = (s: string): string[] => {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x) => (LIVE_STRATEGIES as readonly string[]).includes(x)) : [];
  } catch {
    return [];
  }
};

// ---------- события ----------

export type LiveEvent =
  | { kind: "buy"; owner: string; positionId: number; strategy: string; token: string; symbol: string; mode: "dryrun" | "live"; solIn: number; sig: string | null }
  | { kind: "buy_failed"; owner: string; strategy: string; token: string; symbol: string; mode: "dryrun" | "live"; error: string }
  | { kind: "sell"; owner: string; positionId: number; strategy: string; token: string; symbol: string; mode: "dryrun" | "live"; solIn: number; solOut: number; pnlSol: number; feeSol: number; reason: string; sig: string | null }
  | { kind: "sell_failed"; owner: string; positionId: number; token: string; symbol: string; attempts: number; error: string }
  | { kind: "fee"; owner: string; feeSol: number; sig: string }
  | { kind: "withdraw"; owner: string; asset: string; amount: string; sig: string }
  | { kind: "export"; owner: string }
  | { kind: "notice"; owner: string; code: string; text: string }
  | { kind: "kill"; on: boolean; by: string; closeAll: boolean };

// Минимум события Paper Engine, на которое реагирует движок.
export interface PaperLike {
  kind: "open" | "close";
  strategy: string;
  token: string;
  chain: string;
  symbol: string;
  positionId?: number;
  price?: number;
  reason?: string;
}

// ---------- движок ----------

export interface LiveDeps {
  db: DatabaseSync;
  cfg: () => LiveConfig;
  master: () => Buffer | null;
  rpc: () => Rpc | null;
  jupiter: Jupiter;
  treasury: string;
  killed: () => boolean;
  tierOk: (owner: string) => Promise<boolean>;
  paperOpen: (paperId: number) => boolean | null; // null: неизвестно
  exits: (strategy: string) => { slPct?: number; maxHoldMin: number } | undefined;
  prices: (tokens: string[]) => Promise<Map<string, number>>;
  alert: (key: string, text: string, everyMs?: number) => void;
  emit: (e: LiveEvent) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
}

type SendResult = { state: "ok"; sig: string; tx: TxLike } | { state: "failed"; sig: string; error: string } | { state: "pending"; sig: string };

const NOTICE_TEXT: Partial<Record<EntryBlock, string>> = {
  tier: "Live trading skipped a signal: your wallet is below the Holder tier.",
  daily_loss: "Daily loss limit reached. New live entries resume at 00:00 UTC.",
  wallet_above_cap: "Trading wallet balance is above the cap. Withdraw the excess to resume new entries.",
  low_balance: "Trading wallet balance is too low for the trade size plus the fee reserve. Top it up to resume.",
  max_open: "Open position limit reached, a signal was skipped.",
};

export function createLiveEngine(d: LiveDeps) {
  const now = d.now ?? Date.now;
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const poll = d.pollMs ?? 2000;
  const db = d.db;
  const chains = new Map<string, Promise<void>>();
  const waiters: (() => void)[] = [];
  const inflight = new Set<number>(); // позиции, которые сейчас ведёт этот процесс
  const queued = new Set<number>(); // продажи в очереди
  let active = 0;
  let ticking = false;

  const rpc = () => {
    const r = d.rpc();
    if (!r) throw new LiveError("Solana RPC for live trading is not configured", 503);
    return r;
  };

  // ---------- очередь: по одному на пользователя, не больше concurrency на сервер ----------

  async function slot<T>(fn: () => Promise<T>): Promise<T> {
    while (active >= d.cfg().concurrency) await new Promise<void>((r) => waiters.push(r));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      waiters.shift()?.();
    }
  }
  function serial<T>(owner: string, fn: () => Promise<T>): Promise<T> {
    const prev = chains.get(owner) ?? Promise.resolve();
    const run = prev.then(() => slot(fn));
    const tail = run.then(
      () => {},
      () => {},
    );
    chains.set(owner, tail);
    void tail.then(() => {
      if (chains.get(owner) === tail) chains.delete(owner);
    });
    return run;
  }
  const bg = (owner: string, what: string, fn: () => Promise<unknown>) =>
    void serial(owner, fn).catch((e) => console.warn(`[live] ${what} ${owner.slice(0, 6)}:`, (e as Error).message));

  // ---------- запросы к базе ----------

  const walletRow = (owner: string) => db.prepare("SELECT * FROM live_wallets WHERE owner = ?").get(owner) as unknown as WalletRow | undefined;
  const posRow = (id: number) => db.prepare("SELECT * FROM live_positions WHERE id = ?").get(id) as unknown as PositionRow | undefined;
  const busyCount = (owner: string) =>
    (db.prepare("SELECT COUNT(*) AS n FROM live_positions WHERE owner = ? AND status IN ('opening', 'open', 'closing')").get(owner) as { n: number }).n;
  const dayPnl = (owner: string, mode: string) =>
    (db.prepare("SELECT COALESCE(SUM(pnl_lamports), 0) AS s FROM live_positions WHERE owner = ? AND mode = ? AND status = 'closed' AND exit_at >= ?").get(owner, mode, utcDayStart(now())) as { s: number }).s;
  const pendingFees = (owner: string) =>
    db.prepare("SELECT id, fee_lamports FROM live_fees WHERE owner = ? AND status = 'pending' AND mode = 'live'").all(owner) as unknown as { id: number; fee_lamports: number }[];
  const setPos = (id: number, fields: Partial<PositionRow>) => {
    const keys = Object.keys(fields);
    db.prepare(`UPDATE live_positions SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(
      ...(keys.map((k) => (fields as Record<string, string | number | null>)[k]) as (string | number | null)[]),
      now(),
      id,
    );
  };
  const trade = (r: { position_id: number | null; owner: string; mode: string; side: string; token?: string | null; sol_lamports?: number | null; token_amount?: string | null; slippage_bps?: number | null; sig?: string | null; status: string; error?: string | null }) =>
    db
      .prepare("INSERT INTO live_trades (position_id, owner, mode, side, token, sol_lamports, token_amount, slippage_bps, sig, status, error, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(r.position_id, r.owner, r.mode, r.side, r.token ?? null, r.sol_lamports ?? null, r.token_amount ?? null, r.slippage_bps ?? null, r.sig ?? null, r.status, r.error?.slice(0, 300) ?? null, now());
  const audit = (owner: string, kind: string, detail: Record<string, unknown>, ip: string | null = null) =>
    db.prepare("INSERT INTO live_audit (owner, kind, detail, ip, at) VALUES (?, ?, ?, ?, ?)").run(owner, kind, JSON.stringify(detail), ip, now());
  const auditCountToday = (owner: string, kind: string) =>
    (db.prepare("SELECT COUNT(*) AS n FROM live_audit WHERE owner = ? AND kind = ? AND at >= ?").get(owner, kind, utcDayStart(now())) as { n: number }).n;

  // Уведомление пользователю (страница и позже Telegram). once: не чаще раза в UTC-сутки на код.
  function notice(owner: string, code: string, text: string, once = true) {
    if (once && db.prepare("SELECT 1 FROM live_audit WHERE owner = ? AND kind = 'notice' AND json_extract(detail, '$.code') = ? AND at >= ?").get(owner, code, utcDayStart(now()))) return;
    audit(owner, "notice", { code, text });
    d.emit({ kind: "notice", owner, code, text });
  }

  // ---------- подпись и отправка ----------

  function withKey<T>(w: WalletRow, fn: (kp: Keypair) => T): T {
    const master = d.master();
    if (!master) throw new LiveError("Live wallets are disabled: the master key is missing", 503);
    let secret: Buffer;
    try {
      secret = openSecret(master, w, aadFor(w.owner, w.pubkey));
    } catch {
      // Запись не расшифровалась (подмена в базе или другой мастер-ключ): пользователя на паузу, админам сигнал.
      db.prepare("UPDATE live_wallets SET paused = 1, paused_reason = 'key_error', updated_at = ? WHERE owner = ?").run(now(), w.owner);
      d.alert("live-key-error", `Trading wallet of ${w.owner} (${w.pubkey}) failed to decrypt. Check LIVE_WALLET_MASTER_KEY and the live_wallets table.`, 60 * 60_000);
      throw new LiveError("Trading wallet key could not be unlocked", 500);
    }
    let kp: Keypair;
    try {
      kp = Keypair.fromSecretKey(Uint8Array.from(secret));
    } finally {
      secret.fill(0);
    }
    try {
      if (kp.publicKey.toBase58() !== w.pubkey) throw new LiveError("Trading key does not match its address", 500);
      return fn(kp);
    } finally {
      wipe(kp);
    }
  }

  async function fetchTx(sig: string): Promise<TxLike | null> {
    for (let i = 0; i < 6; i++) {
      const tx = await rpc().tx(sig).catch(() => null);
      if (tx) return tx;
      await sleep(poll);
    }
    return null;
  }

  // Отправка с повторами до подтверждения или до истечения blockhash. Блокхэш истёк и подписи нет: точно не прошла.
  // Упёрлись в общий потолок времени при живом блокхэше: состояние неизвестно (pending), разбирается при восстановлении.
  async function sendConfirm(raw: Uint8Array, sig: string, lastValid: number): Promise<SendResult> {
    const r = rpc();
    const start = now();
    await r.send(raw).catch((e) => console.warn("[live] send", (e as Error).message));
    for (let i = 1; ; i++) {
      await sleep(poll);
      const st = await r.status(sig).catch(() => null);
      if (st?.err) return { state: "failed", sig, error: `Transaction failed on-chain: ${JSON.stringify(st.err).slice(0, 200)}` };
      if (st?.ok) {
        const tx = await fetchTx(sig);
        return tx ? { state: "ok", sig, tx } : { state: "pending", sig };
      }
      if (i % 2 === 0) void r.send(raw).catch(() => {});
      if (i % 3 === 0) {
        const bh = await r.blockHeight().catch(() => null);
        if (bh !== null && bh > lastValid) {
          const fin = await r.status(sig).catch(() => null);
          if (fin?.ok) {
            const tx = await fetchTx(sig);
            return tx ? { state: "ok", sig, tx } : { state: "pending", sig };
          }
          return { state: "failed", sig, error: fin?.err ? "Transaction failed on-chain" : "Transaction expired before it landed" };
        }
      }
      if (now() - start > d.cfg().confirmMaxMs) return { state: "pending", sig };
    }
  }

  // Свап Jupiter: собрать, проверить содержимое, подписать, записать подпись до отправки, отправить и дождаться.
  async function execSwap(w: WalletRow, q: JupQuote, posId: number, col: "buy_sig" | "sell_sig"): Promise<SendResult> {
    const cfg = d.cfg();
    const sw = await d.jupiter.swap(q, w.pubkey, cfg.maxPriorityLamports);
    const tx = VersionedTransaction.deserialize(Buffer.from(sw.swapTransaction, "base64"));
    guardSwapTx(tx, w.pubkey, cfg.extraPrograms);
    withKey(w, (kp) => tx.sign([kp]));
    const sig = bs58.encode(tx.signatures[0]);
    setPos(posId, { [col]: sig } as Partial<PositionRow>);
    return sendConfirm(tx.serialize(), sig, sw.lastValidBlockHeight);
  }

  // Простая транзакция из наших инструкций (переводы, закрытие аккаунта).
  async function sendIxs(w: WalletRow, ixs: TransactionInstruction[]): Promise<SendResult> {
    const r = rpc();
    const bh = await r.blockhash();
    const tx = new Transaction({ feePayer: new PublicKey(w.pubkey), blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight });
    tx.add(...ixs);
    withKey(w, (kp) => tx.sign(kp));
    const sig = bs58.encode(tx.signature!);
    return sendConfirm(tx.serialize(), sig, bh.lastValidBlockHeight);
  }

  // ---------- вход ----------

  async function openFor(owner: string, e: PaperLike) {
    const cfg = d.cfg();
    if (cfg.mode === "off" || e.positionId === undefined) return;
    const w = walletRow(owner);
    if (!w) return;
    if (db.prepare("SELECT 1 FROM live_positions WHERE owner = ? AND strategy = ? AND token = ? AND paper_id = ?").get(owner, e.strategy, e.token, e.positionId)) return;
    const tradeLamports = lamportsOf(w.trade_sol);
    const balance = cfg.mode === "live" ? await rpc().balance(w.pubkey).catch(() => null) : null;
    const block = entryBlock({
      mode: cfg.mode,
      killed: d.killed(),
      enabled: !!w.enabled,
      paused: !!w.paused,
      strategyOn: parseStrategies(w.strategies).includes(e.strategy),
      tierOk: await d.tierOk(owner).catch(() => false),
      open: busyCount(owner),
      tradeLamports,
      balanceLamports: balance,
      dayPnlLamports: dayPnl(owner, cfg.mode),
      cfg,
    });
    if (block) {
      const text = NOTICE_TEXT[block];
      if (text) notice(owner, block, text);
      return;
    }
    const slip = Math.round(w.slippage_pct * 100);
    const t = now();
    // Идемпотентность: уникальный индекс (owner, strategy, token, paper_id). Повтор события ничего не купит.
    const ins = db
      .prepare(
        `INSERT OR IGNORE INTO live_positions (owner, wallet, strategy, token, chain, symbol, paper_id, mode, status, trade_lamports, slippage_bps, entry_price_usd, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'opening', ?, ?, ?, ?, ?)`,
      )
      .run(owner, w.pubkey, e.strategy, e.token, e.chain, e.symbol.slice(0, 32), e.positionId, cfg.mode, tradeLamports, slip, e.price && e.price > 0 ? e.price : null, t, t);
    if (!ins.changes) return;
    const id = Number(ins.lastInsertRowid);
    const mode = cfg.mode as "dryrun" | "live";
    inflight.add(id);
    try {
      const q = await d.jupiter.quote({ inputMint: SOL_MINT, outputMint: e.token, amount: String(tradeLamports), slippageBps: slip });
      const impact = Number(q.priceImpactPct) * 100;
      if (Number.isFinite(impact) && impact > cfg.maxImpactPct) throw new LiveError(`Price impact ${impact.toFixed(1)}% is above ${cfg.maxImpactPct}%`);
      let solIn: number;
      let tokens: bigint;
      let sig: string | null = null;
      if (mode === "dryrun") {
        // Симуляция: исполнение ровно по котировке, ничего не подписываем и не отправляем.
        solIn = tradeLamports;
        tokens = BigInt(q.outAmount);
      } else {
        const r = await execSwap(w, q, id, "buy_sig");
        if (r.state === "pending") {
          setPos(id, { last_error: "Buy not confirmed yet, checking again shortly" });
          return;
        }
        if (r.state === "failed") throw new LiveError(r.error, 502);
        ({ solIn, tokens } = await buyFill(r.tx, w, e.token, tradeLamports));
        sig = r.sig;
      }
      markOpen(id, owner, mode, solIn, tokens, sig, slip);
    } catch (err) {
      const msg = (err as Error).message;
      setPos(id, { status: "failed", last_error: msg.slice(0, 300) });
      trade({ position_id: id, owner, mode, side: "buy", token: e.token, slippage_bps: slip, sig: posRow(id)?.buy_sig ?? null, status: "failed", error: msg });
      d.emit({ kind: "buy_failed", owner, strategy: e.strategy, token: e.token, symbol: e.symbol, mode, error: msg });
      notice(owner, "buy_failed", `Live buy of $${e.symbol} failed: ${msg.slice(0, 160)}`, false);
      return;
    } finally {
      inflight.delete(id);
    }
    const p = posRow(id);
    if (p?.status === "open" && p.close_requested) await sellNow(id, p.close_requested);
  }

  async function buyFill(tx: TxLike, w: WalletRow, token: string, tradeLamports: number) {
    const f = fillFromTx(tx, w.pubkey, token);
    let tokens = f.tokenDelta;
    // Баланс токена не попал в мету (бывает у Token-2022 с расширениями): берём то, что лежит на кошельке.
    if (tokens <= 0n) tokens = (await rpc().tokenAccounts(w.pubkey, token).catch(() => [])).reduce((s, a) => s + a.amount, 0n);
    const solIn = f.lamportsDelta < 0 ? -f.lamportsDelta : tradeLamports;
    return { solIn, tokens };
  }

  function markOpen(id: number, owner: string, mode: "dryrun" | "live", solIn: number, tokens: bigint, sig: string | null, slip: number) {
    const p = posRow(id)!;
    setPos(id, { status: "open", sol_in: solIn, token_amount: tokens.toString(), entry_at: now(), last_error: null });
    trade({ position_id: id, owner, mode, side: "buy", token: p.token, sol_lamports: -solIn, token_amount: tokens.toString(), slippage_bps: slip, sig, status: mode === "dryrun" ? "simulated" : "confirmed" });
    d.emit({ kind: "buy", owner, positionId: id, strategy: p.strategy, token: p.token, symbol: p.symbol, mode, solIn: sol(solIn), sig });
  }

  // ---------- выход ----------

  function queueSell(p: PositionRow, reason: string) {
    if (queued.has(p.id)) return;
    queued.add(p.id);
    bg(p.owner, "sell", async () => {
      try {
        await sellNow(p.id, reason);
      } finally {
        queued.delete(p.id);
      }
    });
  }

  // Продажа всего остатка. Режим сделки берём из позиции: позиция dryrun всегда закрывается симуляцией,
  // живая всегда в сети, даже если режим сервера с тех пор сменился (иначе деньги застрянут в токене).
  async function sellNow(id: number, reason: string) {
    const p = posRow(id);
    if (!p || p.status !== "open") return;
    const w = walletRow(p.owner);
    if (!w) return;
    const cfg = d.cfg();
    setPos(id, { status: "closing", exit_reason: reason, retry_at: null });
    inflight.add(id);
    try {
      let amount: bigint;
      if (p.mode === "live") amount = (await rpc().tokenAccounts(p.wallet, p.token)).reduce((s, a) => s + a.amount, 0n);
      else amount = BigInt(p.token_amount ?? "0");
      if (amount <= 0n) return finalize(p, p.mode === "live" ? await reclaimRent(w, p.token) : 0, null, `${reason}:empty`, null);
      let lastErr = "";
      for (const pct of sellSlippages(w.slippage_pct, cfg)) {
        const bps = Math.round(pct * 100);
        try {
          const q = await d.jupiter.quote({ inputMint: p.token, outputMint: SOL_MINT, amount: amount.toString(), slippageBps: bps });
          if (p.mode === "dryrun") return finalize(p, Number(q.outAmount), null, reason, bps);
          const r = await execSwap(w, q, id, "sell_sig");
          if (r.state === "ok") {
            const f = fillFromTx(r.tx, p.wallet, p.token);
            return finalize(p, f.lamportsDelta + (await reclaimRent(w, p.token)), r.sig, reason, bps);
          }
          if (r.state === "pending") {
            // Подпись записана, состояние выясняет восстановление: второй раз не продаём.
            setPos(id, { last_error: "Sell not confirmed yet, checking again shortly" });
            return;
          }
          lastErr = r.error;
          trade({ position_id: id, owner: p.owner, mode: p.mode, side: "sell", token: p.token, token_amount: amount.toString(), slippage_bps: bps, sig: r.sig, status: "failed", error: r.error });
        } catch (e) {
          lastErr = (e as Error).message;
        }
        db.prepare("UPDATE live_positions SET sell_attempts = sell_attempts + 1, last_error = ?, updated_at = ? WHERE id = ?").run(lastErr.slice(0, 300), now(), id);
      }
      // Все ступени проскальзывания не прошли: позиция остаётся открытой, повтор через 5 минут.
      const attempts = posRow(id)?.sell_attempts ?? 0;
      setPos(id, { status: "open", retry_at: now() + 5 * 60_000 });
      d.emit({ kind: "sell_failed", owner: p.owner, positionId: id, token: p.token, symbol: p.symbol, attempts, error: lastErr });
      notice(p.owner, "sell_failed", `Could not sell $${p.symbol} yet (${lastErr.slice(0, 120)}). Retrying every 5 minutes.`, false);
      d.alert("live-sell-failed", `Live sell failed after ${attempts} attempts: position ${id}, $${p.symbol} ${p.token}, owner ${p.owner}: ${lastErr.slice(0, 200)}`, 30 * 60_000);
    } catch (e) {
      // Сбой до свапа (например, RPC): возвращаем в open и пробуем позже.
      setPos(id, { status: "open", retry_at: now() + 60_000, last_error: (e as Error).message.slice(0, 300) });
    } finally {
      inflight.delete(id);
    }
  }

  // Пустые токен-аккаунты закрываем: аренда (~0.002 SOL) возвращается в кошелёк и входит в выручку сделки,
  // потому что при покупке она вошла в потраченное.
  async function reclaimRent(w: WalletRow, mint: string): Promise<number> {
    try {
      const accs = (await rpc().tokenAccounts(w.pubkey, mint)).filter((a) => a.amount === 0n);
      if (!accs.length) return 0;
      const owner = new PublicKey(w.pubkey);
      const r = await sendIxs(
        w,
        accs.map((a) => createCloseAccountInstruction(new PublicKey(a.address), owner, owner, [], new PublicKey(a.program))),
      );
      if (r.state !== "ok") return 0;
      const delta = fillFromTx(r.tx, w.pubkey, mint).lamportsDelta;
      return delta > 0 ? delta : 0;
    } catch {
      return 0;
    }
  }

  function finalize(p: PositionRow, solOut: number, sig: string | null, reason: string, bps: number | null) {
    const cfg = d.cfg();
    const solIn = p.sol_in ?? p.trade_lamports;
    const fee = profitFee(solIn, solOut, cfg.profitFeePct, cfg.buybackSharePct);
    db.exec("BEGIN");
    try {
      setPos(p.id, { status: "closed", sol_out: solOut, pnl_lamports: solOut - solIn, fee_lamports: fee.fee, exit_at: now(), exit_reason: reason, sell_sig: sig, last_error: null, retry_at: null });
      trade({ position_id: p.id, owner: p.owner, mode: p.mode, side: "sell", token: p.token, sol_lamports: solOut, token_amount: p.token_amount, slippage_bps: bps, sig, status: p.mode === "dryrun" ? "simulated" : "confirmed" });
      if (fee.fee > 0)
        db.prepare("INSERT OR IGNORE INTO live_fees (position_id, owner, mode, profit_lamports, fee_lamports, buyback_lamports, status, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
          p.id,
          p.owner,
          p.mode,
          fee.profit,
          fee.fee,
          fee.buyback,
          p.mode === "live" ? "pending" : "simulated",
          now(),
        );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    d.emit({ kind: "sell", owner: p.owner, positionId: p.id, strategy: p.strategy, token: p.token, symbol: p.symbol, mode: p.mode, solIn: sol(solIn), solOut: sol(solOut), pnlSol: sol(solOut - solIn), feeSol: sol(fee.fee), reason, sig });
  }

  // ---------- комиссии в казну ----------

  async function payFees(owner: string) {
    const fees = pendingFees(owner);
    const total = fees.reduce((s, f) => s + f.fee_lamports, 0);
    if (total < lamportsOf(d.cfg().feeMinSol)) return;
    const w = walletRow(owner);
    if (!w) return;
    const bal = await rpc().balance(w.pubkey);
    if (bal < total + TX_FEE) return; // выведено раньше; комиссия ждёт до следующей прибыли или вывода
    const r = await sendIxs(w, [SystemProgram.transfer({ fromPubkey: new PublicKey(w.pubkey), toPubkey: new PublicKey(d.treasury), lamports: total })]);
    if (r.state !== "ok") return;
    markFeesPaid(fees.map((f) => f.id), r.sig);
    trade({ position_id: null, owner, mode: "live", side: "fee", token: null, sol_lamports: -total, sig: r.sig, status: "confirmed" });
    d.emit({ kind: "fee", owner, feeSol: sol(total), sig: r.sig });
  }
  const markFeesPaid = (ids: number[], sig: string) => {
    const st = db.prepare("UPDATE live_fees SET status = 'paid', sig = ?, paid_at = ? WHERE id = ? AND status = 'pending'");
    for (const id of ids) st.run(sig, now(), id);
  };

  // ---------- восстановление после рестарта и страховка ----------

  async function recover() {
    const stale = now() - 4 * 60_000;
    const rows = db.prepare("SELECT * FROM live_positions WHERE status IN ('opening', 'closing') AND updated_at < ?").all(stale) as unknown as PositionRow[];
    for (const p of rows) {
      if (inflight.has(p.id)) continue;
      bg(p.owner, "recover", async () => {
        const cur = posRow(p.id);
        if (!cur || inflight.has(cur.id) || (cur.status !== "opening" && cur.status !== "closing")) return;
        const w = walletRow(cur.owner);
        if (!w) return;
        if (cur.status === "opening") {
          if (cur.mode === "live" && cur.buy_sig) {
            const st = await rpc().status(cur.buy_sig).catch(() => undefined);
            if (st === undefined) return; // RPC недоступен: позже
            if (st?.ok) {
              const tx = await fetchTx(cur.buy_sig);
              if (!tx) return;
              const f = await buyFill(tx, w, cur.token, cur.trade_lamports);
              markOpen(cur.id, cur.owner, "live", f.solIn, f.tokens, cur.buy_sig, cur.slippage_bps);
              return;
            }
            // Подписи в сети нет, а прошло больше 10 минут: блокхэш давно истёк, покупка не состоялась.
            if (!st?.err && now() - cur.updated_at < 10 * 60_000) return;
          }
          setPos(cur.id, { status: "failed", last_error: cur.last_error ?? "Buy did not complete" });
          trade({ position_id: cur.id, owner: cur.owner, mode: cur.mode, side: "buy", token: cur.token, sig: cur.buy_sig, status: "failed", error: "not completed" });
          return;
        }
        // closing
        if (cur.mode === "live" && cur.sell_sig) {
          const st = await rpc().status(cur.sell_sig).catch(() => undefined);
          if (st === undefined) return;
          if (st?.ok) {
            const tx = await fetchTx(cur.sell_sig);
            if (!tx) return;
            const f = fillFromTx(tx, cur.wallet, cur.token);
            return finalize(cur, f.lamportsDelta + (await reclaimRent(w, cur.token)), cur.sell_sig, cur.exit_reason ?? "recovered", null);
          }
          if (!st?.err && now() - cur.updated_at < 10 * 60_000) return;
        }
        setPos(cur.id, { status: "open", retry_at: now() });
      });
    }
  }

  // Раз в 30 с: восстановление, страховочные выходы (бумага закрылась без нас, стоп стратегии, лимит времени,
  // повтор неудачной продажи) и перевод накопленных комиссий.
  async function tick() {
    if (ticking || d.cfg().mode === "off") return;
    ticking = true;
    try {
      await recover();
      const open = db.prepare("SELECT * FROM live_positions WHERE status = 'open'").all() as unknown as PositionRow[];
      const t = now();
      const prices = open.length ? await d.prices([...new Set(open.map((p) => p.token))]).catch(() => new Map<string, number>()) : new Map<string, number>();
      for (const p of open) {
        if (queued.has(p.id) || inflight.has(p.id)) continue;
        if (p.retry_at && p.retry_at > t) continue;
        let reason: string | null = p.retry_at ? `retry:${p.exit_reason ?? "exit"}` : null;
        if (!reason && p.close_requested) reason = p.close_requested;
        if (!reason && d.paperOpen(p.paper_id) === false) reason = "paper_closed";
        const x = d.exits(p.strategy);
        const px = prices.get(p.token);
        if (!reason && x?.slPct !== undefined && px && p.entry_price_usd && (px / p.entry_price_usd - 1) * 100 <= -x.slPct) reason = "sl";
        if (!reason && p.entry_at && t - p.entry_at >= (x?.maxHoldMin ?? 24 * 60) * 60_000) reason = "time";
        if (reason) queueSell(p, reason);
      }
      const minFee = lamportsOf(d.cfg().feeMinSol);
      for (const o of pendingOwners()) if (o.s >= minFee) bg(o.owner, "fees", () => payFees(o.owner));
    } finally {
      ticking = false;
    }
  }
  const pendingOwners = () =>
    db.prepare("SELECT owner, SUM(fee_lamports) AS s FROM live_fees WHERE status = 'pending' AND mode = 'live' GROUP BY owner").all() as unknown as { owner: string; s: number }[];

  // ---------- события Paper Engine ----------

  function onPaper(e: PaperLike) {
    if (d.cfg().mode === "off" || e.chain !== "solana" || !(LIVE_STRATEGIES as readonly string[]).includes(e.strategy) || e.positionId === undefined) return;
    if (e.kind === "open") {
      if (d.killed()) return;
      const owners = db.prepare("SELECT owner, strategies FROM live_wallets WHERE enabled = 1 AND paused = 0").all() as unknown as { owner: string; strategies: string }[];
      for (const o of owners) if (parseStrategies(o.strategies).includes(e.strategy)) bg(o.owner, "open", () => openFor(o.owner, e));
      return;
    }
    const reason = `paper:${e.reason ?? "close"}`;
    // Покупка ещё в пути: продадим сразу после подтверждения.
    db.prepare("UPDATE live_positions SET close_requested = ?, updated_at = updated_at WHERE paper_id = ? AND strategy = ? AND token = ? AND status = 'opening'").run(reason, e.positionId, e.strategy, e.token);
    const rows = db.prepare("SELECT * FROM live_positions WHERE paper_id = ? AND strategy = ? AND token = ? AND status = 'open'").all(e.positionId, e.strategy, e.token) as unknown as PositionRow[];
    for (const p of rows) queueSell(p, reason);
  }

  // ---------- действия пользователя ----------

  async function createWallet(owner: string, ip: string | null) {
    const master = d.master();
    if (!master) throw new LiveError("Live wallets are disabled on this server", 503);
    if (d.cfg().mode === "off") throw new LiveError("Live trading is not available yet", 409);
    solanaOwner(owner);
    const have = walletRow(owner);
    if (have) return { pubkey: have.pubkey, createdAt: have.created_at, created: false };
    if (!(await d.tierOk(owner).catch(() => false))) throw new LiveError("Live trading needs the Holder tier or higher", 403);
    const kp = Keypair.generate();
    const pubkey = kp.publicKey.toBase58();
    const secret = kp.secretKey; // копия из web3.js
    let sealed: Sealed;
    try {
      sealed = sealSecret(master, secret, aadFor(owner, pubkey));
    } finally {
      secret.fill(0);
      wipe(kp);
    }
    const cfg = d.cfg();
    const t = now();
    const r = db
      .prepare(
        "INSERT OR IGNORE INTO live_wallets (owner, pubkey, enc, iv, tag, created_at, enabled, strategies, trade_sol, slippage_pct, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, '[]', ?, ?, ?)",
      )
      .run(owner, pubkey, sealed.enc, sealed.iv, sealed.tag, t, cfg.defaultTradeSol, cfg.defaultSlippagePct, t);
    if (!r.changes) {
      const w = walletRow(owner)!;
      return { pubkey: w.pubkey, createdAt: w.created_at, created: false };
    }
    audit(owner, "wallet_create", { pubkey }, ip);
    return { pubkey, createdAt: t, created: true };
  }

  async function setSettings(owner: string, b: Record<string, unknown>, ip: string | null) {
    const w = walletRow(owner);
    if (!w) throw new LiveError("Create a trading wallet first", 404);
    const cfg = d.cfg();
    const next = { enabled: !!w.enabled, strategies: parseStrategies(w.strategies), tradeSol: w.trade_sol, slippagePct: w.slippage_pct };
    if (b.enabled !== undefined) {
      if (typeof b.enabled !== "boolean") throw new LiveError("enabled must be true or false");
      next.enabled = b.enabled;
    }
    if (b.strategies !== undefined) {
      if (!Array.isArray(b.strategies) || b.strategies.length > LIVE_STRATEGIES.length) throw new LiveError("strategies must be a list of strategy ids");
      for (const s of b.strategies) if (typeof s !== "string" || !(LIVE_STRATEGIES as readonly string[]).includes(s)) throw new LiveError(`Unknown live strategy ${String(s).slice(0, 20)}`);
      next.strategies = [...new Set(b.strategies as string[])];
    }
    if (b.tradeSol !== undefined) {
      const v = Number(b.tradeSol);
      if (typeof b.tradeSol !== "number" || !Number.isFinite(v) || v < cfg.minTradeSol || v > cfg.maxTradeSol)
        throw new LiveError(`tradeSol must be between ${cfg.minTradeSol} and ${cfg.maxTradeSol} SOL`);
      next.tradeSol = Math.round(v * 1e4) / 1e4;
    }
    if (b.slippagePct !== undefined) {
      const v = Number(b.slippagePct);
      if (typeof b.slippagePct !== "number" || !Number.isFinite(v) || v < 0.5 || v > cfg.maxSlippagePct) throw new LiveError(`slippagePct must be between 0.5 and ${cfg.maxSlippagePct}`);
      next.slippagePct = Math.round(v * 100) / 100;
    }
    const enabling = next.enabled && (!w.enabled || !!w.paused);
    if (enabling) {
      if (cfg.mode === "off") throw new LiveError("Live trading is not available yet", 409);
      if (!(await d.tierOk(owner).catch(() => false))) throw new LiveError("Live trading needs the Holder tier or higher", 403);
    }
    db.prepare("UPDATE live_wallets SET enabled = ?, strategies = ?, trade_sol = ?, slippage_pct = ?, paused = CASE WHEN ? THEN 0 ELSE paused END, paused_reason = CASE WHEN ? THEN NULL ELSE paused_reason END, updated_at = ? WHERE owner = ?").run(
      next.enabled ? 1 : 0,
      JSON.stringify(next.strategies),
      next.tradeSol,
      next.slippagePct,
      enabling ? 1 : 0,
      enabling ? 1 : 0,
      now(),
      owner,
    );
    audit(owner, "settings", next, ip);
    return next;
  }

  // Выдача секрета владельцу: подтверждение, лимит 3 в UTC-сутки, запись в аудит до расшифровки, оповещение админам без ключа.
  function exportKey(owner: string, confirm: unknown, ip: string | null) {
    if (confirm !== true) throw new LiveError("Set confirm to true to export the private key");
    const w = walletRow(owner);
    if (!w) throw new LiveError("No trading wallet", 404);
    const master = d.master();
    if (!master) throw new LiveError("Live wallets are disabled on this server", 503);
    const cfg = d.cfg();
    if (auditCountToday(owner, "export") >= cfg.exportsPerDay) throw new LiveError(`Key export is limited to ${cfg.exportsPerDay} times per day`, 429);
    audit(owner, "export", { pubkey: w.pubkey }, ip);
    const secret = openSecret(master, w, aadFor(owner, w.pubkey));
    let out: string;
    try {
      if (Keypair.fromSecretKey(Uint8Array.from(secret)).publicKey.toBase58() !== w.pubkey) throw new LiveError("Trading key does not match its address", 500);
      out = bs58.encode(secret);
    } finally {
      secret.fill(0);
    }
    d.alert("live-export", `Trading wallet key exported by its owner ${owner} (trading wallet ${w.pubkey}, ip ${ip ?? "?"})`, 0);
    d.emit({ kind: "export", owner });
    return { pubkey: w.pubkey, secretKey: out, format: "base58" as const };
  }

  // Вывод SOL или токена только на кошелёк владельца. Накопленные комиссии уходят в казну той же транзакцией.
  async function withdraw(owner: string, b: Record<string, unknown>, ip: string | null) {
    const dest = withdrawDestination(owner, b.to);
    const w = walletRow(owner);
    if (!w) throw new LiveError("No trading wallet", 404);
    const cfg = d.cfg();
    if (auditCountToday(owner, "withdraw") >= cfg.withdrawsPerDay) throw new LiveError("Too many withdrawals today", 429);
    const asset = b.asset === undefined || b.asset === null || b.asset === "SOL" || b.asset === SOL_MINT ? "SOL" : b.asset;
    if (asset !== "SOL") {
      if (typeof asset !== "string") throw new LiveError("asset must be \"SOL\" or a token mint");
      try {
        new PublicKey(asset);
      } catch {
        throw new LiveError("asset must be \"SOL\" or a token mint");
      }
    }
    const all = b.amount === "all";
    return serial(owner, async () => {
      const r = rpc();
      const from = new PublicKey(w.pubkey);
      const ixs: TransactionInstruction[] = [];
      const fees = pendingFees(owner);
      const feeTotal = fees.reduce((s, f) => s + f.fee_lamports, 0);
      const bal = await r.balance(w.pubkey);
      let amountText: string;
      if (asset === "SOL") {
        // Пока есть живые позиции, резерв на комиссии продаж остаётся в кошельке.
        const busy = (db.prepare("SELECT COUNT(*) AS n FROM live_positions WHERE owner = ? AND mode = 'live' AND status IN ('opening', 'open', 'closing')").get(owner) as { n: number }).n;
        const reserve = busy ? lamportsOf(cfg.feeReserveSol) : 0;
        const max = bal - feeTotal - reserve - TX_FEE;
        const lamports = all ? max : Number(toRaw(b.amount, 9));
        if (!(max > 0) || lamports <= 0 || lamports > max) throw new LiveError(`Not enough SOL: you can withdraw up to ${sol(Math.max(0, max))} SOL${reserve ? " while positions are open" : ""}`);
        const left = bal - feeTotal - lamports - TX_FEE;
        if (left > 0 && left < RENT_MIN) throw new LiveError(`Leave at least ${sol(RENT_MIN)} SOL or withdraw everything`);
        if (feeTotal > 0) ixs.push(SystemProgram.transfer({ fromPubkey: from, toPubkey: new PublicKey(d.treasury), lamports: feeTotal }));
        ixs.push(SystemProgram.transfer({ fromPubkey: from, toPubkey: dest, lamports }));
        amountText = String(sol(lamports));
      } else {
        // Токен открытой позиции не выводим, пока торговля работает: продажа не найдёт баланса.
        if (cfg.mode !== "off" && db.prepare("SELECT 1 FROM live_positions WHERE owner = ? AND token = ? AND mode = 'live' AND status IN ('opening', 'open', 'closing')").get(owner, asset))
          throw new LiveError("Close the live position in this token first", 409);
        const mint = new PublicKey(asset as string);
        const accs = (await r.tokenAccounts(w.pubkey, mint.toBase58())).filter((a) => a.amount > 0n).sort((x, y) => (y.amount > x.amount ? 1 : -1));
        const src = accs[0];
        if (!src) throw new LiveError("No balance of this token in the trading wallet");
        const program = new PublicKey(src.program);
        const raw = all ? src.amount : toRaw(b.amount, src.decimals);
        if (raw > src.amount) throw new LiveError("Amount is more than the token balance");
        if (bal < feeTotal + TX_FEE * 2) throw new LiveError("Not enough SOL in the trading wallet for the network fee");
        const destAta = getAssociatedTokenAddressSync(mint, dest, false, program);
        if (feeTotal > 0) ixs.push(SystemProgram.transfer({ fromPubkey: from, toPubkey: new PublicKey(d.treasury), lamports: feeTotal }));
        ixs.push(createAssociatedTokenAccountIdempotentInstruction(from, destAta, dest, mint, program));
        ixs.push(createTransferCheckedInstruction(new PublicKey(src.address), mint, destAta, from, raw, src.decimals, [], program));
        // Весь остаток классического SPL: закрываем пустой аккаунт, аренда возвращается в торговый кошелёк.
        if (raw === src.amount && program.equals(TOKEN_PROGRAM_ID)) ixs.push(createCloseAccountInstruction(new PublicKey(src.address), from, from, [], program));
        amountText = raw.toString();
      }
      audit(owner, "withdraw", { asset, amount: amountText, to: dest.toBase58(), fees: feeTotal }, ip);
      const res = await sendIxs(w, ixs);
      if (res.state === "failed") {
        trade({ position_id: null, owner, mode: "live", side: "withdraw", token: asset === "SOL" ? null : (asset as string), sig: res.sig, status: "failed", error: res.error });
        throw new LiveError(`Withdrawal failed: ${res.error}`, 502);
      }
      if (res.state === "ok" && fees.length) {
        markFeesPaid(fees.map((f) => f.id), res.sig);
        d.emit({ kind: "fee", owner, feeSol: sol(feeTotal), sig: res.sig });
      }
      trade({ position_id: null, owner, mode: "live", side: "withdraw", token: asset === "SOL" ? null : (asset as string), sol_lamports: asset === "SOL" ? -Math.round(Number(amountText) * LAMPORTS) : null, token_amount: asset === "SOL" ? null : amountText, sig: res.sig, status: res.state === "ok" ? "confirmed" : "pending" });
      d.emit({ kind: "withdraw", owner, asset: asset as string, amount: amountText, sig: res.sig });
      return { sig: res.sig, confirmed: res.state === "ok", asset, amount: amountText, to: dest.toBase58(), feesPaidSol: res.state === "ok" ? sol(feeTotal) : 0 };
    });
  }

  // Ручное закрытие: одна позиция или все свои. Работает и при выключателе.
  function closeOwn(owner: string, b: { positionId?: unknown; all?: unknown }) {
    if (d.cfg().mode === "off") throw new LiveError("Live trading is off. Withdraw the tokens from the trading wallet instead.", 409);
    let rows: PositionRow[];
    if (b.all === true) rows = db.prepare("SELECT * FROM live_positions WHERE owner = ? AND status IN ('opening', 'open')").all(owner) as unknown as PositionRow[];
    else {
      const id = Number(b.positionId);
      if (!Number.isInteger(id) || id <= 0) throw new LiveError("positionId or all: true is required");
      const p = posRow(id);
      if (!p || p.owner !== owner) throw new LiveError("Position not found", 404);
      if (p.status !== "open" && p.status !== "opening") throw new LiveError(`Position is ${p.status}`, 409);
      rows = [p];
    }
    return { queued: requestClose(rows, "manual") };
  }

  function requestClose(rows: PositionRow[], reason: string) {
    let n = 0;
    for (const p of rows) {
      if (p.status === "opening") {
        setPos(p.id, { close_requested: reason });
        n++;
      } else if (p.status === "open") {
        queueSell(p, reason);
        n++;
      }
    }
    return n;
  }

  // Админ: закрыть все открытые позиции всех пользователей (вместе с выключателем).
  function closeEverything(reason: string) {
    return requestClose(db.prepare("SELECT * FROM live_positions WHERE status IN ('opening', 'open')").all() as unknown as PositionRow[], reason);
  }

  // ---------- чтение для страницы ----------

  async function ownerStatus(owner: string) {
    const w = walletRow(owner);
    if (!w) return null;
    const cfg = d.cfg();
    const balance = await d.rpc()?.balance(w.pubkey).catch(() => null) ?? null;
    const open = (db.prepare("SELECT * FROM live_positions WHERE owner = ? AND status IN ('opening', 'open', 'closing') ORDER BY id DESC").all(owner) as unknown as PositionRow[]).map(positionView);
    const history = (db.prepare("SELECT * FROM live_positions WHERE owner = ? AND status IN ('closed', 'failed') ORDER BY id DESC LIMIT 50").all(owner) as unknown as PositionRow[]).map(positionView);
    const totals = db.prepare("SELECT mode, COUNT(*) AS n, COALESCE(SUM(pnl_lamports), 0) AS pnl, COALESCE(SUM(fee_lamports), 0) AS fee FROM live_positions WHERE owner = ? AND status = 'closed' GROUP BY mode").all(owner) as unknown as { mode: string; n: number; pnl: number; fee: number }[];
    const dayLoss = dayPnl(owner, cfg.mode === "off" ? "live" : cfg.mode);
    const notices = (db.prepare("SELECT detail, at FROM live_audit WHERE owner = ? AND kind = 'notice' ORDER BY id DESC LIMIT 20").all(owner) as unknown as { detail: string; at: number }[]).map((n) => ({ ...(JSON.parse(n.detail) as { code: string; text: string }), at: n.at }));
    const lossHit = dayLoss <= -lamportsOf(cfg.dailyLossSol);
    return {
      pubkey: w.pubkey,
      createdAt: w.created_at,
      balanceSol: balance !== null ? sol(balance) : null,
      settings: { enabled: !!w.enabled, strategies: parseStrategies(w.strategies), tradeSol: w.trade_sol, slippagePct: w.slippage_pct },
      paused: !!w.paused,
      pausedReason: w.paused_reason,
      today: { pnlSol: sol(dayLoss), lossLimitHit: lossHit, resumesAt: lossHit ? utcDayStart(now()) + DAY : null },
      open,
      history,
      totals: Object.fromEntries(totals.map((t) => [t.mode, { trades: t.n, pnlSol: sol(t.pnl), feesSol: sol(t.fee) }])) as Record<string, { trades: number; pnlSol: number; feesSol: number }>,
      pendingFeesSol: sol(pendingFees(owner).reduce((s, f) => s + f.fee_lamports, 0)),
      exportsLeftToday: Math.max(0, cfg.exportsPerDay - auditCountToday(owner, "export")),
      notices,
    };
  }

  function adminSummary() {
    const one = <T,>(sql: string) => db.prepare(sql).get() as T;
    const fees = db.prepare("SELECT status, COALESCE(SUM(fee_lamports), 0) AS fee, COALESCE(SUM(buyback_lamports), 0) AS bb FROM live_fees WHERE mode = 'live' GROUP BY status").all() as unknown as { status: string; fee: number; bb: number }[];
    const f = (s: string) => fees.find((x) => x.status === s) ?? { fee: 0, bb: 0 };
    return {
      wallets: one<{ n: number }>("SELECT COUNT(*) AS n FROM live_wallets").n,
      enabled: one<{ n: number }>("SELECT COUNT(*) AS n FROM live_wallets WHERE enabled = 1").n,
      openPositions: one<{ n: number }>("SELECT COUNT(*) AS n FROM live_positions WHERE status IN ('opening', 'open', 'closing')").n,
      stuckSells: one<{ n: number }>("SELECT COUNT(*) AS n FROM live_positions WHERE status = 'open' AND sell_attempts > 0").n,
      feesPaidSol: sol(f("paid").fee),
      feesPendingSol: sol(f("pending").fee),
      buybackMarkedSol: sol(f("paid").bb + f("pending").bb),
    };
  }

  return { onPaper, tick, openFor, sellNow, createWallet, setSettings, exportKey, withdraw, closeOwn, closeEverything, ownerStatus, adminSummary, notice };
}
export type LiveEngine = ReturnType<typeof createLiveEngine>;
