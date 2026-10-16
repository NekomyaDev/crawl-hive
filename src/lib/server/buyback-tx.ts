// Сборка и разбор транзакций байбека: SOL → токен проекта через Jupiter и сжигание купленного в той же транзакции.
// Только сетевые запросы и web3 без состояния сайта, поэтому файл можно прогнать отдельным скриптом
// (симуляция без отправки). Подключают его лишь серверные модули: ключей тут нет, подписывает Phantom казны.
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
  type ParsedTransactionWithMeta,
  type TokenBalance,
} from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createBurnCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";

export const WSOL_MINT = "So11111111111111111111111111111111111111112";
// USDC от оплат x402 тоже идёт в байбек: тот же свап через Jupiter, только вход USDC.
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const JUPITER_PROGRAM = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
export const BUYBACK_MEMO = "crawlhive:buyback";
export const BUYBACK_USDC_MEMO = "crawlhive:buyback:x402";
// lite-api — бесплатный вход Jupiter без ключа; api.jup.ag — запасной, если lite когда-нибудь закроют.
const JUP_BASES = ["https://lite-api.jup.ag/swap/v1", "https://api.jup.ag/swap/v1"];
const MAX_TX_BYTES = 1232;
// Запас вычислений на burnChecked и memo: Jupiter считает лимит только под свой свап.
const EXTRA_CU = 40_000;
// Потолок приоритетной комиссии, чтобы в загруженной сети байбек не съел заметную долю суммы.
const MAX_PRIORITY_LAMPORTS = 1_000_000;

export class BuybackError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface MintInfo {
  program: PublicKey;
  decimals: number;
  supplyRaw: bigint;
}

// Классический SPL или Token-2022 определяем по владельцу аккаунта минта; там же десятичные и текущая эмиссия.
export async function readMint(conn: Connection, mint: PublicKey): Promise<MintInfo> {
  const r = await conn.getParsedAccountInfo(mint);
  const acc = r.value;
  if (!acc) throw new BuybackError("Token mint not found on chain", 500);
  if (!acc.owner.equals(TOKEN_PROGRAM_ID) && !acc.owner.equals(TOKEN_2022_PROGRAM_ID)) throw new BuybackError("TOKEN_MINT is not a token mint", 500);
  const info = (acc.data as { parsed?: { info?: { decimals?: number; supply?: string } } }).parsed?.info;
  if (info?.decimals === undefined || info.supply === undefined) throw new BuybackError("Cannot read the token mint", 500);
  return { program: acc.owner, decimals: info.decimals, supplyRaw: BigInt(info.supply) };
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
  routePlan: { swapInfo: { label?: string } }[];
  [k: string]: unknown;
}

interface JupIx {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string;
}

interface JupSwapIxs {
  computeBudgetInstructions?: JupIx[];
  setupInstructions?: JupIx[];
  swapInstruction: JupIx;
  cleanupInstruction?: JupIx | null;
  otherInstructions?: JupIx[];
  addressLookupTableAddresses?: string[];
  error?: string;
}

