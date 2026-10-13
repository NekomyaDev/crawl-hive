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
import { expiringCrawlers, getMeta, metaEntries, onLiveSignal, setMeta } from "./store";
import type { ScanResult } from "./scan";

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
type Keyboard = { text: string; url?: string; callback_data?: string }[][];

function send(chatId: string, html: string, keyboard?: Keyboard) {
  const st = tg();
  st.queue = st.queue
    .then(() =>
      call("sendMessage", {
        chat_id: chatId,
        text: html,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
      }),
    )
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

// ---------- скан и список наблюдения ----------

const SCANS_PER_HOUR = 10; // сканов на чат в час: скан бесплатный для нас (без X), но ходит в RPC
const WATCH_MAX = 5;
const WATCH_MS = 7 * 86400_000;
const WATCH_CHECK_MS = 10 * 60_000;
const WATCH_RESCAN_MS = 3 * 3600_000;
const ADDR_RE = /\b(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})\b/;

interface Watch {
  id: string;
  chain: string;
  symbol: string;
  verdict: string;
  price0: number;
  liq0: number;
  at: number;
  rescanAt: number;
  alerted: string[]; // о чём уже предупредили: liq, dump, danger, gone
}

const scanHits = new Map<string, number[]>();
function allowScan(chatId: string) {
  const now = Date.now();
  const hits = (scanHits.get(chatId) ?? []).filter((t) => now - t < 3600_000);
  if (hits.length >= SCANS_PER_HOUR) return false;
  hits.push(now);
  scanHits.set(chatId, hits);
  return true;
}

function watches(): Record<string, Watch[]> {
  try {
    return JSON.parse(getMeta("tgwatch") ?? "{}");
  } catch {
    return {};
  }
}
const saveWatches = (w: Record<string, Watch[]>) => setMeta("tgwatch", JSON.stringify(w));

