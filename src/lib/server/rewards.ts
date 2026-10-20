// «Crawler of the day»: половина дневных комиссий создателя токена уходит владельцу лучшего краулера дня.
// Очки за сигналы, проверенные за сутки UTC: пик ≥2x даёт +floor(кратность), слив (−50% и ниже) даёт −1.
// Ничья — по доле попаданий. Победитель должен держать $CRAWLHIVE (REWARD_MIN_HOLD, по умолчанию 1).
// Выплату делает владелец проекта из Phantom (казна или CREATOR_WALLET): сервер собирает перевод SOL,
// проверяет его в сети и публично записывает. Ключей на сервере нет.
import "server-only";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, TransactionInstruction, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { BUYBACK_TREASURY } from "../economy";
import { ApiError, getMeta, setMeta, settledSignals } from "./store";
import { rpcConnection } from "./solana";
import { tokenConfig } from "./buyback";

const DAY = 86400_000;
const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const SOL_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_DAYS = 90;

const minHold = () => Math.max(0, Number(process.env.REWARD_MIN_HOLD ?? 1) || 0);
export const creatorWallet = () => process.env.CREATOR_WALLET?.trim() || null;
// Кто может платить награду: казна и кошелёк создателя токена (комиссии pump.fun приходят ему).
export const rewardPayers = () => [BUYBACK_TREASURY, creatorWallet()].filter((x): x is string => !!x);

const dayKey = (ts: number) => new Date(ts).toISOString().slice(0, 10);
const dayStart = (key: string) => Date.parse(`${key}T00:00:00Z`);

export interface BoardRow {
  crawlerId: string;
  name: string;
  owner: string;
  points: number;
  hits: number;
  signals: number;
  hitRate: number;
  eligible: boolean | null; // null — токена ещё нет, проверка держания пропущена (превью)
}

export interface DaySnapshot {
  day: string;
  winner: BoardRow | null;
  top: BoardRow[];
  decidedAt: number;
  paid?: { sol: number; tx: string; at: number; by: string };
}

// Очки краулеров за сутки, без проверки держания.
function score(day: string): BoardRow[] {
  const from = dayStart(day);
  const by = new Map<string, BoardRow>();
  for (const s of settledSignals(from, from + DAY)) {
    const r = by.get(s.crawlerId) ?? { crawlerId: s.crawlerId, name: s.crawlerName, owner: s.owner, points: 0, hits: 0, signals: 0, hitRate: 0, eligible: null };
    const multiple = 1 + s.peakPct / 100;
    if (multiple >= 2) r.points += Math.floor(multiple);
    else if (s.changePct <= -50 || s.lowPct <= -50) r.points -= 1; // слив или раг стоит очко
    r.signals++;
    if (s.status === "hit") r.hits++;
    r.owner = s.owner || r.owner;
    by.set(s.crawlerId, r);
  }
  return [...by.values()]
    .map((r) => ({ ...r, hitRate: r.signals ? r.hits / r.signals : 0 }))
    .sort((a, b) => b.points - a.points || b.hitRate - a.hitRate || b.signals - a.signals);
}

// ---------- держатели ----------

interface RewardsCache {
  hold: Map<string, { at: number; ok: boolean }>;
  board?: { at: number; v: unknown };
}
const g = globalThis as unknown as { __crawlhiveRewards?: RewardsCache };
const cache = (): RewardsCache => (g.__crawlhiveRewards ??= { hold: new Map() });

// Сколько $CRAWLHIVE на кошельке (в целых токенах), кэш 5 минут. null — RPC не ответил и кэша нет.
const balances = new Map<string, { at: number; ui: number }>();
export async function tokenBalance(owner: string): Promise<number | null> {
  const { mint } = tokenConfig();
  if (!mint || !SOL_ADDRESS.test(owner)) return 0; // кошелёк EVM не держит токен на Solana
  const hit = balances.get(owner);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.ui;
  try {
    const res = await rpcConnection().getParsedTokenAccountsByOwner(new PublicKey(owner), { mint: new PublicKey(mint) });
    let ui = 0;
    for (const a of res.value) ui += Number(a.account.data.parsed.info.tokenAmount.uiAmount ?? 0);
    balances.set(owner, { at: Date.now(), ui });
    if (balances.size > 5000) balances.clear();
    return ui;
  } catch {
    return hit?.ui ?? null;
  }
}

