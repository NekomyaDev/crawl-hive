// Реферальная программа: награды только продуктом (лимиты), без денег и без выплат токенами.
// У каждого вошедшего кошелька свой код и две ссылки: crawlhive.xyz/?ref=<код> и t.me/<бот>?start=ref_<код>.
// Привязка: сайт запоминает ?ref= в localStorage и шлёт его после первого входа подписью (POST /api/ref/claim);
// бот запоминает ref_<код> за чатом и привязывает при первой проверке кошелька (/verify) или связке с сайта.
// Один пригласивший на кошелёк, первое касание побеждает, себя пригласить нельзя, код должен существовать.
// «Новый» кошелёк: впервые вошёл на сайт (ref_seen) не раньше NEW_MS назад или ещё нигде не был привязан к боту.
// Засчитывается приглашение, только когда приглашённый хоть раз держал порог Holder (баланс от need.holder):
// лениво при каждом tierOf этого кошелька и фоновым проходом раз в 30 минут по ожидающим (не больше CHECKS_PER_RUN).
// Награды поверх TIER_LIMITS: пригласившему +5 вопросов Ask в сутки и +2 кошелька трекера за каждого засчитанного
// (до 10), приглашённому +3 вопроса Ask в сутки первые 7 дней с момента привязки.
// Хранение: та же SQLite, что у памяти роя (memory-db.ts), свои таблицы ref_codes, referrals, ref_seen, ref_tg.
import "server-only";
import { randomBytes } from "node:crypto";
import { memDb } from "./memory-db";
import { ApiError, getMeta, metaEntries } from "./store";

export const REF_CAP = 10; // сколько засчитанных приглашений дают бонус
export const REF_ASK = 5; // вопросов Ask в сутки за каждого
export const REF_TRACKED = 2; // кошельков трекера за каждого
export const REFEREE_ASK = 3; // вопросов Ask в сутки приглашённому
export const REFEREE_DAYS = 7;
const NEW_MS = 24 * 3600_000; // окно «первого входа» на сайте
const TG_PENDING_MS = 30 * 86400_000; // сколько бот помнит ref_<код> без привязки кошелька
const PENDING_MAX_AGE_MS = 90 * 86400_000; // ожидающие старше не проверяем фоном (лениво всё равно засчитаются)
const CHECKS_PER_RUN = 20; // проверок баланса за один фоновый проход: бережём RPC
const RUN_EVERY_MS = 30 * 60_000;
const CODE_RE = /^[a-z0-9]{6,16}$/;
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // без 0/o/1/l, чтобы код не путали на глаз

type Db = NonNullable<ReturnType<typeof memDb>>;
let ready = false;
function db(): Db | null {
  const d = memDb();
  if (!d) return null;
  if (!ready) {
    d.db.exec(`
      CREATE TABLE IF NOT EXISTS ref_codes (wallet TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, at INTEGER NOT NULL) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS referrals (referee TEXT PRIMARY KEY, referrer TEXT NOT NULL, source TEXT NOT NULL, created_at INTEGER NOT NULL, qualified_at INTEGER, checked_at INTEGER NOT NULL DEFAULT 0) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS referrals_referrer ON referrals (referrer);
      CREATE INDEX IF NOT EXISTS referrals_pending ON referrals (qualified_at, checked_at);
      CREATE TABLE IF NOT EXISTS ref_seen (wallet TEXT PRIMARY KEY, at INTEGER NOT NULL) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS ref_tg (chat TEXT PRIMARY KEY, code TEXT NOT NULL, at INTEGER NOT NULL) WITHOUT ROWID;
    `);
    ready = true;
  }
  return d;
}
function need(): Db {
  const d = db();
  if (!d) throw new ApiError("Referrals are unavailable right now, try again later", 503);
  return d;
}

const short = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;
export const cleanCode = (raw: unknown) => {
  const c = String(raw ?? "").trim().toLowerCase();
  return CODE_RE.test(c) ? c : null;
};

// ---------- коды и ссылки ----------

function newCode() {
  const b = randomBytes(8);
  return Array.from(b, (x) => ALPHABET[x % ALPHABET.length]).join("");
}

export function codeOf(wallet: string): string {
  const d = need();
  const row = d.db.prepare("SELECT code FROM ref_codes WHERE wallet = ?").get(wallet) as { code: string } | undefined;
  if (row) return row.code;
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    const ok = Number(d.db.prepare("INSERT OR IGNORE INTO ref_codes (wallet, code, at) VALUES (?, ?, ?)").run(wallet, code, Date.now()).changes) > 0;
    if (ok) return code;
    const again = d.db.prepare("SELECT code FROM ref_codes WHERE wallet = ?").get(wallet) as { code: string } | undefined;
    if (again) return again.code; // параллельный запрос успел раньше
  }
  throw new ApiError("Could not make a referral code, try again", 500);
}