// Запрос к скану из текста: адрес, ссылка DexScreener / pump.fun или $TICKER.
function scanQuery(text: string): string | null {
  const t = text.trim();
  if (/^\$[A-Za-z][A-Za-z0-9]{1,11}$/.test(t)) return t;
  if (/dexscreener\.com|pump\.fun|geckoterminal\.com/.test(t)) return t.split(/\s+/).find((x) => /^https?:\/\//.test(x)) ?? null;
  return t.match(ADDR_RE)?.[1] ?? null;
}

const VERDICT_ICON: Record<string, string> = { CLEAN: "🟢", OK: "🟢", RISKY: "🟠", DANGER: "🔴", TOO_EARLY: "⚪️" };

function scanMessage(r: ScanResult) {
  const flags = r.factors.filter((f) => f.impact < 0).slice(0, 4);
  const m = r.market;
  const mk = m ? [m.liquidityUsd ? `liq $${fmtUsd(m.liquidityUsd)}` : "", m.fdv ? `FDV $${fmtUsd(m.fdv)}` : "", m.ageHours != null ? `age ${m.ageHours < 1 ? `${Math.round(m.ageHours * 60)}m` : `${Math.round(m.ageHours)}h`}` : ""].filter(Boolean).join(" · ") : "";
  return [
    `${VERDICT_ICON[r.verdict] ?? "⚪️"} <b>$${esc(r.symbol)}</b> · <b>${r.score ?? "—"} ${r.verdict.replace("_", " ")}</b>`,
    esc(r.reason),
    mk,
    ...flags.map((f) => `▫️ ${esc(f.label)}: ${esc(f.note).slice(0, 90)}`),
    `<code>${esc(r.id)}</code>`,
  ]
    .filter(Boolean)
    .join("\n");
}

const fmtUsd = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${Math.round(n)}`);

async function doScan(chatId: string, q: string) {
  if (!allowScan(chatId)) {
    send(chatId, `Up to ${SCANS_PER_HOUR} scans an hour per chat. Full scans are always free on ${siteUrl()}`);
    return;
  }
  call("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
  try {
    const { runScan } = await import("./scan");
    const r = await runScan(q, () => {}, q.startsWith("0x") ? "robinhood" : undefined);
    send(chatId, scanMessage(r), [
      [
        { text: "Full scan", url: `${siteUrl()}/scan/${r.id}` },
        { text: "👁 Watch 7 days", callback_data: `w:${r.id}` },
      ],
    ]);
  } catch (e) {
    send(chatId, `Could not scan that: ${esc((e as Error).message).slice(0, 160)}`);
  }
}

async function addWatch(chatId: string, id: string) {
  const all = watches();
  const mine = (all[chatId] ?? []).filter((w) => Date.now() - w.at < WATCH_MS);
  if (mine.some((w) => w.id === id)) return send(chatId, "Already on your watchlist. /watchlist");
  if (mine.length >= WATCH_MAX) return send(chatId, `Your watchlist is full (${WATCH_MAX}). Remove one with /unwatch.`);
  const { savedScan, runScan } = await import("./scan");
  const r = savedScan(id) ?? (await runScan(id, () => {}, id.startsWith("0x") ? "robinhood" : undefined, { record: false }).catch(() => undefined));
  if (!r?.market?.priceUsd) return send(chatId, "This token has no tradable pair yet, nothing to watch.");
  const now = Date.now();
  mine.push({ id, chain: r.chain, symbol: r.symbol, verdict: r.verdict, price0: r.market.priceUsd, liq0: r.market.liquidityUsd ?? 0, at: now, rescanAt: now + WATCH_RESCAN_MS, alerted: [] });
  all[chatId] = mine;
  saveWatches(all);
  send(chatId, `👁 Watching <b>$${esc(r.symbol)}</b> for 7 days. I will ping you if liquidity is pulled, the price falls 50% or the verdict turns DANGER.`);
}

// Раз в 10 минут: цена и ликвидность всех наблюдаемых токенов, раз в 3 часа — новый скан.
async function checkWatches() {
  const all = watches();
  const now = Date.now();
  const byChain = new Map<string, string[]>();
  for (const [chat, list] of Object.entries(all)) {
    all[chat] = list.filter((w) => now - w.at < WATCH_MS);
    if (!all[chat].length) delete all[chat];
    for (const w of all[chat] ?? []) byChain.set(w.chain, [...new Set([...(byChain.get(w.chain) ?? []), w.id])]);
  }
  const { bestPairs } = await import("./crawl/dexscreener");
  const pairs = new Map<string, Awaited<ReturnType<typeof bestPairs>> extends Map<string, infer P> ? P | undefined : never>();
  for (const [chain, ids] of byChain) {
    const got = await bestPairs(chain, ids).catch(() => null);
    if (got) for (const id of ids) pairs.set(id, got.get(id));
  }
  for (const [chat, list] of Object.entries(all)) {
    for (const w of list) {
      if (!pairs.has(w.id)) continue;
      const p = pairs.get(w.id);
      const once = (k: string, html: string) => {
        if (w.alerted.includes(k)) return;
        w.alerted.push(k);
        send(chat, html, [[{ text: "Open scan", url: `${siteUrl()}/scan/${w.id}` }]]);
      };
      const price = Number(p?.priceUsd);
      if (!p || !(price > 0)) {
        once("gone", `🚨 <b>$${esc(w.symbol)}</b>: the trading pair is gone. Liquidity was likely pulled.`);
        continue;
      }
      const liq = p.liquidity?.usd ?? 0;
      const chg = ((price - w.price0) / w.price0) * 100;
      if (w.liq0 > 0 && liq < w.liq0 * 0.3) once("liq", `🚨 <b>$${esc(w.symbol)}</b>: liquidity fell from $${fmtUsd(w.liq0)} to $${fmtUsd(liq)}.`);
      if (chg <= -50) once("dump", `🔻 <b>$${esc(w.symbol)}</b> is down ${Math.round(chg)}% since you started watching.`);
    }
  }
  saveWatches(all);
  // Пересканы по одному, чтобы не нагружать RPC.
  const { runScan } = await import("./scan");
  for (const [chat, list] of Object.entries(all)) {
    for (const w of list) {
      if (w.rescanAt > now || w.alerted.includes("danger")) continue;
      w.rescanAt = now + WATCH_RESCAN_MS;
      const r = await runScan(w.id, () => {}, w.chain === "robinhood" ? "robinhood" : undefined, { record: false }).catch(() => null);
      if (r && r.verdict === "DANGER" && w.verdict !== "DANGER") {
        w.alerted.push("danger");
        send(chat, `🔴 <b>$${esc(w.symbol)}</b> turned <b>DANGER</b> (${r.score ?? "—"}): ${esc(r.reason)}`, [[{ text: "Open scan", url: `${siteUrl()}/scan/${w.id}` }]]);
      }
      if (r) w.verdict = r.verdict;
    }
  }
  saveWatches(all);
}

async function handleCallback(q: { id: string; data?: string; message?: { chat: { id: number } } }) {
  call("answerCallbackQuery", { callback_query_id: q.id }).catch(() => {});
  const chatId = q.message ? String(q.message.chat.id) : null;
  if (!chatId || !q.data) return;
  if (q.data.startsWith("w:")) await addWatch(chatId, q.data.slice(2));
}

async function radarMessage(chatId: string) {
  const { radarFeed } = await import("./radar");
  const f = radarFeed();
  if (!f.items.length) return send(chatId, "Launch Radar has nothing to show yet. Try again in a few minutes.");
  send(
    chatId,
    [`📡 <b>Launch Radar</b> · last ${Math.min(6, f.items.length)} launches (${f.delayMin} min delay)`, ...f.items.slice(0, 6).map((e) => `${VERDICT_ICON[e.verdict] ?? "⚪️"} <a href="${siteUrl()}/scan/${e.id}">$${esc(e.symbol)}</a> · ${e.score ?? "—"} ${e.verdict.replace("_", " ")} · liq $${fmtUsd(e.liq)}`), `\nCrawler owners get launches like these live: ${siteUrl()}/spawn`].join("\n"),
  );
}

const HELP = () =>
  [
    "🐝 <b>CrawlHive</b>: memecoin crawlers that never sleep.",
    "",
    "Send a token address, a DexScreener / pump.fun link or a $TICKER and I scan it: holders, bundles, dev history, copycats.",
    "",
    "/watchlist: tokens you watch · /unwatch &lt;address&gt;",
    "/radar: fresh launches the swarm scanned",
    "/status · /stop: crawler signals linked to your wallet",
    "",
    `Your own crawlers and their signals: ${siteUrl()}/signals`,
  ].join("\n");

async function handleUpdate(u: {
  message?: { chat: { id: number; type: string }; text?: string };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number } } };
}) {
  if (u.callback_query) return handleCallback(u.callback_query);
  const m = u.message;
  if (!m?.text) return;
  const chatId = String(m.chat.id);
  const [cmd0, arg] = m.text.trim().split(/\s+/, 2);
  const cmd = cmd0.replace(/@\w+$/, "");
  // В группах отвечаем только на /scan и /radar, чтобы не мешать разговору.
  if (m.chat.type !== "private") {
    if (cmd === "/scan" && arg) return doScan(chatId, arg);
    if (cmd === "/radar") return radarMessage(chatId);
    return;
  }
  if (cmd === "/scan") return arg ? doScan(chatId, arg) : send(chatId, "Send /scan followed by a token address or $TICKER.");
  if (cmd === "/radar") return radarMessage(chatId);
  if (cmd === "/watchlist") {
    const mine = (watches()[chatId] ?? []).filter((w) => Date.now() - w.at < WATCH_MS);
    return send(chatId, mine.length ? ["👁 <b>Watching</b>", ...mine.map((w) => `<a href="${siteUrl()}/scan/${w.id}">$${esc(w.symbol)}</a> · ${w.verdict.replace("_", " ")} · ${Math.ceil((w.at + WATCH_MS - Date.now()) / 86400_000)}d left · <code>${esc(w.id)}</code>`)].join("\n") : "Your watchlist is empty. Scan a token and tap 👁 Watch.");
  }
  if (cmd === "/unwatch") {
    const all = watches();
    const before = all[chatId]?.length ?? 0;
    all[chatId] = (all[chatId] ?? []).filter((w) => w.id !== arg);
    saveWatches(all);
    return send(chatId, (all[chatId]?.length ?? 0) < before ? "Removed." : "Send /unwatch followed by the token address from /watchlist.");
  }
  if (cmd === "/help" || (cmd === "/start" && !arg)) return send(chatId, HELP());
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
  const q = scanQuery(m.text);
  if (q) return doScan(chatId, q);
  send(chatId, HELP());
}

async function poll() {
  let offset = 0;
  for (;;) {
    try {
      const updates = await call<{ update_id: number }[]>("getUpdates", { offset, timeout: 50, allowed_updates: ["message", "callback_query"] }, 65_000);
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
  setInterval(() => checkWatches().catch((e) => console.warn("[telegram] watchlist", (e as Error).message)), WATCH_CHECK_MS);
  // Команды в меню бота.
  call("setMyCommands", {
    commands: [
      { command: "scan", description: "Scan a token: address, link or $TICKER" },
      { command: "watchlist", description: "Tokens you watch" },
      { command: "radar", description: "Fresh launches the swarm scanned" },
      { command: "status", description: "Wallet linked for crawler signals" },
      { command: "help", description: "What I can do" },
    ],
  }).catch(() => {});
}
