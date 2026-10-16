// Лаунчпад CrawlHive: монета запускается на pump.fun прямо с сайта, и рой сразу её сканирует.
// Ключ минта создаётся в браузере (сюда приходит только публичная половина), сервер кладёт картинку и метаданные
// в IPFS, собирает транзакцию create_v2 (плюс первая покупка автора) и отправляет её, только если обе подписи
// стоят на сообщении, байт в байт совпадающем с собранным. Ключей у сервера нет, комиссии платформы нет (0%).
// Перенесено из лаунчпада Gem Search (gem-search/launchpad/launch.mjs).
import "server-only";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { AddressLookupTableAccount, ComputeBudgetProgram, PublicKey, TransactionMessage, VersionedTransaction, type Connection, type TransactionInstruction } from "@solana/web3.js";
import { ApiError, getMeta, setMeta } from "./store";
import { publicConfig, rpcConnection } from "./solana";
import { runScan } from "./scan";

// SDK pump.fun — CommonJS с anchor внутри; через require, чтобы бандлер не тащил его в клиент.
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PUMP_SDK, OnlinePumpSdk, getBuyTokenAmountFromSolAmount } = require("@pump-fun/pump-sdk");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const BN = require("bn.js");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bs58: { encode: (b: Uint8Array) => string } = require("bs58");

const SOL_MINT = "So11111111111111111111111111111111111111112";
export const MAX_DEV_BUY_SOL = 5;
const TX_LIMIT = 1232;
const BUILT_TTL = 150_000; // blockhash живёт ~60–90 с, чуть больше — на медленное окно кошелька
const LOG_KEY = "launches";
const LOG_MAX = 500;
const PER_IP_HOUR = Number(process.env.LAUNCHES_PER_IP_HOUR ?? 6);
const PER_DAY = Number(process.env.LAUNCHES_PER_DAY ?? 150);
// Публичная таблица адресов с ключами, общими для всех запусков pump.fun (сделана для лаунчпада Gem Search):
// запуск с первой покупкой без неё почти упирается в 1232 байта, с ней ~970.
const LAUNCH_TABLE = process.env.LAUNCH_TABLE?.trim() || "6PRSyzJ6aDPA827RfPyY2fJ5f4yGzwCrj4GUyjyUMKmU";

interface Built {
  at: number;
  message: string;
  creator: string;
  mint: string;
  lastValidBlockHeight: number;
  name: string;
  symbol: string;
  image: string;
  devBuySol: number;
}
export interface LaunchRecord {
  mint: string;
  name: string;
  symbol: string;
  image: string;
  creator: string;
  devBuySol: number;
  signature: string;
  at: number;
  verdict?: string | null;
  score?: number | null;
}

interface LaunchState {
  built: Map<string, Built>;
  pending: Map<string, LaunchRecord>;
  hits: Map<string, number[]>;
  globals?: { at: number; global: unknown; feeConfig: unknown };
  table?: { at: number; account: AddressLookupTableAccount | null };
}
const g = globalThis as unknown as { __crawlhiveLaunch?: LaunchState };
const st = (): LaunchState => (g.__crawlhiveLaunch ??= { built: new Map(), pending: new Map(), hits: new Map() });

export function launchEnabled() {
  return !!process.env.PINATA_JWT?.trim() && publicConfig().cluster === "mainnet-beta" && process.env.LAUNCHPAD_PAUSED !== "1";
}

function limit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const s = st();
  const list = (s.hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) throw new ApiError("Too many launches from here right now, try again later", 429);
  list.push(now);
  s.hits.set(key, list);
  for (const [k, b] of s.built) if (now - b.at > BUILT_TTL) s.built.delete(k);
}

// ---------- форма ----------

