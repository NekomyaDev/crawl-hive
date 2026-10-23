// Спавн и продление краулера сжиганием $CRAWLHIVE вместо SOL, со скидкой SPAWN_BURN_DISCOUNT_PCT.
// Схема как у Pro (user-burns.ts): сервер считает котировку, собирает неподписанную транзакцию burnChecked + memo
// с номером котировки, Phantom подписывает и отправляет, сервер находит транзакцию в сети и проверяет каждую деталь.
// Сжигается 100% оплаты: токены никуда не переводятся, у сервера нет ни ключа, ни токенов.
// Котировки — meta "spawnBurnQuotes" (переживают перезапуск), журнал — общий "userBurns" с пометкой spawn/renew.
import "server-only";
import { randomBytes } from "node:crypto";
import { ComputeBudgetProgram, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { createBurnCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { MEMO_PROGRAM_ADDR, SPAWN_BURN_DISCOUNT_PCT, checkSpawnBurn, spawnBurnQuote } from "../burn-math";
import { TIERS } from "../economy";
import type { PublicCrawler, Tier } from "../types";
import { rpcConnection, solUsd, spawnBurnEnabled, spawnPrice } from "./solana";
import { ApiError, getMeta, renewCrawler, renewableCrawler, setMeta, spawnCrawlerPaid, validateSpawn, type SpawnInput } from "./store";
import { tokenPriceUsd } from "./tiers";
import { ALLOWED_PROGRAMS, burnMint, burnSigCounted, inflight, recordUserBurn, type UserBurn } from "./user-burns";

const QUOTE_TTL = 10 * 60_000;
const KEY = "spawnBurnQuotes";
const SYMBOL = "$CRAWLHIVE";

type Kind = "spawn" | "renew";
interface SpawnQuote {
  id: string;
  kind: Kind;
  wallet: string;
  tier: Tier;
  input?: SpawnInput; // для спавна: уже проверенные validateSpawn параметры
  crawlerId?: string; // для продления
  raw: string; // сколько сжечь, минимальные единицы
  tokens: number;
  usd: number; // цена со скидкой
  usdFull: number; // цена в SOL, пересчитанная в доллары, без скидки
  sol: number;
  createdAt: number;
  exp: number;
}

const memoOf = (kind: Kind, id: string) => `crawlhive:${kind}burn:${id}`;

function quotes(): Record<string, SpawnQuote> {
  try {
    return JSON.parse(getMeta(KEY) ?? "{}");
  } catch {
    return {};
  }
}
function saveQuote(q: SpawnQuote) {
  const all = quotes();
  for (const [k, v] of Object.entries(all)) if (v.exp < Date.now() - 24 * 3600_000) delete all[k]; // сутки храним и просроченные
  all[q.id] = q;
  setMeta(KEY, JSON.stringify(all));
}
function dropQuote(id: string) {
  const all = quotes();
  delete all[id];
  setMeta(KEY, JSON.stringify(all));
}

function assertEnabled(wallet: string) {
  if (!spawnBurnEnabled()) throw new ApiError("Paying with a $CRAWLHIVE burn is not enabled on this server", 400);
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) throw new ApiError("Burning needs a Solana wallet (Phantom)");
}

// Цена тира в токенах сейчас: SOL → доллары → скидка → токены. Без цены SOL или токена котировку не выдаём.
export async function spawnBurnPrice(tier: Tier, decimals: number) {
  const sol = spawnPrice(tier);
  if (sol.unit !== "SOL") throw new ApiError("Paying with a $CRAWLHIVE burn is not enabled on this server", 400);
  const [su, tu] = await Promise.all([solUsd(), tokenPriceUsd()]);
  if (!su || !tu) throw new ApiError("Price is unavailable right now, try again in a minute", 503);
  return { sol: sol.amount, solUsd: su, tokenUsd: tu, ...spawnBurnQuote({ sol: sol.amount, solUsd: su, tokenUsd: tu, discountPct: SPAWN_BURN_DISCOUNT_PCT, decimals }) };
}

async function build(wallet: string, kind: Kind, tier: Tier, what: { input?: SpawnInput; crawlerId?: string }) {
  assertEnabled(wallet);
  const { addr, m } = await burnMint();
  const p = await spawnBurnPrice(tier, m.decimals);
  const conn = rpcConnection();
  const owner = new PublicKey(wallet);
  const mintKey = new PublicKey(addr);
  const ata = getAssociatedTokenAddressSync(mintKey, owner, false, m.program);
  const bal = await conn.getTokenAccountBalance(ata).catch(() => null);
  if (BigInt(bal?.value.amount ?? "0") < p.raw)
    throw new ApiError(`You need ${p.tokens.toLocaleString("en-US")} ${SYMBOL} in this wallet (about $${p.usd.toFixed(2)})`);
  const id = randomBytes(8).toString("hex");
  const bh = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: owner,
    recentBlockhash: bh.blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 40_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
      createBurnCheckedInstruction(ata, mintKey, owner, p.raw, m.decimals, [], m.program),
      new TransactionInstruction({
        programId: new PublicKey(MEMO_PROGRAM_ADDR),
        keys: [{ pubkey: owner, isSigner: true, isWritable: false }],
        data: Buffer.from(memoOf(kind, id), "utf8"),
      }),
    ],
  }).compileToV0Message();
  const now = Date.now();
  saveQuote({ id, kind, wallet, tier, ...what, raw: p.raw.toString(), tokens: p.tokens, usd: p.usd, usdFull: p.usdFull, sol: p.sol, createdAt: now, exp: now + QUOTE_TTL });
  return {
    quoteId: id,
    transaction: Buffer.from(new VersionedTransaction(msg).serialize()).toString("base64"),
    tokens: p.tokens,
    usd: p.usd,
    usdFull: p.usdFull,
    sol: p.sol,
    discountPct: SPAWN_BURN_DISCOUNT_PCT,
    priceUsd: p.tokenUsd,
    expiresAt: now + QUOTE_TTL,
  };
}

