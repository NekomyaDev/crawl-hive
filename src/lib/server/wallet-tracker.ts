// Wallet tracker для людей: человек вставляет кошельки, за которыми хочет следить, и получает в Telegram алерт,
// когда такой кошелёк купил или продал токен. К каждой покупке прикладываем вердикт CrawlHive по этому токену.
// Источник событий тот же вебхук Helius, что и у краулеров-наблюдателей (wallet-watch.ts): адреса трекера
// добавляются в его список, а /api/helius/webhook отдаёт сюда тело уже после ответа 200, обработка асинхронная.
// Владелец: кошелёк из подписанной сессии сайта или кошелёк, привязанный к чату бота (tg:<кошелёк>). Без кошелька
// в боте владелец - сам чат (chat:<id>), это всегда free. Лимит кошельков по тарифу (TIER_LIMITS.trackedWallets);
// free получает алерты с задержкой FREE_RADAR_DELAY_MIN, Holder и выше сразу.
// Хранение: та же SQLite, что у памяти роя (memory-db.ts), свои таблицы tracked и tracked_moves.
import "server-only";
import { ApiError } from "./store";
import { memDb } from "./memory-db";
import { TIER_LIMITS, TIER_USD, tierOf, type Tier } from "./tiers";

const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const WSOL = "So11111111111111111111111111111111111111112";
const STABLES = new Set(["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"]); // USDC, USDT
const DUST_SOL = 0.05;
const DUST_USD = 8; // примерно те же 0.05 SOL для сделок за стейблы
const ALERTS_PER_HOUR = 60;
const VERDICT_FRESH_MS = 30 * 60_000;
const SCAN_TIMEOUT_MS = 30_000;
// Общий лимит быстрых сканов трекера: краулеры ходят во внешние API, а один кошелёк-бот может дёргать десятки монет.
const SCANS_PER_WINDOW = 20;
const SCAN_WINDOW_MS = 10 * 60_000;
const MAX_TX_AGE_MS = 60 * 60_000; // повторы Helius старше часа уже не новость
const MOVES_KEEP_MS = 7 * 86400_000;

