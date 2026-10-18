// Сбор на DEX: сообщество скидывается на оплату профиля $CRAWLHIVE в DexScreener (Enhanced Token Info).
// SOL идёт на казну одной транзакцией из Phantom (перевод + memo), сервер находит перевод в сети и засчитывает
// его. Собранное держится отдельно от байбека: кнопка выкупа не тратит деньги сбора, пока цель не оплачена.
// Уровни идут лестницей (профиль, потом бусты): после покупки одного сбор продолжается на следующий.
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

// Лестница уровней DEX: сначала профиль, потом бусты по нарастающей. Цены DexScreener на 10.2026, их можно
// переопределить DEX_LEVELS='[{"id":"profile","usd":299},…]'. Уровень «живой», когда DexScreener показывает его
// в публичных заказах токена; тогда его стоимость считается потраченной из сбора.
export interface DexLevel {
  id: string;
  title: string;
  note: string;
  usd: number;
  boost?: number; // размер буста в DexScreener; у профиля нет
}
const DEFAULT_LEVELS: DexLevel[] = [
  { id: "profile", title: "DEX paid", note: "Enhanced Token Info: logo, banner, links and socials on every chart", usd: 299 },
  { id: "boost10", title: "Boost 10x", note: "10 boosts for 12 hours: higher on DexScreener trending", usd: 99, boost: 10 },
  { id: "boost30", title: "Boost 30x", note: "30 boosts for 12 hours", usd: 249, boost: 30 },
  { id: "boost100", title: "Boost 100x", note: "100 boosts for 24 hours", usd: 899, boost: 100 },
  { id: "boost500", title: "Golden ticker", note: "500 boosts: the golden ticker on DexScreener", usd: 3999, boost: 500 },
];
export function dexLevels(): DexLevel[] {
  try {
    const raw = process.env.DEX_LEVELS?.trim();
    if (raw) {
      const v = JSON.parse(raw) as Partial<DexLevel>[];
      const byId = new Map(DEFAULT_LEVELS.map((l) => [l.id, l]));
      const out = v.map((x) => ({ ...(byId.get(String(x.id)) ?? { id: String(x.id), title: String(x.id), note: "" }), ...x }) as DexLevel).filter((l) => l.usd > 0);
      if (out.length) return out;
    }
  } catch {}
  return DEFAULT_LEVELS;
}

interface Gift {
  sig: string;
  wallet: string;
  sol: number;
  at: number;
}
interface Fund {
  gifts: Gift[];
  startedAt?: number;
}

const load = (): Fund => {
  try {
    return { gifts: [], ...JSON.parse(getMeta(KEY) ?? "{}") };
  } catch {
    return { gifts: [] };
  }
};
const save = (f: Fund) => setMeta(KEY, JSON.stringify(f));

// Что из лестницы уже куплено в DexScreener: публичный список заказов по токену. Бусты считаем только
// купленные после старта сбора, иначе чужой старый буст «съел» бы деньги сообщества.
let liveCache: { at: number; profile: boolean; boosts: number[] } | null = null;
async function dexLive(mint: string, since: number) {
  if (liveCache && Date.now() - liveCache.at < 5 * 60_000) return liveCache;
  const prev = liveCache ?? { at: 0, profile: false, boosts: [] as number[] };
  let v = { at: Date.now(), profile: prev.profile, boosts: prev.boosts };
  try {
    const r = await fetch(`https://api.dexscreener.com/orders/v1/solana/${mint}`, { signal: AbortSignal.timeout(6000) });
    if (r.ok) {
      const d = (await r.json()) as { orders?: { type?: string; status?: string }[]; boosts?: { amount?: number; paymentTimestamp?: number }[] };
      v = {
        at: Date.now(),
        profile: (d.orders ?? []).some((o) => o.type === "tokenProfile" && (o.status === "approved" || o.status === "processing")),
        boosts: (d.boosts ?? []).filter((b) => (b.paymentTimestamp ?? 0) >= since).map((b) => Number(b.amount) || 0),
      };
    }
  } catch {}
  liveCache = v;
  return v;
}

// Перевод казны самой себе (с memo сбора) — не пожертвование: такие взносы не считаем и не замораживаем.
const raisedSol = (f: Fund) => f.gifts.filter((g) => g.wallet !== BUYBACK_TREASURY).reduce((s, g) => s + g.sol, 0);
// Сбор закрыт (DEX_FUND_OFF=1): кнопок на сайте нет, новые взносы не принимаются. Внешние пожертвования, если были,
// остаются отложенными, пока владелец не решит, что с ними делать.
export const dexFundOff = () => process.env.DEX_FUND_OFF === "1";