// Только котировка, без транзакции: для показа суммы на странице спавна.
export async function quoteSpawnBurn(tierRaw: unknown) {
  if (!spawnBurnEnabled()) return { enabled: false as const };
  const tier = validTier(tierRaw);
  const { m } = await burnMint();
  const p = await spawnBurnPrice(tier, m.decimals);
  return { enabled: true as const, tier, tokens: p.tokens, usd: p.usd, usdFull: p.usdFull, sol: p.sol, discountPct: SPAWN_BURN_DISCOUNT_PCT };
}

function validTier(t: unknown): Tier {
  const tier = String(t);
  if (!Object.hasOwn(TIERS, tier)) throw new ApiError("Unknown tier");
  return tier as Tier;
}

export function buildSpawnBurn(wallet: string, raw: SpawnInput) {
  const input = validateSpawn(raw);
  return build(wallet, "spawn", input.tier, { input });
}

export function buildRenewBurn(wallet: string, crawlerId: string) {
  const { tier } = renewableCrawler(wallet, crawlerId);
  return build(wallet, "renew", tier, { crawlerId });
}

// Проверка в сети и зачёт. Возвращает краулера (новый или продлённый).
async function confirm(wallet: string, kind: Kind, quoteId: unknown, signature: unknown, crawlerId?: string): Promise<PublicCrawler> {
  assertEnabled(wallet);
  const sig = String(signature ?? "");
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(sig)) throw new ApiError("Bad signature");
  const q = quotes()[String(quoteId ?? "")];
  if (!q || q.wallet !== wallet || q.kind !== kind) throw new ApiError("Quote not found, start again", 404);
  if (kind === "renew" && q.crawlerId !== crawlerId) throw new ApiError("This burn is for another crawler");
  if (burnSigCounted(sig)) throw new ApiError("This burn was already counted", 409);
  const qKey = `quote:${q.id}`;
  if (inflight.has(sig) || inflight.has(qKey)) throw new ApiError("Already checking this burn, wait a moment", 429);
  inflight.add(sig);
  inflight.add(qKey);
  try {
    const { addr, m } = await burnMint();
    if (!ALLOWED_PROGRAMS.includes(m.program.toBase58())) throw new ApiError("Unexpected token program", 500);
    const conn = rpcConnection();
    let tx: ParsedTransactionWithMeta | null = null;
    for (let i = 0; i < 20 && !tx; i++) {
      tx = await conn.getParsedTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      if (!tx) await new Promise((r) => setTimeout(r, 1500));
    }
    if (!tx) throw new ApiError("Transaction not found yet. If Phantom shows it as sent, press the button again in a minute.", 404);
    const r = checkSpawnBurn(tx, { wallet, mint: addr, program: m.program.toBase58(), memo: memoOf(kind, q.id), minRaw: BigInt(q.raw), createdAt: q.createdAt, exp: q.exp });
    if (!r.ok) throw new ApiError(r.error, r.status);

    // Дальше без await: перечитываем и записываем за один синхронный шаг, параллельный confirm не засчитает дважды.
    if (burnSigCounted(sig)) throw new ApiError("This burn was already counted", 409);
    const cur = quotes()[q.id];
    if (!cur) throw new ApiError("This quote was already used", 409);
    const tokens = Number(r.raw) / 10 ** m.decimals;
    const payment = { unit: SYMBOL, amount: tokens, tx: sig };
    // Сначала сам продукт: если он не создастся, подпись не сгорает и её можно засчитать повторно.
    // В счётчик сети «Credits burned» не пишем (0): реальные сжигания токена считает журнал userBurns.
    const crawler = kind === "spawn" ? spawnCrawlerPaid(wallet, q.input!, payment, 0) : renewCrawler(wallet, q.crawlerId!, payment);
    const rec: UserBurn = { sig, wallet, purpose: kind, tokens, crawlerId: crawler.id, tier: q.tier, at: r.at };
    recordUserBurn(rec, r.raw);
    dropQuote(q.id);
    return crawler;
  } finally {
    inflight.delete(sig);
    inflight.delete(qKey);
  }
}

export const confirmSpawnBurn = (wallet: string, quoteId: unknown, signature: unknown) => confirm(wallet, "spawn", quoteId, signature);
export const confirmRenewBurn = (wallet: string, crawlerId: string, quoteId: unknown, signature: unknown) =>
  confirm(wallet, "renew", quoteId, signature, crawlerId);
