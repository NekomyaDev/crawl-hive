// История разработчика (crawler_dev): кто создал токен и чем кончились его прошлые запуски. Работает для
// токенов pump.fun: аккаунт кривой (bonding curve, PDA от минта) хранит адрес создателя, а одним запросом
// getProgramAccounts по этому адресу находятся все кривые, которые он создал, с флагом «дошёл до пула».
// Плюс возраст кошелька создателя и сколько этого токена у него осталось.
import "server-only";
import { PublicKey, type Connection } from "@solana/web3.js";

const PUMP = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
// Раскладка кривой: 8 байт дискриминатора, 5×u64 резервов, bool complete (48), creator (49..81).
const COMPLETE_AT = 48;
const CREATOR_AT = 49;
// Публичный RPC отвечает на getProgramAccounts по pump.fun за доли секунды; платный тариф может его не пускать.
const PUBLIC_RPC = "https://api.mainnet-beta.solana.com";
const CACHE_MS = 30 * 60_000;

export interface DevReport {
  creator: string;
  launched: number; // токенов через pump.fun, включая этот
  graduated: number; // сколько ПРОШЛЫХ запусков (без этого токена) дошли до пула
  walletAgeHours?: number; // возраст кошелька создателя, если у него меньше 1000 транзакций
  walletTxs: number; // транзакций (до 1000)
  holdsPct?: number; // сколько этого токена у создателя сейчас, % эмиссии
}

const g = globalThis as unknown as { __crawlhiveDev?: Map<string, { at: number; report: DevReport }> };
const cache = () => (g.__crawlhiveDev ??= new Map());

async function rpc<T>(endpoint: string, method: string, params: unknown[]): Promise<T> {
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  const j = (await r.json()) as { result?: T; error?: { message?: string } };
  if (j.error) throw new Error(j.error.message ?? method);
  return j.result as T;
}

// Создатель токена pump.fun или null, если у минта нет кривой (токен запущен не через pump.fun).
async function creatorOf(conn: Connection, mint: PublicKey): Promise<{ creator: string; complete: boolean } | null> {
  const [curve] = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), mint.toBuffer()], PUMP);
  const acc = await conn.getAccountInfo(curve);
  if (!acc || !acc.owner.equals(PUMP) || acc.data.length < CREATOR_AT + 32) return null;
  return { creator: new PublicKey(acc.data.subarray(CREATOR_AT, CREATOR_AT + 32)).toBase58(), complete: acc.data[COMPLETE_AT] === 1 };
}

// Все кривые создателя: сколько запусков и сколько дошли до пула. Берём только байт complete.
async function launchesOf(endpoint: string, creator: string) {
  const list = await rpc<{ account: { data: [string, string] } }[]>(endpoint, "getProgramAccounts", [
    PUMP.toBase58(),
    { encoding: "base64", dataSlice: { offset: COMPLETE_AT, length: 1 }, filters: [{ memcmp: { offset: CREATOR_AT, bytes: creator } }] },
  ]);
  const graduated = list.filter((a) => Buffer.from(a.account.data[0], "base64")[0] === 1).length;
  return { launched: list.length, graduated };
}

export async function traceDev(conn: Connection, mint: string, supplyRaw?: number): Promise<DevReport | null> {
  const hit = cache().get(mint);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.report;
  const key = new PublicKey(mint);
  const curve = await creatorOf(conn, key);
  if (!curve) return null;
  const { creator } = curve;
  const owner = new PublicKey(creator);

  const [launches, sigs, held] = await Promise.all([
    launchesOf(conn.rpcEndpoint, creator).catch(() => launchesOf(PUBLIC_RPC, creator)),
    conn.getSignaturesForAddress(owner, { limit: 1000 }).catch(() => []),
    conn.getTokenAccountsByOwner(owner, { mint: key }).catch(() => null),
  ]);

  let holdsPct: number | undefined;
  if (held && supplyRaw) {
    let raw = 0;
    for (const a of held.value) raw += Number(a.account.data.readBigUInt64LE(64)); // amount в токен-аккаунте
    holdsPct = (raw / supplyRaw) * 100;
  }
  const oldest = sigs.length && sigs.length < 1000 ? sigs[sigs.length - 1].blockTime : undefined;
  const report: DevReport = {
    creator,
    launched: Math.max(1, launches.launched),
    graduated: Math.max(0, launches.graduated - (curve.complete ? 1 : 0)),
    walletTxs: sigs.length,
    walletAgeHours: oldest ? (Date.now() / 1000 - oldest) / 3600 : undefined,
    holdsPct,
  };
  cache().set(mint, { at: Date.now(), report });
  return report;
}