const URL_RE = /^https:\/\/[^\s]{3,200}$/;
const starts = (b: Uint8Array, ...sig: number[]) => sig.every((x, i) => b[i] === x);
function imageMatches(type: string, b: Uint8Array) {
  if (type === "image/png") return starts(b, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (type === "image/jpeg") return starts(b, 0xff, 0xd8, 0xff);
  if (type === "image/gif") return starts(b, 0x47, 0x49, 0x46, 0x38);
  if (type === "image/webp") return starts(b, 0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
  return false;
}

function parseLaunch(body: Record<string, unknown>) {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const name = str(body.name);
  if (name.length < 2 || name.length > 32) throw new ApiError("Name: 2 to 32 characters");
  const symbol = str(body.symbol).replace(/^\$/, "").toUpperCase();
  if (!/^[A-Z0-9]{2,10}$/.test(symbol)) throw new ApiError("Ticker: 2 to 10 letters or digits");
  const description = str(body.description);
  if (description.length > 500) throw new ApiError("Description: up to 500 characters");
  const links: Record<string, string> = {};
  for (const k of ["website", "twitter", "telegram"]) {
    const v = str(body[k]);
    if (v && !URL_RE.test(v)) throw new ApiError(`${k}: a full https:// link`);
    if (v) links[k] = v;
  }
  const devBuySol = body.devBuySol === undefined || body.devBuySol === "" ? 0 : Number(body.devBuySol);
  if (!Number.isFinite(devBuySol) || devBuySol < 0 || devBuySol > MAX_DEV_BUY_SOL) throw new ApiError(`Dev buy: 0 to ${MAX_DEV_BUY_SOL} SOL`);
  const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(str(body.image));
  if (!m) throw new ApiError("Image: a PNG, JPEG, WebP or GIF");
  const bytes = new Uint8Array(Buffer.from(m[2], "base64"));
  if (bytes.length > 2_000_000) throw new ApiError("Image: up to 2 MB");
  if (!imageMatches(m[1], bytes)) throw new ApiError("Image: the file is not the type it claims to be");
  let creator: PublicKey, mint: PublicKey;
  try {
    creator = new PublicKey(str(body.creator));
    mint = new PublicKey(str(body.mint));
  } catch {
    throw new ApiError("Connect a wallet first");
  }
  if (creator.equals(mint)) throw new ApiError("The mint must be a fresh key");
  return { name, symbol, description, links, devBuySol, image: { type: m[1], bytes }, creator, mint };
}

// ---------- IPFS ----------

async function pin(name: string, body: Uint8Array | string, type: string) {
  const form = new FormData();
  form.append("network", "public");
  form.append("file", new Blob([typeof body === "string" ? body : Buffer.from(body)], { type }), name);
  const res = await fetch("https://uploads.pinata.cloud/v3/files", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.PINATA_JWT?.trim()}` },
    body: form,
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!res?.ok) throw new ApiError(`Could not store the picture right now (${res?.status ?? 0}), try again`, 502);
  const cid = ((await res.json().catch(() => null)) as { data?: { cid?: string } } | null)?.data?.cid;
  if (!cid) throw new ApiError("Could not store the picture right now, try again", 502);
  return `https://ipfs.io/ipfs/${cid}`;
}

// ---------- транзакция ----------

async function pumpGlobals(conn: Connection) {
  const s = st();
  if (s.globals && Date.now() - s.globals.at < 600_000) return s.globals;
  const sdk = new OnlinePumpSdk(conn);
  const [global, feeConfig] = await Promise.all([sdk.fetchGlobal(), sdk.fetchFeeConfig().catch(() => null)]);
  return (s.globals = { at: Date.now(), global, feeConfig });
}

async function launchInstructions(conn: Connection, creator: PublicKey, mint: PublicKey, meta: { name: string; symbol: string; uri: string }, lamports: bigint, priority: boolean) {
  let create: TransactionInstruction[];
  if (lamports > BigInt(0)) {
    const { global, feeConfig } = await pumpGlobals(conn);
    const solAmount = new BN(lamports.toString());
    // Первая покупка на новой кривой: количество токенов точное, потолок SOL с 1% на округление.
    const amount = getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: null, bondingCurve: null, amount: solAmount, quoteMint: new PublicKey(SOL_MINT) });
    create = await PUMP_SDK.createV2AndBuyInstructions({ global, mint, name: meta.name, symbol: meta.symbol, uri: meta.uri, creator, user: creator, amount, solAmount: solAmount.muln(101).divn(100), mayhemMode: false });
  } else {
    create = [await PUMP_SDK.createV2Instruction({ mint, name: meta.name, symbol: meta.symbol, uri: meta.uri, creator, user: creator, mayhemMode: false })];
  }
  const budget = !priority
    ? []
    : lamports > BigInt(0)
      ? [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 75_000 })]
      : [ComputeBudgetProgram.setComputeUnitLimit({ units: 250_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200_000 })];
  return [...budget, ...create];
}

