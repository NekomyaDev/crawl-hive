// Доставка сигналов в Telegram. Бот работает через long polling (вебхук и открытый порт не нужны).
// Привязка: вошедший кошелёк получает одноразовую ссылку t.me/<bot>?start=<код>, бот по коду
// запоминает чат за кошельком. Дальше каждый сигнал живого краулера уходит владельцу в личку,
// а за 3 дня до конца оплаченного срока бот напоминает о продлении.
import "server-only";
import { randomBytes } from "node:crypto";
import type { Signal } from "../types";
import { SIGNAL_KIND_LABEL } from "../spec";
import { expiringCrawlers, getMeta, metaEntries, onLiveSignal, setMeta } from "./store";

const API = "https://api.telegram.org";
const CODE_TTL_MS = 15 * 60_000;
const WARN_BEFORE_MS = 3 * 86400_000;

interface TgState {
  bot?: string; // username, известен после getMe
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
export const telegramBotName = () => (telegramEnabled() ? (tg().bot ?? process.env.TELEGRAM_BOT_USERNAME?.trim() ?? null) : null);
const siteUrl = () => (process.env.PUBLIC_URL?.trim() || "https://crawlhive.xyz").replace(/\/$/, "");

async function call<T>(method: string, params: Record<string, unknown>, timeoutMs = 15_000): Promise<T> {
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

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

// Сообщения шлём по одному: так не упираемся в лимиты Telegram и сохраняем порядок.
function send(chatId: string, html: string) {
  const st = tg();
  st.queue = st.queue
    .then(() => call("sendMessage", { chat_id: chatId, text: html, parse_mode: "HTML", link_preview_options: { is_disabled: true } }))
    .catch((e: Error & { code?: number }) => {
      // Пользователь заблокировал бота — отвязываем его кошельки, чтобы не долбиться впустую.
      if (e.code === 403) {
        for (const [k, v] of metaEntries("tg:")) if (v === chatId) setMeta(k, undefined);
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
  return [
    head,
    `${ticker}${esc(sig.text)}${ca}`,
    `confidence ${Math.round(sig.confidence * 100)}%${links ? ` · ${links}` : ""}${scoring}`,
    `<a href="${siteUrl()}/crawler/${sig.crawlerId}">Open in CrawlHive</a>`,
  ].join("\n");
}

async function handleUpdate(u: { message?: { chat: { id: number; type: string }; text?: string } }) {
  const m = u.message;
  if (!m?.text || m.chat.type !== "private") return;
  const chatId = String(m.chat.id);
  const [cmd, arg] = m.text.trim().split(/\s+/, 2);
  if (cmd === "/start" && arg) {
    const st = tg();
    const link = st.codes.get(arg);
    if (!link || link.exp < Date.now()) {
      send(chatId, "This link has expired. Open <b>My Signals</b> on the site and press <b>Connect Telegram</b> again.");
      return;
    }
    st.codes.delete(arg);
    setMeta(`tg:${link.wallet}`, chatId);
    send(
      chatId,
      `✅ Linked wallet <code>${short(link.wallet)}</code>.\nEvery signal your crawlers find will arrive here. Send /stop to unlink.`,
    );
    return;
  }
  if (cmd === "/stop") {
    const mine = metaEntries("tg:").filter(([, v]) => v === chatId);
    for (const [k] of mine) setMeta(k, undefined);
    send(chatId, mine.length ? "Unlinked. No more signals here." : "No wallet is linked to this chat.");
    return;
  }
  if (cmd === "/status") {
    const mine = metaEntries("tg:").filter(([, v]) => v === chatId);
    send(
      chatId,
      mine.length
        ? `Linked: ${mine.map(([k]) => `<code>${short(k.slice(3))}</code>`).join(", ")}`
        : `No wallet linked. Connect one at ${siteUrl()}/signals`,
    );
    return;
  }
  send(
    chatId,
    `I deliver signals from your CrawlHive crawlers.\nOpen ${siteUrl()}/signals, sign in with your wallet and press <b>Connect Telegram</b>.\n\n/status · /stop`,
  );
}

async function poll() {
  let offset = 0;
  for (;;) {
    try {
      const updates = await call<{ update_id: number }[]>("getUpdates", { offset, timeout: 50, allowed_updates: ["message"] }, 65_000);
      for (const u of updates) {
        offset = u.update_id + 1;
        await handleUpdate(u as Parameters<typeof handleUpdate>[0]).catch((e) => console.error("tg update", e));
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

export function startTelegram() {
  const st = tg();
  if (st.started || !telegramEnabled()) return;
  st.started = true;
  onLiveSignal((sig) => {
    const chat = sig.owner && chatFor(sig.owner);
    if (chat) send(chat, signalMessage(sig));
  });
  call<{ username: string }>("getMe", {})
    .then((me) => {
      st.bot = me.username;
      console.log(`[telegram] delivering signals as @${me.username}`);
    })
    .catch((e) => console.error("[telegram] getMe failed:", (e as Error).message));
  // Вебхук мешает long polling — снимаем его, если когда-то ставили.
  call("deleteWebhook", {}).catch(() => {});
  void poll();
  setInterval(remindExpiring, 3600_000);
  setTimeout(remindExpiring, 60_000);
}
