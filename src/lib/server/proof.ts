// Onchain Proof: трек-рекорд, который нельзя переписать задним числом. Каждые 15 минут все новые вердикты
// сканера и сигналы краулеров складываются в дерево Меркла, и его корень записывается в Solana обычной
// Memo-транзакцией. Удалить неудачный колл или поправить вердикт после того, как цена сходила, уже нельзя:
// корень в блокчейне перестанет сходиться. Любой может пересчитать лист и путь до корня сам (/track).
//
// Формат (v1):
//   лист  = sha256(0x00 || canon(record)),  canon = JSON с ключами по алфавиту
//   узел  = sha256(0x01 || left || right), непарный последний узел поднимается выше как есть
//   memo  = "crawlhive:proof:v1:<from, unix сек>:<число листов>:<корень hex>"
// Приватные сигналы живых краулеров не раскрываются: в листе лежит только отпечаток содержимого с солью
// (`c`), поэтому по нему нельзя подобрать токен, а владелец сигнала может доказать, что колл был.
import "server-only";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ComputeBudgetProgram, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { getMeta, liveSignalsBetween, metaValue, setMeta } from "./store";
import { trackBetween } from "./track";
import { rpcConnection } from "./solana";

export const PROOF_WINDOW_MS = 15 * 60_000;
const SETTLE_MS = 60_000; // окно закрываем через минуту после конца: успевают дописаться последние записи
const RESEND_MS = 120_000; // транзакция не появилась за 2 минуты — блокхеш истёк, отправляем заново
const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const CURSOR = "proofCursor";
const SEARCH_DAYS = 45;

export type ProofRecord =
  | { t: "verdict"; chain: string; token: string; symbol: string; verdict: string; score: number | null; src: string; at: number; price: number }
  | { t: "signal"; id: string; crawler: string; kind: string; ts: number; conf: number; c: string };

export interface ProofBatch {
  from: number;
  to: number;
  root: string;
  count: number;
  sig: string | null;
  sentAt?: number;
  confirmed?: boolean;
  leaves: ProofRecord[];
}

// ---------- дерево ----------

export const canon = (o: Record<string, unknown>) => JSON.stringify(o, Object.keys(o).sort());
const sha = (...parts: Buffer[]) => createHash("sha256").update(Buffer.concat(parts)).digest();
const leafHash = (r: ProofRecord) => sha(Buffer.from([0]), Buffer.from(canon(r as Record<string, unknown>)));

function levels(leaves: Buffer[]): Buffer[][] {
  const out = [leaves];
  while (out[out.length - 1].length > 1) {
    const cur = out[out.length - 1];
    const next: Buffer[] = [];
    for (let i = 0; i < cur.length; i += 2) next.push(i + 1 < cur.length ? sha(Buffer.from([1]), cur[i], cur[i + 1]) : cur[i]);
    out.push(next);
  }
  return out;
}

function pathFor(leaves: Buffer[], index: number) {
  const proof: { side: "L" | "R"; hash: string }[] = [];
  let i = index;
  for (const lvl of levels(leaves).slice(0, -1)) {
    const sib = i % 2 ? i - 1 : i + 1;
    if (sib < lvl.length) proof.push({ side: i % 2 ? "L" : "R", hash: lvl[sib].toString("hex") });
    i = Math.floor(i / 2);
  }
  return proof;
}

// ---------- записи ----------

// Соль на сигнал — HMAC от его id: хранить отдельно не нужно, а без ключа сервера отпечаток не подобрать.
const saltKey = () => metaValue("proofSaltKey", () => randomBytes(32).toString("hex"));
export function signalSalt(id: string) {
  return createHmac("sha256", saltKey()).update(id).digest("hex");
}

function records(from: number, to: number): ProofRecord[] {
  const verdicts: ProofRecord[] = trackBetween(from, to).map((e) => ({
    t: "verdict",
    chain: e.chain,
    token: e.id,
    symbol: e.symbol,
    verdict: e.verdict,
    score: e.score,
    src: e.src,
    at: e.at,
    price: e.price0,
  }));
  const signals: ProofRecord[] = liveSignalsBetween(from, to).map((s) => {
    const content = canon({ chain: s.token?.chain ?? "", address: s.token?.address ?? "", ticker: s.ticker, text: s.text });
    return {
      t: "signal",
      id: s.id,
      crawler: s.crawlerId,
      kind: s.kind,
      ts: s.ts,
      conf: Math.round(s.confidence * 1000) / 1000,
      c: createHash("sha256").update(signalSalt(s.id) + content).digest("hex"),
    };
  });
  return [...verdicts, ...signals].sort((a, b) => (a.t === "verdict" ? a.at : a.ts) - (b.t === "verdict" ? b.at : b.ts));
}