async function lookupTable(conn: Connection) {
  const s = st();
  if (s.table && Date.now() - s.table.at < 600_000) return s.table.account;
  const account = (await conn.getAddressLookupTable(new PublicKey(LAUNCH_TABLE)).catch(() => null))?.value ?? null;
  s.table = { at: Date.now(), account };
  return account;
}

// Не влезла в 1232 байта с приоритетной комиссией — собираем без неё (~45 байт).
async function buildLaunch(conn: Connection, creator: PublicKey, mint: PublicKey, meta: { name: string; symbol: string; uri: string }, devBuySol: number) {
  const lamports = BigInt(Math.round(Math.min(Math.max(devBuySol, 0), MAX_DEV_BUY_SOL) * 1e9));
  const [{ blockhash, lastValidBlockHeight }, table] = await Promise.all([conn.getLatestBlockhash("confirmed"), lookupTable(conn)]);
  let size = 0;
  for (const priority of [true, false]) {
    const message = new TransactionMessage({ payerKey: creator, recentBlockhash: blockhash, instructions: await launchInstructions(conn, creator, mint, meta, lamports, priority) }).compileToV0Message(table ? [table] : []);
    const tx = new VersionedTransaction(message);
    size = tx.serialize().length;
    if (size <= TX_LIMIT) return { tx, message: Buffer.from(message.serialize()).toString("base64"), lastValidBlockHeight };
  }
  throw new ApiError(`That launch does not fit one transaction (${size} of ${TX_LIMIT} bytes): shorten the name or ticker, or lower the dev buy`);
}

function checkSigned(signedB64: string, b: Built) {
  let tx: VersionedTransaction;
  try {
    tx = VersionedTransaction.deserialize(Buffer.from(signedB64, "base64"));
  } catch {
    throw new ApiError("That is not a signed transaction");
  }
  if (Buffer.from(tx.message.serialize()).toString("base64") !== b.message) throw new ApiError("The transaction was changed after it was built, start the launch again");
  const keys = tx.message.staticAccountKeys;
  for (const [who, key] of [["your wallet", b.creator], ["the mint", b.mint]] as const) {
    const i = keys.findIndex((k) => k.toBase58() === key);
    if (i < 0 || i >= tx.message.header.numRequiredSignatures || tx.signatures[i].every((x) => x === 0)) throw new ApiError(`The transaction is not signed by ${who}`);
  }
  return tx;
}

// ---------- шаги ----------

export async function prepareLaunch(ip: string, body: Record<string, unknown>) {
  if (!launchEnabled()) throw new ApiError("Launches are not switched on yet", 503);
  const f = parseLaunch(body);
  limit(`ip:${ip}`, PER_IP_HOUR, 3_600_000);
  limit("all", PER_DAY, 86_400_000);
  const ext = f.image.type.split("/")[1];
  const image = await pin(`${f.symbol}.${ext}`, f.image.bytes, f.image.type);
  const metadata = { name: f.name, symbol: f.symbol, description: f.description, image, showName: true, createdOn: "https://crawlhive.xyz/launch", ...f.links };
  const uri = await pin(`${f.symbol}.json`, JSON.stringify(metadata), "application/json");
  const conn = rpcConnection();
  const b = await buildLaunch(conn, f.creator, f.mint, { name: f.name, symbol: f.symbol, uri }, f.devBuySol);
  const id = randomBytes(12).toString("hex");
  st().built.set(id, { at: Date.now(), message: b.message, creator: f.creator.toBase58(), mint: f.mint.toBase58(), lastValidBlockHeight: b.lastValidBlockHeight, name: f.name, symbol: f.symbol, image, devBuySol: f.devBuySol });
  return { id, tx: Buffer.from(b.tx.serialize()).toString("base64"), image, uri };
}