const walletOfCode = (d: Db, code: string) => (d.db.prepare("SELECT wallet FROM ref_codes WHERE code = ?").get(code) as { wallet: string } | undefined)?.wallet ?? null;

export async function refLinks(code: string) {
  const { siteUrl, telegramBotName } = await import("./telegram");
  const bot = telegramBotName() ?? process.env.TELEGRAM_BOT_USERNAME?.trim() ?? "crawlhivebot";
  return { site: `${siteUrl()}/?ref=${code}`, telegram: `https://t.me/${bot}?start=ref_${code}` };
}

// ---------- «первый вход» ----------

// Зовёт /api/auth/verify после успешной подписи: запоминаем, когда кошелёк впервые вошёл на сайт.
export function noteSignIn(wallet: string) {
  try {
    db()?.db.prepare("INSERT OR IGNORE INTO ref_seen (wallet, at) VALUES (?, ?)").run(wallet, Date.now());
  } catch (e) {
    console.warn("[ref] seen:", (e as Error).message);
  }
}
const seenAt = (d: Db, wallet: string) => (d.db.prepare("SELECT at FROM ref_seen WHERE wallet = ?").get(wallet) as { at: number } | undefined)?.at ?? null;

// ---------- привязка ----------

type Source = "site" | "telegram";
type ClaimResult = { ok: true; referrer: string } | { ok: false; reason: string };

// Общие правила: код существует, не сам себе, у кошелька ещё нет пригласившего, нет цикла, один чат у обоих = свой.
function attach(d: Db, wallet: string, code: string, source: Source, chat?: string): ClaimResult {
  const referrer = walletOfCode(d, code);
  if (!referrer) return { ok: false, reason: "This invite link is not valid." };
  if (referrer === wallet) return { ok: false, reason: "You cannot invite yourself." };
  const chatA = getMeta(`tg:${referrer}`);
  if (chatA && (chatA === chat || chatA === getMeta(`tg:${wallet}`))) return { ok: false, reason: "You cannot invite yourself." };
  const back = d.db.prepare("SELECT referrer FROM referrals WHERE referee = ?").get(referrer) as { referrer: string } | undefined;
  if (back?.referrer === wallet) return { ok: false, reason: "You cannot invite the friend who invited you." };
  const ok = Number(d.db.prepare("INSERT OR IGNORE INTO referrals (referee, referrer, source, created_at) VALUES (?, ?, ?, ?)").run(wallet, referrer, source, Date.now()).changes) > 0;
  if (!ok) return { ok: false, reason: "This wallet already has an invite." };
  // Уже держит Holder: засчитаем при ближайшей проверке, не ждём фонового прохода.
  void checkOne(wallet).catch(() => {});
  return { ok: true, referrer };
}

// Сайт: POST /api/ref/claim сразу после входа. Засчитываем только первый вход этого кошелька (окно NEW_MS).
export function claimSite(wallet: string, rawCode: unknown): ClaimResult {
  const d = need();
  const code = cleanCode(rawCode);
  if (!code) return { ok: false, reason: "This invite link is not valid." };
  const seen = seenAt(d, wallet);
  if (seen == null || Date.now() - seen > NEW_MS) return { ok: false, reason: "Invites count only for new wallets." };
  return attach(d, wallet, code, "site");
}

// Бот: /start ref_<код> запоминаем за чатом (первое касание), привязка позже при /verify или связке с сайта.
export function rememberTgStart(chat: string, rawCode: unknown): "saved" | "linked" | "invalid" | "own" {
  const d = db();
  const code = cleanCode(rawCode);
  if (!d || !code) return "invalid";
  const referrer = walletOfCode(d, code);
  if (!referrer) return "invalid";
  if (getMeta(`tg:${referrer}`) === chat) return "own";
  if (metaEntries("tg:").some(([, c]) => c === chat)) return "linked"; // уже наш пользователь
  d.db.prepare("DELETE FROM ref_tg WHERE at < ?").run(Date.now() - TG_PENDING_MS);
  d.db.prepare("INSERT OR IGNORE INTO ref_tg (chat, code, at) VALUES (?, ?, ?)").run(chat, code, Date.now());
  return "saved";
}