// ---------- хранение: по файлу на день UTC ----------

const dir = () => path.join(process.env.DATA_DIR?.trim() || path.join(/* turbopackIgnore: true */ process.cwd(), ".data"), "proofs");
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const g = globalThis as unknown as { __crawlhiveProof?: { days: Map<string, ProofBatch[]>; started: boolean; busy: boolean } };
const st = () => (g.__crawlhiveProof ??= { days: new Map(), started: false, busy: false });

function readDay(day: string): ProofBatch[] {
  const s = st();
  const hit = s.days.get(day);
  if (hit) return hit;
  let v: ProofBatch[] = [];
  try {
    const f = path.join(dir(), `${day}.json`);
    if (existsSync(f)) v = JSON.parse(readFileSync(f, "utf8"));
  } catch (e) {
    console.warn("[proof] read", day, (e as Error).message);
  }
  s.days.set(day, v);
  return v;
}

function writeDay(day: string, v: ProofBatch[]) {
  st().days.set(day, v);
  mkdirSync(dir(), { recursive: true });
  const f = path.join(dir(), `${day}.json`);
  writeFileSync(`${f}.tmp`, JSON.stringify(v));
  renameSync(`${f}.tmp`, f);
}

function recentDays(n = SEARCH_DAYS): string[] {
  let files: string[] = [];
  try {
    files = readdirSync(dir()).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 10));
  } catch {}
  return files.sort().reverse().slice(0, n);
}

// ---------- запись корня в блокчейн ----------

function notary(): Keypair | null {
  const raw = process.env.PROOF_SECRET?.trim();
  if (!raw) return null;
  try {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  } catch {
    console.warn("[proof] PROOF_SECRET is not a JSON byte array");
    return null;
  }
}

export const memoText = (b: Pick<ProofBatch, "from" | "count" | "root">) => `crawlhive:proof:v1:${Math.floor(b.from / 1000)}:${b.count}:${b.root}`;

async function send(kp: Keypair, b: ProofBatch): Promise<string> {
  const conn = rpcConnection();
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: kp.publicKey, blockhash, lastValidBlockHeight }).add(
    // Memo проверяет UTF-8 побайтно: 96 байт с подписантом съедают ~49k единиц (замерено симуляцией).
    ComputeBudgetProgram.setComputeUnitLimit({ units: 70_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 }),
    new TransactionInstruction({ programId: MEMO_PROGRAM, keys: [{ pubkey: kp.publicKey, isSigner: true, isWritable: false }], data: Buffer.from(memoText(b)) }),
  );
  tx.sign(kp);
  return conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
}

async function commitPending(kp: Keypair) {
  const conn = rpcConnection();
  const now = Date.now();
  let budget = 4; // за один проход не больше 4 отправок: догоняем постепенно, не упираясь в лимиты RPC
  for (const day of recentDays(3).reverse()) {
    const batches = readDay(day);
    let dirty = false;
    for (const b of batches) {
      if (b.confirmed) continue;
      if (b.sig) {
        const stat = (await conn.getSignatureStatuses([b.sig], { searchTransactionHistory: true })).value[0];
        if (stat && !stat.err && (stat.confirmationStatus === "confirmed" || stat.confirmationStatus === "finalized")) {
          b.confirmed = true;
          dirty = true;
          continue;
        }
        if (stat && !stat.err) continue; // ещё в пути
        if (!stat && now - (b.sentAt ?? 0) < RESEND_MS) continue;
      }
      if (budget-- <= 0) break;
      try {
        b.sig = await send(kp, b);
        b.sentAt = Date.now();
        dirty = true;
      } catch (e) {
        console.warn("[proof] send", (e as Error).message);
        break;
      }
    }
    if (dirty) writeDay(day, batches);
    if (budget <= 0) break;
  }
}