async function jup<T>(path: string, init?: RequestInit): Promise<T> {
  let last = "";
  for (const base of JUP_BASES) {
    try {
      const r = await fetch(base + path, { ...init, headers: { "Content-Type": "application/json", Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
      const j = (await r.json().catch(() => ({}))) as T & { error?: string; errorCode?: string };
      if (r.ok && !j.error) return j;
      last = j.error || j.errorCode || `HTTP ${r.status}`;
      // 4xx с понятной ошибкой (нет маршрута, мало ликвидности) — запасной адрес ответит то же самое.
      if (r.status >= 400 && r.status < 500 && r.status !== 401 && r.status !== 403 && r.status !== 404 && r.status !== 429) break;
    } catch (e) {
      last = (e as Error).message;
    }
  }
  throw new BuybackError(`Jupiter: ${last}`, 502);
}

export function jupQuote(outputMint: string, amount: bigint, slippageBps: number, maxAccounts: number, inputMint = WSOL_MINT) {
  const q = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amount.toString(),
    slippageBps: String(slippageBps),
    restrictIntermediateTokens: "true",
    // Оставляем место под burn и memo в той же транзакции.
    maxAccounts: String(maxAccounts),
  });
  return jup<JupQuote>(`/quote?${q}`);
}

const toIx = (i: JupIx) =>
  new TransactionInstruction({
    programId: new PublicKey(i.programId),
    keys: i.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
    data: Buffer.from(i.data, "base64"),
  });

async function lookupTables(conn: Connection, addrs: string[]): Promise<AddressLookupTableAccount[]> {
  if (!addrs.length) return [];
  const keys = addrs.map((a) => new PublicKey(a));
  const infos = await conn.getMultipleAccountsInfo(keys);
  return infos.flatMap((info, i) => (info ? [new AddressLookupTableAccount({ key: keys[i], state: AddressLookupTableAccount.deserialize(info.data) })] : []));
}

// Лимит вычислений от Jupiter (инструкция SetComputeUnitLimit, дискриминатор 2) поднимаем на запас под burn.
function bumpComputeLimit(ixs: TransactionInstruction[]): TransactionInstruction[] {
  let found = false;
  const out = ixs.map((ix) => {
    if (!ix.programId.equals(ComputeBudgetProgram.programId) || ix.data[0] !== 2 || ix.data.length < 5) return ix;
    found = true;
    const units = Math.min(1_400_000, ix.data.readUInt32LE(1) + EXTRA_CU);
    return ComputeBudgetProgram.setComputeUnitLimit({ units });
  });
  if (!found) out.unshift(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
  return out;
}

const memoIx = (owner: PublicKey, text: string) =>
  new TransactionInstruction({ programId: MEMO_PROGRAM, keys: [{ pubkey: owner, isSigner: true, isWritable: false }], data: Buffer.from(text, "utf8") });

export interface BuiltBuyback {
  transaction: string; // base64 неподписанной VersionedTransaction
  quote: { inSol: number; inUsdc: number; outTokens: number; minTokens: number; priceImpactPct: number; route: string[]; slippageBps: number };
  burnRaw: string;
  lastValidBlockHeight: number;
}

// Котировка → инструкции свапа → одна v0-транзакция: compute budget, setup, swap, cleanup, burnChecked, memo.
// Точный выход до исполнения неизвестен, поэтому жжём гарантированный минимум (otherAmountThreshold);
// остаток сверх минимума остаётся в ATA казны и сжигается отдельной кнопкой.
export async function buildBuybackTx(
  conn: Connection,
  opts: { owner: PublicKey; mint: PublicKey; lamports: bigint; slippageBps: number; mintInfo?: MintInfo; usdc?: boolean },
): Promise<BuiltBuyback> {
  const { owner, mint, lamports, slippageBps } = opts;
  // usdc: lamports — это атомарные единицы USDC (6 знаков), вход свапа — USDC казны.
  const input = opts.usdc ? USDC_MINT : WSOL_MINT;
  const m = opts.mintInfo ?? (await readMint(conn, mint));
  const ata = getAssociatedTokenAddressSync(mint, owner, false, m.program);
  let lastErr = "";
  // Маршрут с большим числом аккаунтов может не влезть в 1232 байта вместе с burn: сужаем и пробуем снова.
  for (const maxAccounts of [54, 40, 28]) {
    const quote = await jupQuote(mint.toBase58(), lamports, slippageBps, maxAccounts, input);
    const minOut = BigInt(quote.otherAmountThreshold);
    if (minOut <= BigInt(0)) throw new BuybackError("Jupiter quote returns zero tokens");
    const ixs = await jup<JupSwapIxs>("/swap-instructions", {
      method: "POST",
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: owner.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: MAX_PRIORITY_LAMPORTS, priorityLevel: "high" } },
      }),
    });
    const instructions = [
      ...bumpComputeLimit((ixs.computeBudgetInstructions ?? []).map(toIx)),
      ...(ixs.otherInstructions ?? []).map(toIx),
      ...(ixs.setupInstructions ?? []).map(toIx),
      toIx(ixs.swapInstruction),
      ...(ixs.cleanupInstruction ? [toIx(ixs.cleanupInstruction)] : []),
      createBurnCheckedInstruction(ata, mint, owner, minOut, m.decimals, [], m.program),
      memoIx(owner, opts.usdc ? BUYBACK_USDC_MEMO : BUYBACK_MEMO),
    ];
    const [alts, bh] = await Promise.all([lookupTables(conn, ixs.addressLookupTableAddresses ?? []), conn.getLatestBlockhash("confirmed")]);
    const msg = new TransactionMessage({ payerKey: owner, recentBlockhash: bh.blockhash, instructions }).compileToV0Message(alts);
    const tx = new VersionedTransaction(msg);
    let bytes: Uint8Array;
    try {
      bytes = tx.serialize();
    } catch (e) {
      lastErr = (e as Error).message;
      continue;
    }
    if (bytes.length > MAX_TX_BYTES) {
      lastErr = `transaction is ${bytes.length} bytes`;
      continue;
    }
    const scale = 10 ** m.decimals;
    return {
      transaction: Buffer.from(bytes).toString("base64"),
      quote: {
        inSol: opts.usdc ? 0 : Number(quote.inAmount) / 1e9,
        inUsdc: opts.usdc ? Number(quote.inAmount) / 1e6 : 0,
        outTokens: Number(quote.outAmount) / scale,
        minTokens: Number(minOut) / scale,
        priceImpactPct: Number(quote.priceImpactPct) * 100,
        route: quote.routePlan.map((r) => r.swapInfo.label ?? "?"),
        slippageBps,
      },
      burnRaw: minOut.toString(),
      lastValidBlockHeight: bh.lastValidBlockHeight,
    };
  }
  throw new BuybackError(`Swap route does not fit into one transaction with the burn (${lastErr}). Try a smaller amount.`, 502);
}

