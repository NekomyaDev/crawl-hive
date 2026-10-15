// Сбор на DEX: сообщество скидывается на оплату профиля $CRAWLHIVE в DexScreener (Enhanced Token Info).
// SOL идёт на казну одной транзакцией из Phantom (перевод + memo), сервер находит перевод в сети и засчитывает
// его. Собранное держится отдельно от байбека: кнопка выкупа не тратит деньги сбора, пока цель не оплачена.
// Всё сверх цели и всё после оплаты профиля уходит в обычный байбек и сжигание.
import "server-only";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { ApiError, getMeta, isSigUsed, markSigUsed, setMeta } from "./store";
import { BUYBACK_TREASURY } from "../economy";
import { rpcConnection, solUsd } from "./solana";

const KEY = "dexFund";
const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const MEMO = "crawlhive:dexfund";
const MIN_SOL = 0.01;
const MAX_SOL = 50;

export const dexGoalUsd = () => {
  const n = Number(process.env.DEX_FUND_GOAL_USD);
  return n > 0 && n < 100_000 ? n : 299;
};

interface Gift {
  sig: string;
  wallet: string;
  sol: number;
  at: number;
}
interface Fund {
  gifts: Gift[];
  paidAt?: number; // профиль DexScreener оплачен: резерв снимается, дальше всё идёт в байбек
}

const load = (): Fund => {
  try {
    return { gifts: [], ...JSON.parse(getMeta(KEY) ?? "{}") };
  } catch {
    return { gifts: [] };
  }
};
const save = (f: Fund) => setMeta(KEY, JSON.stringify(f));

// Оплачен ли профиль токена в DexScreener: смотрим их публичный список заказов по токену.
let paidCache: { at: number; paid: boolean } | null = null;
async function dexPaid(mint: string): Promise<boolean> {
  if (paidCache && Date.now() - paidCache.at < 5 * 60_000) return paidCache.paid;
  let paid = paidCache?.paid ?? false;
  try {
    const r = await fetch(`https://api.dexscreener.com/orders/v1/solana/${mint}`, { signal: AbortSignal.timeout(6000) });
    if (r.ok) {
      const d = (await r.json()) as { orders?: { type?: string; status?: string }[] };
      paid = (d.orders ?? []).some((o) => o.type === "tokenProfile" && (o.status === "approved" || o.status === "processing"));
    }
  } catch {}
  paidCache = { at: Date.now(), paid };
  return paid;
}

const raisedSol = (f: Fund) => f.gifts.reduce((s, g) => s + g.sol, 0);

// Сколько SOL на казне занято сбором: кнопка байбека не должна их потратить, пока профиль не оплачен.
export async function dexReserveSol(): Promise<number> {
  const f = load();
  if (f.paidAt) return 0;
  const usd = await solUsd();
  const raised = raisedSol(f);
  const goalSol = usd ? dexGoalUsd() / usd : raised;
  return Math.min(raised, goalSol);
}

export async function dexFundStats() {
  const f = load();
  const mint = process.env.TOKEN_MINT?.trim() ?? "";
  const paid = !!f.paidAt || (mint ? await dexPaid(mint) : false);
  if (paid && !f.paidAt) {
    f.paidAt = Date.now();
    save(f);
  }
  const usd = await solUsd();
  const raised = raisedSol(f);
  const byWallet = new Map<string, number>();
  for (const g of f.gifts) byWallet.set(g.wallet, (byWallet.get(g.wallet) ?? 0) + g.sol);
  return {
    goalUsd: dexGoalUsd(),
    solUsd: usd,
    raisedSol: raised,
    raisedUsd: usd ? raised * usd : null,
    backers: byWallet.size,
    paid,
    treasury: BUYBACK_TREASURY,
    top: [...byWallet.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([wallet, sol]) => ({ wallet, sol })),
    recent: f.gifts.slice(-8).reverse().map((g) => ({ wallet: g.wallet, sol: g.sol, at: g.at, sig: g.sig })),
  };
}

// Неподписанная транзакция: перевод на казну и memo, по которому сервер узнаёт взнос в сбор.
export async function buildDexGift(wallet: string, amountSol: unknown) {
  let from: PublicKey;
  try {
    from = new PublicKey(wallet);
  } catch {
    throw new ApiError("Connect a Solana wallet first");
  }
  const sol = Number(amountSol);
  if (!Number.isFinite(sol) || sol < MIN_SOL || sol > MAX_SOL) throw new ApiError(`Chip in between ${MIN_SOL} and ${MAX_SOL} SOL`);
  const conn = rpcConnection();
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: from, blockhash, lastValidBlockHeight }).add(
    SystemProgram.transfer({ fromPubkey: from, toPubkey: new PublicKey(BUYBACK_TREASURY), lamports: Math.round(sol * LAMPORTS_PER_SOL) }),
    new TransactionInstruction({ programId: MEMO_PROGRAM, keys: [{ pubkey: from, isSigner: true, isWritable: false }], data: Buffer.from(MEMO) }),
  );
  return { transaction: tx.serialize({ requireAllSignatures: false }).toString("base64") };
}

// Взнос засчитывается по транзакции в сети: подписал отправитель, SOL дошли до казны, в memo наш маркер.
export async function confirmDexGift(signature: string) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(signature)) throw new ApiError("Bad transaction signature");
  if (isSigUsed(signature)) throw new ApiError("This transaction is already counted");
  const conn = rpcConnection();
  let tx = null;
  for (let i = 0; i < 6 && !tx; i++) {
    tx = await conn.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }).catch(() => null);
    if (!tx) await new Promise((r) => setTimeout(r, 2000));
  }
  if (!tx) throw new ApiError("Transaction not found yet, try again in a few seconds", 404);
  if (tx.meta?.err) throw new ApiError("This transaction failed onchain");
  const logs = tx.meta?.logMessages ?? [];
  if (!logs.some((l) => l.includes(MEMO))) throw new ApiError("This is not a DEX fund transaction");
  let lamports = 0;
  let wallet = "";
  for (const ix of tx.transaction.message.instructions) {
    const p = (ix as { parsed?: { type?: string; info?: { destination?: string; source?: string; lamports?: number } }; program?: string }).parsed;
    if ((ix as { program?: string }).program === "system" && p?.type === "transfer" && p.info?.destination === BUYBACK_TREASURY) {
      lamports += p.info.lamports ?? 0;
      wallet = p.info.source ?? wallet;
    }
  }
  const signer = tx.transaction.message.accountKeys.find((k) => k.signer)?.pubkey.toBase58();
  if (!lamports || !wallet || wallet !== signer) throw new ApiError("No SOL transfer to the treasury in this transaction");
  markSigUsed(signature);
  const f = load();
  const gift = { sig: signature, wallet, sol: lamports / LAMPORTS_PER_SOL, at: (tx.blockTime ?? Date.now() / 1000) * 1000 };
  f.gifts.push(gift);
  save(f);
  return gift;
}