// Закрываем все прошедшие 15-минутные окна, потом отправляем неподтверждённые корни.
export async function proofTick() {
  const s = st();
  if (s.busy) return;
  s.busy = true;
  try {
    const now = Date.now();
    const edge = Math.floor((now - SETTLE_MS) / PROOF_WINDOW_MS) * PROOF_WINDOW_MS;
    // Первый запуск начинает с текущего окна: старые записи задним числом не «доказываем», это было бы нечестно.
    let cursor = Number(getMeta(CURSOR)) || edge;
    let steps = 0;
    while (cursor + PROOF_WINDOW_MS <= edge && steps++ < 200) {
      const from = cursor;
      const to = cursor + PROOF_WINDOW_MS;
      const leaves = records(from, to);
      if (leaves.length) {
        const root = levels(leaves.map(leafHash)).at(-1)![0].toString("hex");
        const day = dayOf(from);
        const list = readDay(day).filter((b) => b.from !== from);
        list.push({ from, to, root, count: leaves.length, sig: null, leaves });
        list.sort((a, b) => a.from - b.from);
        writeDay(day, list);
      }
      cursor = to;
      setMeta(CURSOR, String(cursor));
    }
    if (!getMeta(CURSOR)) setMeta(CURSOR, String(cursor));
    const kp = notary();
    if (kp) await commitPending(kp);
  } finally {
    s.busy = false;
  }
}

export function startProof() {
  const s = st();
  if (s.started) return;
  s.started = true;
  setTimeout(() => proofTick().catch((e) => console.warn("[proof]", (e as Error).message)), 30_000);
  setInterval(() => proofTick().catch((e) => console.warn("[proof]", (e as Error).message)), 60_000);
  console.log(`[crawlhive] onchain proof started${notary() ? "" : " (PROOF_SECRET not set: roots are kept, not committed)"}`);
}

// ---------- чтение для сайта ----------

const status = (b: ProofBatch) => (b.confirmed ? "onchain" : b.sig ? "sending" : "pending");

let balCache: { at: number; sol: number | null } | null = null;
async function notaryBalance(pk: PublicKey | null) {
  if (!pk) return null;
  if (balCache && Date.now() - balCache.at < 60_000) return balCache.sol;
  const sol = await rpcConnection()
    .getBalance(pk)
    .then((l) => l / LAMPORTS_PER_SOL)
    .catch(() => null);
  balCache = { at: Date.now(), sol };
  return sol;
}

export async function proofSummary() {
  const kp = notary();
  const days = recentDays();
  const all = days.flatMap((d) => [...readDay(d)].reverse());
  const sinceDay = recentDays(10_000).at(-1);
  return {
    format: "v1",
    windowMinutes: PROOF_WINDOW_MS / 60_000,
    notary: kp?.publicKey.toBase58() ?? null,
    notarySol: await notaryBalance(kp?.publicKey ?? null),
    since: sinceDay ? readDay(sinceDay)[0]?.from ?? null : null,
    batches: all.length,
    records: all.reduce((n, b) => n + b.count, 0),
    onchain: all.filter((b) => b.confirmed).length,
    latest: all.slice(0, 12).map((b) => ({ from: b.from, to: b.to, root: b.root, count: b.count, sig: b.sig, status: status(b), memo: memoText(b) })),
  };
}

// Поиск записи по id сигнала или адресу токена: лист, путь до корня и транзакция с корнем.
export function findProof(q: string) {
  const key = q.trim();
  if (!key) return [];
  const out: {
    record: ProofRecord;
    leaf: string;
    proof: { side: "L" | "R"; hash: string }[];
    root: string;
    from: number;
    to: number;
    count: number;
    sig: string | null;
    status: string;
    memo: string;
  }[] = [];
  for (const day of recentDays()) {
    for (const b of [...readDay(day)].reverse()) {
      const idx = b.leaves.findIndex((r) => (r.t === "signal" ? r.id === key : r.token === key || r.token.toLowerCase() === key.toLowerCase()));
      if (idx < 0) continue;
      const hashes = b.leaves.map(leafHash);
      out.push({ record: b.leaves[idx], leaf: hashes[idx].toString("hex"), proof: pathFor(hashes, idx), root: b.root, from: b.from, to: b.to, count: b.count, sig: b.sig, status: status(b), memo: memoText(b) });
      if (out.length >= 5) return out;
    }
  }
  return out;
}

// Полное окно со всеми листьями: можно скачать и пересобрать корень целиком.
export function proofBatch(from: number) {
  return readDay(dayOf(from)).find((b) => b.from === from) ?? null;
}

// Логи транзакции с корнем — запасной путь для страницы, когда публичный RPC Solana не отвечает браузеру.
export async function proofTxLogs(sig: string): Promise<string[] | null> {
  const tx = await rpcConnection()
    .getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" })
    .catch(() => null);
  return tx?.meta?.logMessages ?? null;
}