async function holds(owner: string): Promise<boolean> {
  return ((await tokenBalance(owner)) ?? 0) >= minHold();
}

// Держатель $CRAWLHIVE для бонусов (live-радар, лимиты бота): порог HOLDER_MIN, по умолчанию 100 000 токенов.
export const holderMin = () => Math.max(1, Number(process.env.HOLDER_MIN ?? 100_000) || 100_000);
export async function isHolder(owner: string | null | undefined): Promise<boolean> {
  if (!owner) return false;
  return ((await tokenBalance(owner)) ?? 0) >= holderMin();
}

// Помечаем держание у верхних строк, пока не наберём limit подходящих (не дёргаем RPC на весь список).
async function markEligible(rows: BoardRow[], limit: number): Promise<BoardRow[]> {
  if (!tokenConfig().mint) return rows.map((r) => ({ ...r, eligible: null }));
  const out: BoardRow[] = [];
  let ok = 0;
  for (const r of rows.slice(0, 15)) {
    const eligible = await holds(r.owner);
    out.push({ ...r, eligible });
    if (eligible && ++ok >= limit) break;
  }
  return out;
}

// ---------- снимки прошедших дней ----------

function history(): DaySnapshot[] {
  try {
    return JSON.parse(getMeta("rewards") ?? "[]") as DaySnapshot[];
  } catch {
    return [];
  }
}
const saveHistory = (h: DaySnapshot[]) => setMeta("rewards", JSON.stringify(h.sort((a, b) => b.day.localeCompare(a.day)).slice(0, MAX_DAYS)));

// Итог вчерашнего дня фиксируется один раз (с проверкой держания на момент фиксации), дальше не меняется.
// Пока токена нет, ничего не фиксируем: показываем превью.
async function settleYesterday(): Promise<DaySnapshot | null> {
  const day = dayKey(Date.now() - DAY);
  const h = history();
  const have = h.find((x) => x.day === day);
  if (have) return have;
  const rows = await markEligible(score(day), 3);
  const snap: DaySnapshot = { day, winner: rows.find((r) => r.eligible && r.points > 0) ?? null, top: rows.slice(0, 3), decidedAt: Date.now() };
  if (tokenConfig().mint) saveHistory([snap, ...h]);
  return snap;
}

// Доска текущего дня: топ-3 вживую. Кэш на минуту.
export async function rewardsBoard() {
  const c = cache();
  if (c.board && Date.now() - c.board.at < 60_000) return c.board.v as Awaited<ReturnType<typeof buildBoard>>;
  const v = await buildBoard();
  c.board = { at: Date.now(), v };
  return v;
}

async function buildBoard() {
  const now = Date.now();
  const today = dayKey(now);
  const rows = await markEligible(score(today), 3);
  return {
    day: today,
    endsAt: dayStart(today) + DAY,
    preview: !tokenConfig().mint,
    minHold: minHold(),
    top: rows.filter((r) => r.eligible !== false).slice(0, 3),
    crawlers: rows.length,
  };
}

// Последний победитель (самый свежий день, где он был), вчерашний итог и история выплат.
export async function lastWinner() {
  const yesterday = await settleYesterday().catch(() => null);
  const h = history();
  const last = h.find((x) => x.winner) ?? (yesterday?.winner ? yesterday : null);
  return { last, yesterday, history: h.filter((x) => x.winner).slice(0, 30) };
}

export const resetRewardsCache = () => {
  cache().board = undefined;
};

// ---------- выплата победителю ----------

const memoText = (day: string) => `crawlhive:reward:${day}`;

function assertPayer(wallet: string) {
  if (!rewardPayers().includes(wallet)) throw new ApiError("Only the treasury or the creator wallet can pay rewards", 403);
}