async function broadcast(conn: Connection, tx: VersionedTransaction): Promise<"sent" | "unsure"> {
  try {
    await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 });
    return "sent";
  } catch (e) {
    const full = String((e as Error).message).replace(/\s+/g, " ");
    const msg = (/Message: (.*?)(?: Logs:|$)/.exec(full)?.[1] ?? full).slice(0, 200);
    if (/blockhash not found/i.test(full)) throw new ApiError("The signature took too long and the launch expired, start again");
    if (/insufficient|no record of a prior credit|0x1\b/i.test(full)) throw new ApiError("Not enough SOL in your wallet: a launch needs about 0.03 SOL plus the dev buy");
    if (/simulat|preflight|custom program error/i.test(full)) throw new ApiError(`The network refused the launch: ${msg}`);
    return "unsure";
  }
}

const readLog = (): LaunchRecord[] => {
  try {
    return JSON.parse(getMeta(LOG_KEY) ?? "[]") as LaunchRecord[];
  } catch {
    return [];
  }
};
function saveLaunch(r: LaunchRecord) {
  const list = readLog().filter((x) => x.mint !== r.mint);
  setMeta(LOG_KEY, JSON.stringify([r, ...list].slice(0, LOG_MAX)));
}

// Рой сканирует новорождённую монету по тем же правилам, что и любую другую: вердикт уходит в Track Record.
function scanAtBirth(rec: LaunchRecord) {
  setTimeout(() => {
    runScan(rec.mint, () => {})
      .then((r) => {
        const res = r as { verdict?: string; score?: number } | null;
        saveLaunch({ ...rec, verdict: res?.verdict ?? null, score: res?.score ?? null });
      })
      .catch(() => {});
  }, 15_000);
}

export async function submitLaunch(body: Record<string, unknown>) {
  const s = st();
  const id = String(body.id ?? "");
  const b = s.built.get(id);
  if (!b) throw new ApiError("That launch expired, start again");
  const tx = checkSigned(String(body.signed ?? ""), b);
  s.built.delete(id);
  const conn = rpcConnection();
  const signature = bs58.encode(tx.signatures[0]);
  const record: LaunchRecord = { mint: b.mint, name: b.name, symbol: b.symbol, image: b.image, creator: b.creator, devBuySol: b.devBuySol, signature, at: Date.now() };
  // Ответ сети не дошёл: запуск ждёт подтверждения в launchStatus и попадёт в список, когда станет живым.
  if ((await broadcast(conn, tx)) === "unsure") {
    s.pending.set(signature, record);
    return { status: "pending", signature, mint: b.mint };
  }
  const res = await conn.confirmTransaction({ signature, blockhash: tx.message.recentBlockhash, lastValidBlockHeight: b.lastValidBlockHeight }, "confirmed").catch(() => null);
  if (res?.value?.err) throw new ApiError(`The launch failed onchain: ${JSON.stringify(res.value.err).slice(0, 200)}`);
  if (!res) {
    s.pending.set(signature, record);
    return { status: "pending", signature, mint: b.mint };
  }
  saveLaunch(record);
  scanAtBirth(record);
  return { status: "live", signature, mint: b.mint };
}

// Подтверждение отложенного запуска: транзакция дошла позже ответа сервера.
export async function launchStatus(signature: string) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(signature)) throw new ApiError("Bad signature");
  const r = await rpcConnection().getSignatureStatus(signature, { searchTransactionHistory: true }).catch(() => null);
  const v = r?.value;
  if (!v) return { status: "pending" };
  if (v.err) {
    st().pending.delete(signature);
    return { status: "failed" };
  }
  if (v.confirmationStatus === "processed") return { status: "pending" };
  const rec = st().pending.get(signature);
  if (rec) {
    st().pending.delete(signature);
    saveLaunch(rec);
    scanAtBirth(rec);
  }
  return { status: "live", mint: rec?.mint };
}

export function recentLaunches(n = 24) {
  return { enabled: launchEnabled(), maxDevBuySol: MAX_DEV_BUY_SOL, launches: readLog().slice(0, n) };
}