// Сжечь весь остаток токена в ATA казны (пыль сверх гарантированного минимума после байбеков).
export async function buildBurnAllTx(conn: Connection, opts: { owner: PublicKey; mint: PublicKey; mintInfo?: MintInfo }) {
  const { owner, mint } = opts;
  const m = opts.mintInfo ?? (await readMint(conn, mint));
  const ata = getAssociatedTokenAddressSync(mint, owner, false, m.program);
  const bal = await conn.getTokenAccountBalance(ata).catch(() => null);
  const raw = BigInt(bal?.value.amount ?? "0");
  if (raw <= BigInt(0)) throw new BuybackError("Nothing to burn: the treasury holds no tokens");
  const bh = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: owner,
    recentBlockhash: bh.blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
      createBurnCheckedInstruction(ata, mint, owner, raw, m.decimals, [], m.program),
      memoIx(owner, BUYBACK_MEMO),
    ],
  }).compileToV0Message();
  return {
    transaction: Buffer.from(new VersionedTransaction(msg).serialize()).toString("base64"),
    tokens: Number(raw) / 10 ** m.decimals,
    burnRaw: raw.toString(),
    lastValidBlockHeight: bh.lastValidBlockHeight,
  };
}

// ---------- разбор подтверждённой транзакции ----------

export interface ParsedBuyback {
  kind: "buyback" | "burn";
  solSpent: number; // сколько SOL ушло из казны (свап плюс комиссии; для чистого сжигания — 0)
  usdcSpent: number; // сколько USDC казны ушло в свап (байбек на выручку x402)
  burnedRaw: bigint;
  boughtRaw: bigint;
  at: number;
}

// Проверяем всё по самой транзакции: успех, подпись казны, сжигание именно нашего минта от имени казны.
export function parseBuybackTx(tx: ParsedTransactionWithMeta, owner: string, mint: string): ParsedBuyback {
  if (tx.meta?.err) throw new BuybackError("Transaction failed on-chain");
  const keys = tx.transaction.message.accountKeys;
  const idx = keys.findIndex((k) => k.pubkey.toBase58() === owner);
  if (idx < 0 || !keys[idx].signer) throw new BuybackError("Transaction was not signed by the treasury", 403);

  // Сжигания ищем и среди верхних инструкций, и во вложенных (на случай, если burn вызовет другая программа).
  const all = [...tx.transaction.message.instructions, ...(tx.meta?.innerInstructions ?? []).flatMap((x) => x.instructions)];
  let burnedRaw = BigInt(0);
  let swapped = false;
  for (const ix of all) {
    const pid = ix.programId.toBase58();
    if (pid === JUPITER_PROGRAM) swapped = true;
    if (!("parsed" in ix) || (pid !== TOKEN_PROGRAM_ID.toBase58() && pid !== TOKEN_2022_PROGRAM_ID.toBase58())) continue;
    const { type, info } = (ix.parsed ?? {}) as { type?: string; info?: Record<string, unknown> & { tokenAmount?: { amount: string } } };
    if ((type === "burn" || type === "burnChecked") && info && info.mint === mint && (info.authority ?? info.multisigAuthority) === owner)
      burnedRaw += BigInt(info.tokenAmount?.amount ?? String(info.amount ?? "0"));
  }
  if (burnedRaw <= BigInt(0)) throw new BuybackError("Transaction does not burn the project token");

  const pre = tx.meta?.preBalances[idx] ?? 0;
  const post = tx.meta?.postBalances[idx] ?? 0;
  // Купленное = изменение баланса токена у казны плюс сожжённое в этой же транзакции.
  const tokenBal = (list?: TokenBalance[] | null) =>
    (list ?? []).filter((b) => b.mint === mint && b.owner === owner).reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), BigInt(0));
  const delta = tokenBal(tx.meta?.postTokenBalances) - tokenBal(tx.meta?.preTokenBalances);
  const usdcBal = (list?: TokenBalance[] | null) =>
    (list ?? []).filter((b) => b.mint === USDC_MINT && b.owner === owner).reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), BigInt(0));
  const usdcRaw = usdcBal(tx.meta?.preTokenBalances) - usdcBal(tx.meta?.postTokenBalances);
  const usdcSpent = swapped && usdcRaw > BigInt(0) ? Number(usdcRaw) / 1e6 : 0;
  return {
    kind: swapped ? "buyback" : "burn",
    // Свап из USDC: SOL ушли только на комиссию, в «потрачено SOL» их не пишем.
    solSpent: swapped && !usdcSpent ? Math.max(0, pre - post) / 1e9 : 0,
    usdcSpent,
    burnedRaw,
    boughtRaw: swapped ? delta + burnedRaw : BigInt(0),
    at: (tx.blockTime ?? Math.floor(Date.now() / 1000)) * 1000,
  };
}
