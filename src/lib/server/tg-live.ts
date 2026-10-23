// Живая торговля в Telegram: движок (live-trader.ts) о Telegram не знает, здесь регистрируется колбэк onLiveEvent.
// Владельцу торгового кошелька в привязанный чат (chatFor) уходят покупки, продажи с P&L, отказы, уведомления,
// вывод, выдача ключа (как тревога безопасности) и выключатель. В режиме dryrun каждое сообщение с пометкой DRY RUN.
// startLivePush зовёт startTelegram, как startSignalPush из tg-signals.
import "server-only";
import { chatFor, esc, send, siteUrl } from "./telegram";
import { liveConfig, type LiveEvent } from "./live-core";
import { onLiveEvent } from "./live-trader";
import { memDb } from "./memory-db";

const g = globalThis as unknown as { __crawlhiveTgLive?: { started: boolean } };

const tx = (sig: string | null) => (sig ? ` · <a href="https://solscan.io/tx/${encodeURIComponent(sig)}">tx</a>` : "");
const solTxt = (n: number) => `${Math.round(n * 1e4) / 1e4} SOL`;
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "-" : ""}${solTxt(Math.abs(n))}`;
const cut = (s: string, n = 160) => esc(s.length > n ? `${s.slice(0, n)}...` : s);
const kb = () => [[{ text: "Open Live Trading", url: `${siteUrl()}/live` }]];

// Пометка режима: у сделок свой режим (позиция dryrun остаётся dryrun), у остального текущий режим сервера.
const tag = (mode: string) => (mode === "dryrun" ? "🧪 <b>DRY RUN</b> · " : "");

// Коды уведомлений, у которых уже есть своё событие: второй раз то же самое не шлём.
const DUP_NOTICES = new Set(["buy_failed", "sell_failed"]);

export function liveText(e: LiveEvent): string | null {
  const now = liveConfig().mode;
  switch (e.kind) {
    case "buy":
      return `${tag(e.mode)}🟢 Bought <b>$${esc(e.symbol)}</b> for ${solTxt(e.solIn)} · ${esc(e.strategy.toUpperCase())}${tx(e.sig)}`;
    case "buy_failed":
      return `${tag(e.mode)}⚠️ Buy of <b>$${esc(e.symbol)}</b> failed (${esc(e.strategy.toUpperCase())}): ${cut(e.error)}`;
    case "sell":
      return `${tag(e.mode)}${e.pnlSol >= 0 ? "✅" : "🔻"} Sold <b>$${esc(e.symbol)}</b> · P&amp;L ${signed(e.pnlSol)}${e.feeSol > 0 ? ` · fee ${solTxt(e.feeSol)}` : ""} · ${esc(e.reason)}${tx(e.sig)}`;
    case "sell_failed":
      return `${tag(now)}⚠️ Could not sell <b>$${esc(e.symbol)}</b> after ${e.attempts} attempts: ${cut(e.error, 120)}. Retrying every 5 minutes.`;
    case "notice":
      return DUP_NOTICES.has(e.code) ? null : `${tag(now)}ℹ️ ${cut(e.text, 300)}`;
    case "withdraw":
      return `${tag(now)}💸 Withdrawal sent: ${e.asset === "SOL" ? `${esc(e.amount)} SOL` : `${esc(e.amount)} raw units of <code>${esc(e.asset)}</code>`} to your wallet${tx(e.sig)}`;
    case "export":
      return `${tag(now)}🚨 <b>Security alert</b>: the private key of your trading wallet was just exported. If this was not you, withdraw everything now and sign out everywhere.`;
    case "kill":
      return `${tag(now)}${e.on ? "⛔ Live trading paused by the admin: no new entries." : "▶️ Live trading resumed."}${e.closeAll ? " Open positions are being closed." : ""}`;
    default:
      return null; // fee: в казну, пользователю отдельным сообщением не шлём
  }
}

// Выключатель касается всех: шлём каждому владельцу торгового кошелька с привязанным чатом.
function allOwners(): string[] {
  try {
    const d = memDb();
    return d ? (d.db.prepare("SELECT owner FROM live_wallets").all() as { owner: string }[]).map((r) => r.owner) : [];
  } catch {
    return []; // таблицы ещё нет
  }
}

function push(e: LiveEvent) {
  const html = liveText(e);
  if (!html) return;
  const owners = e.kind === "kill" ? allOwners() : [e.owner];
  const sent = new Set<string>();
  for (const o of owners) {
    const chat = chatFor(o);
    if (!chat || sent.has(chat)) continue;
    sent.add(chat);
    send(chat, html, kb());
  }
}

export function startLivePush() {
  const s = (g.__crawlhiveTgLive ??= { started: false });
  if (s.started || liveConfig().mode === "off") return;
  s.started = true;
  onLiveEvent((e) => {
    try {
      push(e);
    } catch (err) {
      console.warn("[telegram] live", (err as Error).message);
    }
  });
}