function payable(day: unknown): DaySnapshot {
  const d = String(day ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new ApiError("Bad day");
  const snap = history().find((x) => x.day === d);
  if (!snap?.winner) throw new ApiError("No winner for this day");
  if (snap.paid) throw new ApiError("This day's reward is already paid");
  if (!SOL_ADDRESS.test(snap.winner.owner)) throw new ApiError("The winner has no Solana wallet");
  return snap;
}

const rate = new Map<string, number>();

export async function buildRewardPayout(wallet: string, day: unknown, amountSol: unknown) {
  assertPayer(wallet);
  if (Date.now() - (rate.get(wallet) ?? 0) < 3000) throw new ApiError("Too many requests, wait a moment", 429);
  rate.set(wallet, Date.now());
  const snap = payable(day);
  const amount = Number(amountSol);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000) throw new ApiError("Enter an amount of SOL above zero");
  const conn = rpcConnection();
  const owner = new PublicKey(wallet);
  const lamports = Math.round(amount * LAMPORTS_PER_SOL);
  const bal = await conn.getBalance(owner);
  if (bal < lamports + 10_000) throw new ApiError(`Not enough SOL: the wallet has ${(bal / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: owner, blockhash, lastValidBlockHeight })
    .add(SystemProgram.transfer({ fromPubkey: owner, toPubkey: new PublicKey(snap.winner!.owner), lamports }))
    .add(new TransactionInstruction({ programId: MEMO_PROGRAM, keys: [{ pubkey: owner, isSigner: true, isWritable: false }], data: Buffer.from(memoText(snap.day), "utf8") }));
  return {
    transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
    to: snap.winner!.owner,
    amount,
    day: snap.day,
  };
}

export async function confirmRewardPayout(wallet: string, day: unknown, signature: unknown) {
  assertPayer(wallet);
  const snap = payable(day);
  const sig = String(signature ?? "");
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(sig)) throw new ApiError("Bad signature");
  const conn = rpcConnection();
  let tx: ParsedTransactionWithMeta | null = null;
  for (let i = 0; i < 20 && !tx; i++) {
    tx = await conn.getParsedTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!tx) await new Promise((r) => setTimeout(r, 1500));
  }
  if (!tx) throw new ApiError("Transaction not found yet, try again in a minute", 404);
  if (tx.meta?.err) throw new ApiError("Transaction failed on-chain");
  if (!tx.transaction.message.accountKeys.some((k) => k.signer && k.pubkey.toBase58() === wallet)) throw new ApiError("Transaction was not signed by your wallet", 403);
  const ixs = tx.transaction.message.instructions;
  if (!ixs.some((ix) => ix.programId.equals(MEMO_PROGRAM) && "parsed" in ix && ix.parsed === memoText(snap.day))) throw new ApiError("Transaction is not linked to this day (memo missing)");
  let lamports = 0;
  for (const ix of ixs) {
    if (!ix.programId.equals(SystemProgram.programId) || !("parsed" in ix)) continue;
    const { type, info } = ix.parsed ?? {};
    if (type === "transfer" && info.source === wallet && info.destination === snap.winner!.owner) lamports += Number(info.lamports);
  }
  if (lamports <= 0) throw new ApiError("Transaction does not pay the winner");
  // Перечитываем историю после сетевых запросов: два параллельных confirm не запишут выплату дважды.
  const h = history();
  const cur = h.find((x) => x.day === snap.day);
  if (!cur || cur.paid) throw new ApiError("This day's reward is already paid");
  cur.paid = { sol: lamports / LAMPORTS_PER_SOL, tx: sig, at: (tx.blockTime ?? Math.floor(Date.now() / 1000)) * 1000, by: wallet };
  saveHistory(h);
  return cur;
}

// Итоги для админки.
export function rewardsTotals() {
  const paid = history().filter((x) => x.paid);
  return { paidDays: paid.length, paidSol: paid.reduce((s, x) => s + (x.paid?.sol ?? 0), 0) };
}