// Уровни со статусом: live — куплен в DexScreener, funded — сбор покрыл его цену, иначе открыт.
async function ladder(f: Fund) {
  const mint = process.env.TOKEN_MINT?.trim() ?? "";
  const live = mint ? await dexLive(mint, f.startedAt ?? 0) : { profile: false, boosts: [] as number[] };
  const boosts = [...live.boosts];
  // Уровни, оплаченные не из сбора (DEX_PAID_ELSEWHERE="profile"): считаются пройденными, но их цена из сбора не вычитается.
  const elsewhere = new Set((process.env.DEX_PAID_ELSEWHERE ?? "").split(",").map((x) => x.trim()).filter(Boolean));
  const levels = dexLevels().map((l) => {
    if (elsewhere.has(l.id)) return { ...l, live: true, external: true };
    let isLive = false;
    if (!l.boost) isLive = live.profile;
    else {
      const i = boosts.indexOf(l.boost);
      if (i >= 0) {
        isLive = true;
        boosts.splice(i, 1);
      }
    }
    return { ...l, live: isLive, external: false };
  });
  const spentUsd = levels.filter((l) => l.live && !l.external).reduce((s, l) => s + l.usd, 0);
  return { levels, spentUsd };
}

// Сколько SOL на казне занято сбором: всё собранное минус уже потраченное на уровни. Кнопка байбека их не тратит.
export async function dexReserveSol(): Promise<number> {
  const f = load();
  const raised = raisedSol(f);
  if (!raised) return 0;
  const usd = await solUsd();
  if (!usd) return raised;
  const { spentUsd } = await ladder(f);
  return Math.max(0, raised - spentUsd / usd);
}

export async function dexFundStats() {
  const f = load();
  if (!f.startedAt) {
    f.startedAt = Date.now();
    save(f);
  }
  const usd = await solUsd();
  const raised = raisedSol(f);
  const raisedUsd = usd ? raised * usd : null;
  const { levels, spentUsd } = await ladder(f);
  // Текущий уровень — первый, который ещё не куплен. Прогресс к нему: собранное сверх уже потраченного и сверх
  // цен профинансированных, но ещё не купленных уровней перед ним.
  const idx = levels.findIndex((l) => !l.live);
  let pool = raisedUsd != null ? Math.max(0, raisedUsd - spentUsd) : 0;
  const out = levels.map((l, i) => {
    if (l.live) return { ...l, status: "live" as const, haveUsd: l.usd };
    const have = Math.min(l.usd, pool);
    pool -= have;
    return { ...l, status: have >= l.usd ? ("funded" as const) : i === idx || have > 0 ? ("open" as const) : ("next" as const), haveUsd: have };
  });
  const current = out.find((l) => l.status !== "live" && l.status !== "funded") ?? out.at(-1)!;
  const byWallet = new Map<string, number>();
  for (const g of f.gifts) if (g.wallet !== BUYBACK_TREASURY) byWallet.set(g.wallet, (byWallet.get(g.wallet) ?? 0) + g.sol);
  return {
    // Совместимость со старой карточкой: цель и «оплачено» относятся к профилю.
    goalUsd: current.usd,
    paid: out[0]?.status === "live",
    level: current,
    levels: out,
    solUsd: usd,
    raisedSol: raised,
    raisedUsd,
    backers: byWallet.size,
    treasury: BUYBACK_TREASURY,
    top: [...byWallet.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([wallet, sol]) => ({ wallet, sol })),
    recent: f.gifts.filter((g) => g.wallet !== BUYBACK_TREASURY).slice(-8).reverse().map((g) => ({ wallet: g.wallet, sol: g.sol, at: g.at, sig: g.sig })),
    off: dexFundOff(),
  };
}

// Неподписанная транзакция: перевод на казну и memo, по которому сервер узнаёт взнос в сбор.
export async function buildDexGift(wallet: string, amountSol: unknown) {
  if (dexFundOff()) throw new ApiError("The DEX fund is closed", 410);
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
  f.startedAt ??= Date.now();
  const gift = { sig: signature, wallet, sol: lamports / LAMPORTS_PER_SOL, at: (tx.blockTime ?? Date.now() / 1000) * 1000 };
  f.gifts.push(gift);
  save(f);
  return gift;
}