// Зовётся ПЕРЕД setMeta(tg:<кошелёк>, чат) в /verify и в /start <код> с сайта. Ничего не бросает.
// Кошелёк новый, если ещё не был привязан ни к одному чату и не входил на сайт раньше окна NEW_MS.
export function claimFromChat(chat: string, wallet: string): ClaimResult | null {
  try {
    const d = db();
    if (!d) return null;
    const row = d.db.prepare("SELECT code, at FROM ref_tg WHERE chat = ?").get(chat) as { code: string; at: number } | undefined;
    if (!row) return null;
    d.db.prepare("DELETE FROM ref_tg WHERE chat = ?").run(chat);
    if (Date.now() - row.at > TG_PENDING_MS) return null;
    if (getMeta(`tg:${wallet}`)) return { ok: false, reason: "Invites count only for new wallets." };
    const seen = seenAt(d, wallet);
    if (seen != null && Date.now() - seen > NEW_MS) return { ok: false, reason: "Invites count only for new wallets." };
    if (seen == null) d.db.prepare("INSERT OR IGNORE INTO ref_seen (wallet, at) VALUES (?, ?)").run(wallet, Date.now());
    return attach(d, wallet, row.code, "telegram", chat);
  } catch (e) {
    console.warn("[ref] tg claim:", (e as Error).message);
    return null;
  }
}

// ---------- засчитывание ----------

// Из tierOf: кошелёк сейчас держит порог Holder. Дёшево: один UPDATE по первичному ключу.
export function noteHolder(wallet: string) {
  const d = db();
  if (!d) return;
  const r = d.db.prepare("UPDATE referrals SET qualified_at = ?, checked_at = ? WHERE referee = ? AND qualified_at IS NULL").run(Date.now(), Date.now(), wallet);
  if (Number(r.changes) > 0) void notifyReferrer(d, wallet).catch(() => {});
}

async function checkOne(wallet: string) {
  const { tierOf } = await import("./tiers");
  const t = await tierOf(wallet);
  // tierOf сам зовёт noteHolder при балансе от порога; здесь только отмечаем, что проверили.
  if (t.balance != null && t.balance >= t.need.holder) noteHolder(wallet);
  db()?.db.prepare("UPDATE referrals SET checked_at = ? WHERE referee = ?").run(Date.now(), wallet);
}

async function notifyReferrer(d: Db, referee: string) {
  const row = d.db.prepare("SELECT referrer FROM referrals WHERE referee = ?").get(referee) as { referrer: string } | undefined;
  if (!row) return;
  const n = qualifiedCount(d, row.referrer);
  if (n > REF_CAP) return;
  const chat = getMeta(`tg:${row.referrer}`);
  if (!chat) return;
  const { send } = await import("./telegram");
  send(chat, `🎉 A friend you invited reached Holder. Your bonus is now +${n * REF_ASK} Ask questions a day and +${n * REF_TRACKED} tracked wallets (${n}/${REF_CAP}). /invite`);
}

let running = false;
async function runPending() {
  if (running) return;
  const d = db();
  if (!d) return;
  running = true;
  try {
    const rows = d.db
      .prepare("SELECT referee FROM referrals WHERE qualified_at IS NULL AND created_at > ? ORDER BY checked_at ASC LIMIT ?")
      .all(Date.now() - PENDING_MAX_AGE_MS, CHECKS_PER_RUN) as { referee: string }[];
    for (const r of rows) await checkOne(r.referee).catch((e) => console.warn("[ref] check:", (e as Error).message));
  } finally {
    running = false;
  }
}

let started = false;
export function startReferrals() {
  if (started) return;
  started = true;
  setInterval(() => void runPending().catch(() => {}), RUN_EVERY_MS).unref?.();
  setTimeout(() => void runPending().catch(() => {}), 5 * 60_000).unref?.();
}

// ---------- бонусы ----------

const qualifiedCount = (d: Db, wallet: string) => Number((d.db.prepare("SELECT COUNT(*) AS n FROM referrals WHERE referrer = ? AND qualified_at IS NOT NULL").get(wallet) as { n: number }).n);

// Надбавка к лимитам тарифа для кошелька. Синхронно и без сети: читают ask.ts и wallet-tracker.ts.
export function bonusFor(wallet: string | null | undefined): { ask: number; trackedWallets: number } {
  if (!wallet || wallet.startsWith("chat:")) return { ask: 0, trackedWallets: 0 };
  try {
    const d = db();
    if (!d) return { ask: 0, trackedWallets: 0 };
    const n = Math.min(REF_CAP, qualifiedCount(d, wallet));
    const mine = d.db.prepare("SELECT created_at FROM referrals WHERE referee = ?").get(wallet) as { created_at: number } | undefined;
    const fresh = !!mine && Date.now() - mine.created_at < REFEREE_DAYS * 86400_000;
    return { ask: n * REF_ASK + (fresh ? REFEREE_ASK : 0), trackedWallets: n * REF_TRACKED };
  } catch {
    return { ask: 0, trackedWallets: 0 };
  }
}

