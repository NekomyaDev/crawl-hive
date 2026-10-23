// Telegram-бот: доставка сигналов краулеров владельцам, плюс открытые всем функции — скан любого токена
// прямо в чате, список наблюдения с оповещениями (ликвидность вытащили, цена −50%, вердикт стал DANGER)
// и свежие запуски из Launch Radar. Бот работает через long polling (вебхук и открытый порт не нужны).
// Привязка: вошедший кошелёк получает одноразовую ссылку t.me/<bot>?start=<код>, бот по коду
// запоминает чат за кошельком. Дальше каждый сигнал живого краулера уходит владельцу в личку,
// а за 3 дня до конца оплаченного срока бот напоминает о продлении.
import "server-only";
import { randomBytes } from "node:crypto";
import type { Signal } from "../types";
import { SIGNAL_KIND_LABEL } from "../spec";
import { launchHref } from "../narrative";
import { LANGS } from "../i18n/langs";
import { expiringCrawlers, getMeta, metaEntries, onLiveSignal, setMeta } from "./store";

const API = process.env.TELEGRAM_API_URL?.trim() || "https://api.telegram.org"; // подмена — только для тестов
const CODE_TTL_MS = 15 * 60_000;
const WARN_BEFORE_MS = 3 * 86400_000;

interface TgState {
  bot?: string; // username, известен после getMe
  mainApp?: boolean; // включён ли Main Mini App в BotFather: без него ссылки ?startapp не открываются
  codes: Map<string, { wallet: string; exp: number }>;
  queue: Promise<unknown>;
  started: boolean;
}

const g = globalThis as unknown as { __crawlhiveTg?: TgState };
function tg(): TgState {
  if (!g.__crawlhiveTg) g.__crawlhiveTg = { codes: new Map(), queue: Promise.resolve(), started: false };
  return g.__crawlhiveTg;
}

const token = () => process.env.TELEGRAM_BOT_TOKEN?.trim() || "";
export const telegramEnabled = () => !!token();
export const telegramMainApp = () => !!tg().mainApp;
export const telegramBotName = () => (telegramEnabled() ? (tg().bot ?? process.env.TELEGRAM_BOT_USERNAME?.trim() ?? null) : null);
export const siteUrl = () => (process.env.PUBLIC_URL?.trim() || "https://crawlhive.xyz").replace(/\/$/, "");

