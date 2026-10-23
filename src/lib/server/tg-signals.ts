// Стратегические сигналы для держателей: когда сигнальная стратегия Paper Engine открывает или закрывает
// бумажную позицию, подписавшимся через /signals (Holder и выше) приходит сообщение в Telegram.
// Движок о Telegram не знает: здесь регистрируется колбэк onPaperEvent, startSignalPush зовёт startTelegram.
// Это бумажная торговля, не настоящие сделки и не финансовый совет: так и пишем в каждом сообщении.
import "server-only";
import { onPaperEvent, type ExitReason, type PaperEvent } from "./paper-engine";
import { TOKEN } from "@/lib/token";
import { esc, send, siteUrl } from "./telegram";
import { chatTier, prefs, prefsAll, setPrefs } from "./telegram-public";
import { tierAtLeast } from "./tiers";

// Сигнальные стратегии: самые устойчивые сейчас. Новая сигнальная стратегия = новый id в списке.
export const SIGNAL_STRATEGIES = ["s12", "s19"] as const;
const isSignal = (id: string) => (SIGNAL_STRATEGIES as readonly string[]).includes(id);

const MIN_GAP_MS = 1000; // не чаще одного сообщения в секунду одному пользователю

const REASON: Record<ExitReason, string> = {
  tp: "take profit",
  sl: "stop loss",
  trail: "trailing stop",
  time: "time limit",
  rug: "liquidity pulled",
  removed: "strategy retired",
};

const usd = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`);
const signed = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n)}%`;
const code = (id: string) => id.toUpperCase();

// Публичный вердикт (с 22.10 это v2, как на странице скана); у старых сканов без v2 остаётся v1 из сделки.
function shownVerdict(e: Extract<PaperEvent, { kind: "open" }>) {
  try {
    const f = JSON.parse(e.features) as { verdictV2?: string | null; scoreV2?: number | null };
    if (f.verdictV2) return { verdict: f.verdictV2, score: f.scoreV2 ?? null };
  } catch {
    // признаки битые: показываем v1
  }
  return { verdict: e.verdict, score: e.score };
}

export function signalText(e: PaperEvent) {
  if (e.kind === "open") {
    const v = shownVerdict(e);
    return `🤖 Strategy ${code(e.strategy)} ${esc(e.label)} bought <b>$${esc(e.symbol)}</b> · ${v.verdict.replace("_", " ")}${v.score != null ? ` ${v.score}` : ""} · liq $${usd(e.liq)} · paper`;
  }
  return `${code(e.strategy)} closed <b>$${esc(e.symbol)}</b> ${REASON[e.reason]} ${signed(e.netPct)} · paper`;
}

const keyboard = (e: PaperEvent) => [[{ text: "🔎 Full scan", url: `${siteUrl()}/scan/${e.token}` }, { text: "📊 Paper trading", url: `${siteUrl()}/paper` }]];

// Очередь отправки общая (telegram.ts), а здесь — разнос по времени на каждого пользователя.
const g = globalThis as unknown as { __crawlhiveTgSignals?: { started: boolean; next: Map<string, number> } };
const st = () => (g.__crawlhiveTgSignals ??= { started: false, next: new Map() });
function sendPaced(chat: string, html: string, kb: ReturnType<typeof keyboard>) {
  const s = st();
  const now = Date.now();
  const at = Math.max(now, s.next.get(chat) ?? 0);
  s.next.set(chat, at + MIN_GAP_MS);
  if (s.next.size > 5000) for (const [k, v] of s.next) if (v < now) s.next.delete(k);
  if (at <= now) send(chat, html, kb);
  else setTimeout(() => send(chat, html, kb), at - now);
}

async function pushSignal(e: PaperEvent) {
  if (!isSignal(e.strategy)) return;
  const subs = Object.entries(prefsAll()).filter(([chat, p]) => p.signals && !chat.startsWith("-"));
  if (!subs.length) return;
  const html = signalText(e);
  const kb = keyboard(e);
  for (const [chat] of subs) {
    // Тариф проверяем на каждой отправке: продал токен — сигналы молча прекращаются. Заблокировавшего бота
    // очередь отвязывает от кошельков (403), и его тариф дальше free, так что он тоже пропускается.
    const tier = await chatTier(chat).catch(() => "free" as const);
    if (!tierAtLeast(tier, "holder")) continue;
    sendPaced(chat, html, kb);
  }
}

export function startSignalPush() {
  const s = st();
  if (s.started) return;
  s.started = true;
  onPaperEvent((e) => void pushSignal(e).catch((err) => console.warn("[telegram] signals", (err as Error).message)));
}

// ---------- /signals ----------

const INTRO = () =>
  [
    "🤖 <b>Strategy signals</b>",
    `When one of our signal strategies (${SIGNAL_STRATEGIES.map(code).join(", ")}) opens or closes a position in the Paper Engine, you get it here the moment it happens.`,
    "These are paper trades: no real money moves. Paper, not financial advice.",
    `Track every strategy live: ${siteUrl()}/paper`,
  ].join("\n");

async function holderOnly(chat: string) {
  if (tierAtLeast(await chatTier(chat).catch(() => "free" as const), "holder")) return true;
  send(
    chat,
    `🤖 <b>Strategy signals</b> are for $${TOKEN.symbol} holders (Holder tier and up): live Paper Engine trades from our most robust strategies, pushed here. Paper, not financial advice.\nAlready holding? Send /verify &lt;address&gt; to unlock your tier here.`,
    [[{ text: "💎 See tiers", url: `${siteUrl()}/pricing` }]],
  );
  return false;
}

export async function setSignals(chat: string, on: boolean) {
  if (on && !(await holderOnly(chat))) return;
  setPrefs(chat, { signals: on });
  send(
    chat,
    on ? `✅ Strategy signals are on.\n\n${INTRO()}\n\nSend /signals off to stop.` : "Strategy signals are off. Send /signals on to turn them back on.",
    [[on ? { text: "🔕 Turn off", callback_data: "s:off" } : { text: "🔔 Turn on", callback_data: "s:on" }]],
  );
}

export async function signalsCommand(chat: string, arg: string) {
  const a = arg.trim().toLowerCase();
  if (a === "on" || a === "off") return setSignals(chat, a === "on");
  if (!(await holderOnly(chat))) return;
  const on = !!prefs(chat).signals;
  send(chat, `${INTRO()}\n\nStatus: ${on ? "on" : "off"}.`, [[on ? { text: "🔕 Turn off", callback_data: "s:off" } : { text: "🔔 Turn on", callback_data: "s:on" }]]);
}