// Надбавка Ask по ключу счётчика: кошелёк, а для бота (tg:<id> без кошелька) лучшая среди кошельков его лички.
export function askBonus(key: string, wallet: string | null): number {
  if (wallet) return bonusFor(wallet).ask;
  if (!key.startsWith("tg:")) return 0;
  const chat = key.slice(3);
  let best = 0;
  for (const [k, c] of metaEntries("tg:")) if (c === chat) best = Math.max(best, bonusFor(k.slice(3)).ask);
  return best;
}

// ---------- сводка для страницы и бота ----------

export async function refState(wallet: string) {
  const d = need();
  const code = codeOf(wallet);
  const counts = d.db
    .prepare("SELECT SUM(CASE WHEN qualified_at IS NULL THEN 1 ELSE 0 END) AS pending, SUM(CASE WHEN qualified_at IS NOT NULL THEN 1 ELSE 0 END) AS qualified FROM referrals WHERE referrer = ?")
    .get(wallet) as { pending: number | null; qualified: number | null };
  const mine = d.db.prepare("SELECT referrer, created_at FROM referrals WHERE referee = ?").get(wallet) as { referrer: string; created_at: number } | undefined;
  const refereeUntil = mine ? mine.created_at + REFEREE_DAYS * 86400_000 : null;
  return {
    wallet,
    code,
    links: await refLinks(code),
    pending: Number(counts.pending ?? 0),
    qualified: Number(counts.qualified ?? 0),
    cap: REF_CAP,
    bonus: bonusFor(wallet),
    per: { ask: REF_ASK, trackedWallets: REF_TRACKED },
    referee: mine ? { by: short(mine.referrer), askBonus: REFEREE_ASK, until: refereeUntil, active: (refereeUntil ?? 0) > Date.now() } : null,
    refereeBonus: { ask: REFEREE_ASK, days: REFEREE_DAYS },
  };
}

// /invite в личке бота.
export async function tgInvite(chat: string) {
  const { esc, send } = await import("./telegram");
  const wallets = metaEntries("tg:").filter(([, c]) => c === chat).map(([k]) => k.slice(3));
  if (!wallets.length)
    return send(chat, "🤝 <b>Invite friends</b>\n\nLink your wallet first: send /verify &lt;address&gt; (no wallet connect, no signing). Then /invite gives you your personal invite link.");
  if (!db()) return send(chat, "Invites are unavailable right now, try again later.");
  const parts: string[] = [];
  for (const w of wallets.slice(0, 3)) {
    const s = await refState(w);
    parts.push(
      [
        `👛 <code>${esc(short(w))}</code>`,
        `Bot link: ${esc(s.links.telegram)}`,
        `Site link: ${esc(s.links.site)}`,
        `Invited: ${s.qualified} counted, ${s.pending} waiting for Holder`,
        `Your bonus: +${s.bonus.ask} Ask questions a day, +${s.bonus.trackedWallets} tracked wallets`,
      ].join("\n"),
    );
  }
  send(
    chat,
    [
      "🤝 <b>Invite friends, get more CrawlHive</b>",
      "",
      ...parts.flatMap((p) => [p, ""]),
      `For every friend who reaches Holder (about $10 of $CRAWLHIVE in their wallet): +${REF_ASK} Ask questions a day and +${REF_TRACKED} tracked wallets, up to ${REF_CAP} friends.`,
      `Your friend gets +${REFEREE_ASK} Ask questions a day for ${REFEREE_DAYS} days.`,
      "Rewards are product limits only, no money and no token payouts.",
    ].join("\n"),
  );
}

// Ответ на /start ref_<код>: перед обычным приветствием.
export async function tgStart(chat: string, code: string) {
  const { send } = await import("./telegram");
  const r = rememberTgStart(chat, code);
  if (r === "saved")
    send(chat, `🤝 You were invited by a friend. Link your wallet with /verify &lt;address&gt; and you get +${REFEREE_ASK} Ask questions a day for ${REFEREE_DAYS} days.`);
  else if (r === "invalid") send(chat, "This invite link is not valid, but everything below works anyway.");
}