export async function call<T>(method: string, params: Record<string, unknown>, timeoutMs = 15_000): Promise<T> {
  const r = await fetch(`${API}/bot${token()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string; error_code?: number };
  if (!j.ok) {
    const err = new Error(`telegram ${method}: ${j.description ?? r.status}`) as Error & { code?: number };
    err.code = j.error_code ?? r.status;
    throw err;
  }
  return j.result as T;
}

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

// Сообщения шлём по одному: так не упираемся в лимиты Telegram и сохраняем порядок.
export type Keyboard = { text: string; url?: string; callback_data?: string; web_app?: { url: string } }[][];

export function send(chatId: string, html: string, keyboard?: Keyboard, extra: Record<string, unknown> = {}) {
  enqueue(chatId, () =>
    call("sendMessage", {
      chat_id: chatId,
      text: html,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
      ...extra,
    }),
  );
}

// Картинка с подписью; не вышло (Telegram не скачал картинку) — та же подпись обычным сообщением.
export function sendPhoto(chatId: string, photo: string, html: string, keyboard?: Keyboard, extra: Record<string, unknown> = {}) {
  enqueue(chatId, () =>
    call("sendPhoto", { chat_id: chatId, photo, caption: html, parse_mode: "HTML", ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}), ...extra }, 30_000).catch(
      (e: Error & { code?: number }) => {
        if (e.code === 403) throw e;
        return call("sendMessage", { chat_id: chatId, text: html, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}), ...extra });
      },
    ),
  );
}

// Подписчики на «чат заблокировал бота» (403): дайджест и прочие рассылки выключают себя для этого чата.
const gb = globalThis as unknown as { __crawlhiveTgBlocked?: ((chat: string) => void)[] };
export function onChatBlocked(cb: (chat: string) => void) {
  (gb.__crawlhiveTgBlocked ??= []).push(cb);
}

function enqueue(chatId: string, job: () => Promise<unknown>) {
  const st = tg();
  st.queue = st.queue
    .then(job)
    .catch((e: Error & { code?: number }) => {
      // Пользователь заблокировал бота — отвязываем его кошельки, чтобы не долбиться впустую.
      if (e.code === 403) {
        for (const [k, v] of metaEntries("tg:")) if (v === chatId) setMeta(k, undefined);
        for (const cb of gb.__crawlhiveTgBlocked ?? []) cb(chatId);
      } else console.error(e.message);
    })
    .then(() => new Promise((r) => setTimeout(r, 60)));
}

export function chatFor(wallet: string): string | null {
  return getMeta(`tg:${wallet}`) ?? null;
}

export function linkCode(wallet: string) {
  if (!telegramEnabled()) throw new Error("Telegram delivery is not configured");
  const st = tg();
  const now = Date.now();
  for (const [k, v] of st.codes) if (v.exp < now) st.codes.delete(k);
  const code = randomBytes(12).toString("base64url");
  st.codes.set(code, { wallet, exp: now + CODE_TTL_MS });
  const bot = telegramBotName();
  return { url: bot ? `https://t.me/${bot}?start=${code}` : null, code, expiresAt: now + CODE_TTL_MS };
}

export function unlink(wallet: string) {
  const chat = chatFor(wallet);
  setMeta(`tg:${wallet}`, undefined);
  if (chat) send(chat, `Unlinked wallet <code>${short(wallet)}</code>. You will no longer get its signals here.`);
}

function signalMessage(sig: Signal) {
  const head = `🕷 <b>${esc(sig.crawlerName)}</b> · ${esc(SIGNAL_KIND_LABEL[sig.kind] ?? sig.kind)}`;
  const ticker = sig.ticker ? `<b>$${esc(sig.ticker)}</b> ` : "";
  const ca = sig.token?.address ? `\n<code>${esc(sig.token.address)}</code>` : "";
  const links = (sig.urls ?? [])
    .slice(0, 3)
    .map((u, i) => `<a href="${esc(u)}">source ${i + 1}</a>`)
    .join(" · ");
  const scoring =
    sig.outcome?.status === "pending" && sig.outcome.checkAt
      ? `\nScored ${Math.round((sig.outcome.checkAt - sig.ts) / 60_000)} min from now against the price.`
      : "";
  const launch = launchHref(sig, siteUrl());
  return [
    head,
    `${ticker}${esc(sig.text)}${ca}`,
    `confidence ${Math.round(sig.confidence * 100)}%${links ? ` · ${links}` : ""}${scoring}`,
    `<a href="${siteUrl()}/crawler/${sig.crawlerId}">Open in CrawlHive</a>${launch ? ` · <a href="${esc(launch)}">🚀 Launch this narrative</a>` : ""}`,
  ].join("\n");
}

// Сообщение: привязка кошелька (/start <код>, /stop, /status) — здесь, остальное — в telegram-public.ts.
async function handleUpdate(u: {
  message?: {
    chat: { id: number; type: string };
    text?: string;
    message_id: number;
    message_thread_id?: number;
    from?: { id: number; first_name?: string; username?: string; language_code?: string };
    reply_to_message?: { text?: string; caption?: string; from?: { is_bot?: boolean; username?: string } };
  };
  callback_query?: { id: string; data?: string; from?: { id: number; language_code?: string }; message?: { chat: { id: number } } };
  inline_query?: { id: string; query: string; from?: { language_code?: string } };
  chat_member?: import("./group-watch").ChatMemberUpdate;
  my_chat_member?: import("./group-watch").ChatMemberUpdate;
}) {
  if (u.chat_member || u.my_chat_member) {
    const gw = await import("./group-watch");
    return u.chat_member ? gw.onChatMember(u.chat_member) : gw.onMyChatMember(u.my_chat_member!);
  }
  const pub = await import("./telegram-public");
  if (u.callback_query) return pub.handleCallback(u.callback_query);
  if (u.inline_query) return pub.handleInline(u.inline_query);
  const m = u.message;
  if (!m?.text) return;
  const chatId = String(m.chat.id);
  const [cmd0, arg] = m.text.trim().split(/\s+/, 2);
  const cmd = cmd0.replace(/@\w+$/, "");
  if (m.chat.type === "private" && cmd === "/start" && arg && !["inline", "scan", "app"].includes(arg) && !arg.startsWith("ref_")) {
    const st = tg();
    const link = st.codes.get(arg);
    if (!link || link.exp < Date.now()) {
      send(chatId, "This link has expired. Open <b>My Signals</b> on the site and press <b>Connect Telegram</b> again.");
      return;
    }
    st.codes.delete(arg);
    (await import("./referrals")).claimFromChat(chatId, link.wallet); // до привязки: ref_<код> из /start этого чата
    setMeta(`tg:${link.wallet}`, chatId);
    send(chatId, `✅ Linked wallet <code>${short(link.wallet)}</code>.\nEvery signal your crawlers find will arrive here. Send /stop to unlink.`);
    return;
  }
  if (m.chat.type === "private" && cmd === "/stop") {
    const mine = metaEntries("tg:").filter(([, v]) => v === chatId);
    for (const [k] of mine) setMeta(k, undefined);
    send(chatId, mine.length ? "Unlinked. No more crawler signals here." : "No wallet is linked to this chat.");
    return;
  }
  if (m.chat.type === "private" && cmd === "/status") {
    const mine = metaEntries("tg:").filter(([, v]) => v === chatId);
    send(chatId, mine.length ? `Linked: ${mine.map(([k]) => `<code>${short(k.slice(3))}</code>`).join(", ")}` : `No wallet linked. Send /verify &lt;address&gt; to unlock your tier here, or connect one at ${siteUrl()}/signals to get your crawlers' signals here.`);
    return;
  }
  return pub.handlePublic({ ...m, text: m.text });
}

async function poll() {
  let offset = 0;
  for (;;) {
    try {
      const updates = await call<{ update_id: number }[]>("getUpdates", { offset, timeout: 50, allowed_updates: ["message", "callback_query", "inline_query", "chat_member", "my_chat_member"] }, 65_000);
      for (const u of updates) {
        offset = u.update_id + 1;
        // Не ждём: скан одного пользователя (до 30 с) не должен задерживать ответы остальным.
        void handleUpdate(u as Parameters<typeof handleUpdate>[0]).catch((e) => console.error("tg update", e));
      }
    } catch (e) {
      const code = (e as { code?: number }).code;
      // 409 — у бота стоит вебхук или его опрашивает другой процесс.
      if (code === 409) console.error("[telegram] getUpdates conflict: another instance or webhook is active");
      await new Promise((r) => setTimeout(r, code === 409 ? 30_000 : 5_000));
    }
  }
}

// Раз в час: напоминание владельцу, что срок краулера кончается (один раз на каждый срок).
function remindExpiring() {
  for (const c of expiringCrawlers(WARN_BEFORE_MS)) {
    const key = `tgwarn:${c.id}:${c.expiresAt}`;
    if (getMeta(key)) continue;
    const chat = chatFor(c.owner);
    if (!chat) continue;
    setMeta(key, "1");
    const days = Math.max(0, Math.ceil((c.expiresAt - Date.now()) / 86400_000));
    send(
      chat,
      `⏳ <b>${esc(c.name)}</b> stops crawling ${days ? `in ${days} day${days > 1 ? "s" : ""}` : "today"}.\n<a href="${siteUrl()}/crawler/${c.id}">Renew it</a> to keep the signals coming.`,
    );
  }
}

// Разбор встроенного Grok Bot приходит отдельным сообщением вслед за сигналом.
const TAKE_ICON = { look: "👀", watch: "⏳", avoid: "⛔" } as const;
export function deliverBotTake(sig: Signal) {
  const chat = telegramEnabled() && sig.owner ? chatFor(sig.owner) : null;
  if (!chat || !sig.bot) return;
  const b = sig.bot;
  const score = b.verdict ? ` · ${esc(b.verdict)}${b.score != null ? ` ${b.score}` : ""}` : "";
  const scan = sig.token?.address ? `\n<a href="${siteUrl()}/scan/${sig.token.address}">Full scan</a>` : "";
  send(chat, `🐙 <b>Grok Bot</b> on ${esc(sig.crawlerName)}${sig.ticker ? ` · <b>$${esc(sig.ticker)}</b>` : ""}\n${TAKE_ICON[b.take]} <b>${b.take.toUpperCase()}</b>${score}\n${esc(b.note)}${b.by === "jev" && b.conf != null ? `\n<i>decided by Jev · ${Math.round(b.conf * 100)}% sure</i>` : ""}${scan}`);
}

export function startTelegram() {
  const st = tg();
  if (st.started || !telegramEnabled()) return;
  st.started = true;
  onLiveSignal((sig) => {
    const chat = sig.owner && chatFor(sig.owner);
    if (chat) send(chat, signalMessage(sig));
  });
  call<{ username: string; has_main_web_app?: boolean }>("getMe", {})
    .then((me) => {
      st.bot = me.username;
      st.mainApp = !!me.has_main_web_app;
      console.log(`[telegram] delivering signals as @${me.username}`);
    })
    .catch((e) => console.error("[telegram] getMe failed:", (e as Error).message));
  // Main Mini App включают в BotFather в любой момент — перепроверяем раз в 30 минут, без перезапуска.
  setInterval(() => {
    call<{ has_main_web_app?: boolean }>("getMe", {})
      .then((me) => (st.mainApp = !!me.has_main_web_app))
      .catch(() => {});
  }, 30 * 60_000);
  // Вебхук мешает long polling — снимаем его, если когда-то ставили.
  call("deleteWebhook", {}).catch(() => {});
  void poll();
  setInterval(remindExpiring, 3600_000);
  setTimeout(remindExpiring, 60_000);
  // Открытые функции бота: список наблюдения, «через 24 часа», оповещения Launch Radar.
  const pub = () => import("./telegram-public");
  setInterval(() => pub().then((p) => p.checkWatches()).catch((e) => console.warn("[telegram] watchlist", (e as Error).message)), 10 * 60_000);
  setInterval(() => pub().then((p) => p.sendFollowups()).catch((e) => console.warn("[telegram] follow-ups", (e as Error).message)), 30 * 60_000);
  // /signals: сделки сигнальных стратегий Paper Engine держателям (колбэк регистрируется в движке).
  import("./tg-signals").then((m) => m.startSignalPush()).catch((e) => console.warn("[telegram] signals", (e as Error).message));
  // Живая торговля: сделки, отказы, вывод и выдача ключа владельцу торгового кошелька (tg-live.ts, при LIVE_TRADING не off).
  import("./tg-live").then((m) => m.startLivePush()).catch((e) => console.warn("[telegram] live", (e as Error).message));
  setInterval(() => pub().then((p) => p.pushRadar()).catch((e) => console.warn("[telegram] radar", (e as Error).message)), 60_000);
  // /verify: ищем в сети перевод-доказательство по открытым проверкам.
  setInterval(() => import("./tg-verify").then((v) => v.checkVerifications()).catch((e) => console.warn("[telegram] verify", (e as Error).message)), 30_000);
  // /digest: ежедневный дайджест в DIGEST_HOUR_UTC (tg-digest.ts).
  import("./tg-digest").then((m) => m.startDigest()).catch((e) => console.warn("[telegram] digest", (e as Error).message));
  setInterval(() => pub().then((p) => p.buybackReminder()).catch((e) => console.warn("[telegram] buyback", (e as Error).message)), 60_000);
  // В меню только главное: проверка токена и поддержка. Остальные команды работают, просто не мешают.
  // Меню по умолчанию на английском, плюс своё для каждого языка (Telegram сам показывает по языку клиента).
  import("./tg-i18n")
    .then(({ menuFor }) => {
      call("setMyCommands", { commands: menuFor("en") }).catch(() => {});
      for (const l of LANGS) if (l !== "en") call("setMyCommands", { commands: menuFor(l), language_code: l }).catch(() => {});
    })
    .catch(() => {});
  // Кнопка меню чата открывает мини-апп.
  call("setChatMenuButton", { menu_button: { type: "web_app", text: "Open app", web_app: { url: `${siteUrl()}/tg` } } }).catch((e) => console.warn("[telegram] menu button", (e as Error).message));
  call("setMyDescription", {
    description: "Memecoin safety scans for Solana and Robinhood Chain: holders, bundles, dev history, copycats, plus a Jev take. Watch tokens, get rug alerts, add me to groups.",
  }).catch(() => {});
  call("setMyShortDescription", { short_description: "Scan memecoins on Solana and Robinhood Chain. Rug alerts, Launch Radar, Track Record." }).catch(() => {});
}