export const short = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;
const strip = (s: string) => s.replace(/[<>&]/g, "");
const cleanLabel = (l: unknown) => String(l ?? "").replace(/[<>&"]/g, "").trim().slice(0, 40);
export const chatOwner = (chat: string) => `chat:${chat}`;
const isChatOwner = (o: string) => o.startsWith("chat:");

type Db = NonNullable<ReturnType<typeof memDb>>;
let ready = false;
function db(): Db | null {
  const d = memDb();
  if (!d) return null;
  if (!ready) {
    d.db.exec(`
      CREATE TABLE IF NOT EXISTS tracked (owner TEXT NOT NULL, wallet TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL, PRIMARY KEY (owner, wallet)) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS tracked_wallet ON tracked (wallet);
      CREATE TABLE IF NOT EXISTS tracked_moves (owner TEXT NOT NULL, sig TEXT NOT NULL, mint TEXT NOT NULL, wallet TEXT NOT NULL, side TEXT NOT NULL, sol REAL, usd REAL, symbol TEXT, verdict TEXT, score INTEGER, at INTEGER NOT NULL, PRIMARY KEY (owner, sig, mint)) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS tracked_moves_owner ON tracked_moves (owner, at);
    `);
    ready = true;
  }
  return d;
}
function need(): Db {
  const d = db();
  if (!d) throw new ApiError("Wallet tracker storage is unavailable right now, try again later", 503);
  return d;
}

interface TrackedRow { owner: string; wallet: string; label: string; at: number }
export interface Move { owner: string; sig: string; mint: string; wallet: string; side: "buy" | "sell"; sol: number | null; usd: number | null; symbol: string | null; verdict: string | null; score: number | null; at: number }

const listOf = (d: Db, owner: string) => d.db.prepare("SELECT owner, wallet, label, at FROM tracked WHERE owner = ? ORDER BY at").all(owner) as unknown as TrackedRow[];
const movesOf = (d: Db, owner: string, limit: number) =>
  d.db.prepare("SELECT owner, sig, mint, wallet, side, sol, usd, symbol, verdict, score, at FROM tracked_moves WHERE owner = ? ORDER BY at DESC LIMIT ?").all(owner, limit) as unknown as Move[];

// Все отслеживаемые адреса: идут в список вебхука Helius. Кэш сбрасываем при каждом добавлении и удалении.
let walletSet: Set<string> | null = null;
export function trackedWallets(): Set<string> {
  if (walletSet) return walletSet;
  const d = db();
  if (!d) return new Set();
  walletSet = new Set((d.db.prepare("SELECT DISTINCT wallet FROM tracked").all() as { wallet: string }[]).map((r) => r.wallet));
  return walletSet;
}
function changed() {
  walletSet = null;
  // Вебхук обновляем сразу, а не ждём планового прохода раз в 2 минуты.
  import("./wallet-watch").then((m) => m.nudgeWalletWatch()).catch(() => {});
}

// Тариф владельца: у чата без кошелька всегда free.
async function tierFor(owner: string): Promise<Tier> {
  if (isChatOwner(owner)) return "free";
  return (await tierOf(owner).catch(() => null))?.tier ?? "free";
}
// Куда слать: чат владельца-чата или чат, к которому привязан кошелёк.
async function chatOf(owner: string): Promise<string | null> {
  if (isChatOwner(owner)) return owner.slice(5);
  const { chatFor } = await import("./telegram");
  return chatFor(owner);
}

export function upgradeHint(tier: Tier): string {
  if (tier === "free") return `Hold about $${TIER_USD.holder} of $CRAWLHIVE for ${TIER_LIMITS.holder.trackedWallets} wallets and instant alerts: crawlhive.xyz/pricing`;
  if (tier === "holder") return `Pro tracks ${TIER_LIMITS.pro.trackedWallets}, Whale ${TIER_LIMITS.whale.trackedWallets}: crawlhive.xyz/pricing`;
  if (tier === "pro") return `Whale tracks ${TIER_LIMITS.whale.trackedWallets}: crawlhive.xyz/pricing`;
  return "";
}

// ---------- список ----------

export async function trackedState(owner: string) {
  const d = need();
  const tier = await tierFor(owner);
  const max = TIER_LIMITS[tier].trackedWallets;
  const rows = listOf(d, owner);
  const { walletWatchEnabled } = await import("./wallet-watch");
  return {
    tier,
    max,
    delayMin: TIER_LIMITS[tier].radarDelayMin,
    hint: upgradeHint(tier),
    // Кошельки сверх лимита (тариф упал) хранятся, но алертов по ним нет.
    list: rows.map((r, i) => ({ wallet: r.wallet, label: r.label, at: r.at, active: i < max })),
    moves: movesOf(d, owner, 30),
    telegram: !!(await chatOf(owner)),
    live: walletWatchEnabled(),
  };
}

export async function addTracked(owner: string, rawWallet: unknown, rawLabel?: unknown) {
  const d = need();
  const wallet = String(rawWallet ?? "").trim();
  if (!SOL_RE.test(wallet)) throw new ApiError("Not a Solana wallet address. The tracker follows Solana wallets for now", 400);
  const tier = await tierFor(owner);
  const max = TIER_LIMITS[tier].trackedWallets;
  const rows = listOf(d, owner);
  const already = rows.some((r) => r.wallet === wallet);
  if (!already && rows.length >= max) {
    const hint = upgradeHint(tier);
    throw new ApiError(`Your ${tier} plan tracks up to ${max} wallet${max === 1 ? "" : "s"}. Remove one first${hint ? `, or upgrade. ${hint}` : ""}`, 402);
  }
  const label = cleanLabel(rawLabel);
  d.db
    .prepare("INSERT INTO tracked (owner, wallet, label, at) VALUES (?, ?, ?, ?) ON CONFLICT (owner, wallet) DO UPDATE SET label = CASE WHEN excluded.label = '' THEN tracked.label ELSE excluded.label END")
    .run(owner, wallet, label, Date.now());
  if (!already) changed();
  return { tier, wallet, label, count: already ? rows.length : rows.length + 1, max, delayMin: TIER_LIMITS[tier].radarDelayMin };
}

export function removeTracked(owner: string, rawWallet: unknown): boolean {
  const d = need();
  const wallet = String(rawWallet ?? "").trim();
  const ok = Number(d.db.prepare("DELETE FROM tracked WHERE owner = ? AND wallet = ?").run(owner, wallet).changes) > 0;
  if (ok) changed();
  return ok;
}

// В боте кошелёк привязали позже, чем начали следить из чата: переносим кошельки чата на кошелёк (в пределах лимита).
export async function adoptChatList(chat: string, wallet: string) {
  const d = db();
  if (!d) return;
  const from = listOf(d, chatOwner(chat));
  if (!from.length) return;
  const max = TIER_LIMITS[await tierFor(wallet)].trackedWallets;
  const have = new Set(listOf(d, wallet).map((r) => r.wallet));
  let n = have.size;
  for (const r of from) {
    if (!have.has(r.wallet) && n < max) {
      d.db.prepare("INSERT OR IGNORE INTO tracked (owner, wallet, label, at) VALUES (?, ?, ?, ?)").run(wallet, r.wallet, r.label, r.at);
      n++;
    }
  }
  d.db.prepare("DELETE FROM tracked WHERE owner = ?").run(chatOwner(chat));
  changed();
}

// ---------- разбор свопа из «расширенной» транзакции Helius ----------

interface RawAmt { tokenAmount?: string; decimals?: number }
interface HeliusTx {
  signature?: string;
  timestamp?: number;
  type?: string;
  feePayer?: string;
  tokenTransfers?: { fromUserAccount?: string; toUserAccount?: string; mint?: string; tokenAmount?: number }[];
  nativeTransfers?: { fromUserAccount?: string; toUserAccount?: string; amount?: number }[];
  accountData?: { account?: string; nativeBalanceChange?: number; tokenBalanceChanges?: { userAccount?: string; mint?: string; rawTokenAmount?: RawAmt }[] }[];
  events?: {
    swap?: {
      nativeInput?: { account?: string; amount?: string | number } | null;
      nativeOutput?: { account?: string; amount?: string | number } | null;
      tokenInputs?: { userAccount?: string; mint?: string; rawTokenAmount?: RawAmt }[];
      tokenOutputs?: { userAccount?: string; mint?: string; rawTokenAmount?: RawAmt }[];
    };
  };
}
export interface TrackedTrade { wallet: string; side: "buy" | "sell"; mint: string; sol: number | null; usd: number | null; sig: string; at: number }

const raw = (r?: RawAmt) => (r?.tokenAmount != null ? Number(r.tokenAmount) / 10 ** (r.decimals ?? 0) : 0);

// Сделка кошелька в транзакции: какой мем-токен прибыл или ушёл и сколько SOL (или стейблов) ушло в обмен.
// Своп токена на токен без SOL и стейблов сумму не даёт: такой пропускаем, как и спам-переводы без встречной оплаты.
export function tradeOf(tx: HeliusTx, w: string): TrackedTrade | null {
  if (!tx.signature) return null;
  const net = new Map<string, number>();
  const bump = (mint: string | undefined, v: number) => mint && v && net.set(mint, (net.get(mint) ?? 0) + v);
  for (const t of tx.tokenTransfers ?? []) {
    if (t.toUserAccount === w) bump(t.mint, t.tokenAmount ?? 0);
    if (t.fromUserAccount === w) bump(t.mint, -(t.tokenAmount ?? 0));
  }
  // Переводов нет (бывает у некоторых программ): берём изменения балансов токенов из accountData.
  if (!net.size)
    for (const a of tx.accountData ?? []) for (const c of a.tokenBalanceChanges ?? []) if (c.userAccount === w) bump(c.mint, raw(c.rawTokenAmount));
  // Мем-токен: самый крупный по модулю из не-котировочных; приход - покупка, уход - продажа.
  let mint: string | null = null;
  let amt = 0;
  for (const [m, v] of net) if (m !== WSOL && !STABLES.has(m) && Math.abs(v) > Math.abs(amt)) [mint, amt] = [m, v];
  if (!mint || !amt) return null;
  const side = amt > 0 ? "buy" : "sell";
  // SOL: сначала событие свопа Helius, потом изменение нативного баланса кошелька плюс wSOL.
  // Обёртка SOL в wSOL видна дважды (нативный баланс и перевод wSOL), поэтому не складываем, а берём больший по модулю.
  const bigger = (a: number, b: number) => (Math.abs(a) >= Math.abs(b) ? a : b);
  let sol = 0;
  const sw = tx.events?.swap;
  if (sw) {
    let nat = 0;
    let wrapped = 0;
    if (sw.nativeInput?.account === w) nat -= Number(sw.nativeInput.amount ?? 0) / 1e9;
    if (sw.nativeOutput?.account === w) nat += Number(sw.nativeOutput.amount ?? 0) / 1e9;
    for (const t of sw.tokenInputs ?? []) if (t.userAccount === w && t.mint === WSOL) wrapped -= raw(t.rawTokenAmount);
    for (const t of sw.tokenOutputs ?? []) if (t.userAccount === w && t.mint === WSOL) wrapped += raw(t.rawTokenAmount);
    sol = bigger(nat, wrapped);
  }
  if (!sol) {
    const own = ((tx.accountData ?? []).find((a) => a.account === w)?.nativeBalanceChange ?? 0) / 1e9;
    sol = bigger(own, net.get(WSOL) ?? 0);
  }
  if (!sol) sol = (tx.nativeTransfers ?? []).reduce((a, t) => a + (t.toUserAccount === w ? t.amount ?? 0 : 0) - (t.fromUserAccount === w ? t.amount ?? 0 : 0), 0) / 1e9;
  const usd = [...STABLES].reduce((a, m) => a + (net.get(m) ?? 0), 0);
  // Оплата должна идти навстречу токену: купил - SOL ушёл, продал - пришёл. Иначе это не своп кошелька.
  const solOk = side === "buy" ? sol < 0 : sol > 0;
  const usdOk = side === "buy" ? usd < 0 : usd > 0;
  if (!solOk && !usdOk) return null;
  return {
    wallet: w,
    side,
    mint,
    sol: solOk ? Math.round(Math.abs(sol) * 1000) / 1000 : null,
    usd: !solOk && usdOk ? Math.round(Math.abs(usd) * 100) / 100 : null,
    sig: tx.signature,
    at: (tx.timestamp ?? Date.now() / 1000) * 1000,
  };
}

const isDust = (t: TrackedTrade) => (t.sol != null ? t.sol < DUST_SOL : (t.usd ?? 0) < DUST_USD);

// ---------- приём вебхука ----------

// Подписи, которые уже разобрали: Helius повторяет доставку, а одна транзакция приходит в каждом повторе.
const seen = new Map<string, number>();
function firstTime(sig: string) {
  const now = Date.now();
  if (seen.has(sig)) return false;
  seen.set(sig, now);
  if (seen.size > 20_000) for (const [k, t] of seen) if (now - t > 6 * 3600_000 || seen.size > 15_000) seen.delete(k);
  return true;
}

// Зовёт вебхук после ответа Helius. Ничего не бросает.
export async function ingestTracked(body: unknown) {
  const set = trackedWallets();
  const d = db();
  if (!set.size || !d) return;
  const txs = (Array.isArray(body) ? body : [body]) as HeliusTx[];
  for (const tx of txs) {
    if (!tx?.signature || !firstTime(tx.signature)) continue;
    if (tx.timestamp && Date.now() - tx.timestamp * 1000 > MAX_TX_AGE_MS) continue;
    const accounts = new Set<string>([
      ...(tx.feePayer ? [tx.feePayer] : []),
      ...(tx.tokenTransfers ?? []).flatMap((t) => [t.fromUserAccount ?? "", t.toUserAccount ?? ""]),
      ...(tx.nativeTransfers ?? []).flatMap((t) => [t.fromUserAccount ?? "", t.toUserAccount ?? ""]),
      ...(tx.accountData ?? []).flatMap((a) => [a.account ?? "", ...(a.tokenBalanceChanges ?? []).map((c) => c.userAccount ?? "")]),
    ]);
    for (const w of accounts) {
      if (!w || !set.has(w)) continue;
      const trade = tradeOf(tx, w);
      if (!trade || isDust(trade)) continue;
      const rows = d.db.prepare("SELECT owner, wallet, label, at FROM tracked WHERE wallet = ?").all(w) as unknown as TrackedRow[];
      // Не ждём: скан для вердикта одной монеты (до 30 с) не задерживает алерты остальным.
      for (const r of rows) void route(d, r, trade).catch((e) => console.warn("[tracker] alert:", (e as Error).message));
    }
  }
}

// Один владелец: проверяем, что кошелёк в пределах его лимита, запоминаем сделку (дубль - выходим) и шлём сразу
// или с задержкой free.
async function route(d: Db, row: TrackedRow, t: TrackedTrade) {
  const tier = await tierFor(row.owner);
  const max = TIER_LIMITS[tier].trackedWallets;
  const pos = listOf(d, row.owner).findIndex((r) => r.wallet === row.wallet);
  if (pos < 0 || pos >= max) return;
  const fresh =
    Number(
      d.db
        .prepare("INSERT OR IGNORE INTO tracked_moves (owner, sig, mint, wallet, side, sol, usd, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(row.owner, t.sig, t.mint, t.wallet, t.side, t.sol, t.usd, t.at).changes,
    ) > 0;
  if (!fresh) return;
  prune(d);
  const delay = TIER_LIMITS[tier].radarDelayMin * 60_000;
  if (!delay) return deliver(d, row, t, tier);
  const timer = setTimeout(() => void deliver(d, row, t, tier).catch((e) => console.warn("[tracker] alert:", (e as Error).message)), delay);
  timer.unref?.();
}

let prunedAt = 0;
function prune(d: Db) {
  if (Date.now() - prunedAt < 3600_000) return;
  prunedAt = Date.now();
  d.db.prepare("DELETE FROM tracked_moves WHERE at < ?").run(Date.now() - MOVES_KEEP_MS);
}

// ---------- вердикт ----------

interface Verdict { symbol: string | null; verdict: string; score: number | null; liq: number | null; fdv: number | null; at: number }
const verdicts = new Map<string, Verdict>();
const inflight = new Map<string, Promise<Verdict | null>>();
let scanHits: number[] = [];

const fromScan = (r: { symbol: string; verdict: string; score: number | null; market?: { liquidityUsd?: number; fdv?: number }; scannedAt: number }): Verdict => ({
  symbol: r.symbol || null,
  verdict: r.verdict,
  score: r.score,
  liq: r.market?.liquidityUsd ?? null,
  fdv: r.market?.fdv ?? null,
  at: r.scannedAt,
});

// Свежий (до 30 минут) вердикт из своего кэша или сохранённого скана; иначе быстрый скан тем же runScan,
// в пределах общего лимита трекера. scan=false: только то, что уже есть (для продаж), хоть и старое.
export async function verdictFor(mint: string, scan = true): Promise<Verdict | null> {
  const now = Date.now();
  const mine = verdicts.get(mint);
  const { savedScan } = await import("./scan");
  const saved = savedScan(mint);
  const best = [mine, saved ? fromScan(saved) : undefined].filter((v): v is Verdict => !!v).sort((a, b) => b.at - a.at)[0] ?? null;
  if (best && now - best.at < VERDICT_FRESH_MS) return best;
  if (!scan) return best;
  const running = inflight.get(mint);
  if (running) return running;
  scanHits = scanHits.filter((x) => now - x < SCAN_WINDOW_MS);
  if (scanHits.length >= SCANS_PER_WINDOW) return best;
  scanHits.push(now);
  const p = (async () => {
    try {
      const { runScan } = await import("./scan");
      // record=false: в публичную ленту «recently scanned» внутренние сканы не попадают.
      const r = await Promise.race([
        runScan(mint, () => {}, "solana", { record: false, src: "crawler" }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("scan timeout")), SCAN_TIMEOUT_MS)),
      ]);
      const v = fromScan(r);
      verdicts.set(mint, v);
      if (verdicts.size > 2_000) verdicts.delete(verdicts.keys().next().value!);
      return v;
    } catch {
      return best;
    } finally {
      inflight.delete(mint);
    }
  })();
  inflight.set(mint, p);
  return p;
}

// ---------- сообщение ----------

const sent = new Map<string, { at: number[]; warned: number }>();
function underRate(owner: string): "ok" | "warn" | "drop" {
  const now = Date.now();
  const s = sent.get(owner) ?? { at: [], warned: 0 };
  s.at = s.at.filter((t) => now - t < 3600_000);
  sent.set(owner, s);
  if (s.at.length < ALERTS_PER_HOUR) {
    s.at.push(now);
    return "ok";
  }
  if (now - s.warned > 3600_000) {
    s.warned = now;
    return "warn";
  }
  return "drop";
}

const fmtSol = (n: number) => (n >= 100 ? `${Math.round(n)}` : n >= 1 ? n.toFixed(1) : n.toFixed(2));
const fmtUsd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${Math.round(n)}`);

export function moveText(label: string, t: TrackedTrade, v: Verdict | null, delayMin = 0) {
  const who = label ? strip(label) : short(t.wallet);
  const coin = v?.symbol ? `$${strip(v.symbol)}` : short(t.mint);
  const paid = t.sol != null ? `${fmtSol(t.sol)} SOL` : t.usd != null ? fmtUsd(t.usd) : "";
  const verdict = v ? `verdict ${v.verdict.replace("_", " ")}${v.score != null ? ` ${v.score}` : ""}` : t.side === "buy" ? "verdict pending, tap Scan" : "";
  const liq = v ? (v.liq != null ? `liq ${fmtUsd(v.liq)}` : v.fdv ? `mc ${fmtUsd(v.fdv)}, on curve` : "") : "";
  const head = `${t.side === "buy" ? "🟢" : "🔴"} <b>${who}</b> ${t.side === "buy" ? "bought" : "sold"} <b>${coin}</b>${paid ? ` for ${paid}` : ""}`;
  return [
    [head, verdict, liq].filter(Boolean).join(" · "),
    `<code>${t.mint}</code> · <a href="https://solscan.io/tx/${t.sig}">tx</a>`,
    ...(delayMin ? [`<i>Delayed ${delayMin} min on the free plan. Instant from Holder: crawlhive.xyz/pricing</i>`] : []),
  ].join("\n");
}

async function deliver(d: Db, row: TrackedRow, t: TrackedTrade, tier: Tier) {
  // Пока ждали задержку free, кошелёк могли убрать из списка.
  if (!d.db.prepare("SELECT 1 FROM tracked WHERE owner = ? AND wallet = ?").get(row.owner, row.wallet)) return;
  const v = await verdictFor(t.mint, t.side === "buy");
  if (v) d.db.prepare("UPDATE tracked_moves SET symbol = ?, verdict = ?, score = ? WHERE owner = ? AND sig = ? AND mint = ?").run(v.symbol, v.verdict, v.score, row.owner, t.sig, t.mint);
  const chat = await chatOf(row.owner);
  if (!chat) return;
  const { send, siteUrl } = await import("./telegram");
  const rate = underRate(row.owner);
  if (rate === "warn") return send(chat, `Wallet tracker: ${ALERTS_PER_HOUR} alerts this hour, pausing the rest until the hour is up. Busy wallets? /tracked to trim the list.`);
  if (rate === "drop") return;
  send(chat, moveText(row.label, t, v, TIER_LIMITS[tier].radarDelayMin), [
    [
      { text: "🔎 Scan", url: `${siteUrl()}/scan/${t.mint}` },
      { text: "📈 Chart", url: `https://dexscreener.com/solana/${t.mint}` },
    ],
  ]);
}
