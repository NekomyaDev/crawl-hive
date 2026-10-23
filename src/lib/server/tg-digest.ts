// Ежедневный дайджест в Telegram: что сканер поймал за сутки (Rug Feed), Track Record оценки v2, лучшие
// бумажные сделки сигнальных стратегий, топ нарративов и сжигания. Данные собирает daily.ts (digestData),
// здесь только текст, подписки (/digest on|off) и рассылка раз в день в DIGEST_HOUR_UTC.
// Личка: по умолчанию включён для Holder и выше, для free выключен. Группы: включает админ, по умолчанию выключен.
import "server-only";
import { TOKEN } from "@/lib/token";
import { digestData, type DigestData } from "./daily";
import { esc, onChatBlocked, send, siteUrl, type Keyboard } from "./telegram";
import { chatTier, inTopic, isAdmin, prefs, prefsAll, rememberTopic, setPrefs } from "./telegram-public";
import { getMeta, metaEntries, setMeta } from "./store";
import { tierAtLeast } from "./tiers";

export const DIGEST_HOUR_UTC = 14;
const LATE_MS = 3 * 3600_000; // проспали окно больше чем на 3 часа (сервер лежал): в этот день не шлём, чтобы не будить ночью
const LAST_KEY = "tgDigestDay"; // день (YYYY-MM-DD) последней рассылки: перезапуск не шлёт второй раз
const PACE_MS = 250; // между отправками дайджеста: общая очередь успевает отвечать остальным

const VERDICT_ICON: Record<string, string> = { CLEAN: "🟢", OK: "🟢", RISKY: "🟠", DANGER: "🔴", TOO_EARLY: "⚪️" };
const HEAT: Record<string, string> = { hot: "🔥", rising: "📈", early: "🌱" };
const REASON: Record<string, string> = { tp: "take profit", sl: "stop loss", trail: "trailing stop", time: "time limit", rug: "liquidity pulled", removed: "strategy retired" };
const n = (x: number) => Math.round(x).toLocaleString("en-US");
const signed = (x: number) => `${x > 0 ? "+" : ""}${Math.round(x)}%`;
const fmtDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function rugLine(x: DigestData["rugs"]["examples"][number]) {
  const what =
    x.kind === "rug"
      ? `rugged${x.liqPulledPct != null ? `, ${x.liqPulledPct}% of liquidity pulled` : ""}${x.hoursToRug != null ? ` ${x.hoursToRug}h after the scan` : ""}`
      : `dumped${x.lowPct != null ? ` ${signed(x.lowPct)}` : ""}`;
  return `${VERDICT_ICON[x.verdict] ?? "⚪️"} <a href="${siteUrl()}${x.path}">$${esc(x.symbol)}</a> · flagged ${x.verdict.replace("_", " ")}${x.score != null ? ` ${x.score}` : ""} · ${what}`;
}

// Текст дайджеста (Telegram HTML). Пустые блоки пропускаем; ведём с того, что поймали.
export function digestText(d: DigestData) {
  const out: string[] = [`🐝 <b>CrawlHive Daily</b> · ${fmtDate(d.date)}`];

  const r = d.rugs;
  if (r.total) {
    const head = r.warnedPct != null && r.warned ? `🛡 <b>${r.warned} of ${r.total}</b> rugs and dumps in the last 24h were flagged in advance (<b>${r.warnedPct}%</b>).` : `🛡 <b>Rug Feed</b>: ${r.total} rugs and dumps in the last 24h.`;
    const split = `${r.rugs} rug${r.rugs === 1 ? "" : "s"}, ${r.dumps} dump${r.dumps === 1 ? "" : "s"}${r.medianHoursToRug != null ? ` · median ${r.medianHoursToRug}h from scan to rug` : ""}`;
    out.push([head, split, ...(r.examples.length ? ["<b>We warned:</b>", ...r.examples.map(rugLine)] : [])].join("\n"));
  } else out.push("🛡 <b>Rug Feed</b>: no rugs or dumps among tracked coins in the last 24h.");

  if (d.track) {
    const t = d.track;
    const parts = [
      t.cleanOk.rugRate != null ? `CLEAN and OK rugged <b>${t.cleanOk.rugRate}%</b> of the time` : "",
      t.danger.rugRate != null ? `DANGER <b>${t.danger.rugRate}%</b>` : "",
    ].filter(Boolean);
    if (parts.length) out.push(`📊 <b>Track Record</b> · score v2, ${n(t.settled)} settled calls\n${parts.join(" vs ")}.`);
  }

  // Только сделки в плюс: блок про лучшие сигналы, а не полный отчёт (полный на /paper).
  const wins = (d.signals?.top ?? []).filter((x) => x.netPct > 0);
  if (wins.length)
    out.push(
      [
        `🤖 <b>Best paper signals, 24h</b>`,
        ...wins.map((x) => `${x.strategy.toUpperCase()} <a href="${siteUrl()}${x.path}">$${esc(x.symbol)}</a> <b>${signed(x.netPct)}</b> · ${REASON[x.reason] ?? esc(x.reason)}`),
        `<i>Paper trades, no real money moved.</i>`,
      ].join("\n"),
    );

  if (d.narratives.length)
    out.push([`🔮 <b>Narrative Radar</b>`, ...d.narratives.map((x) => `${HEAT[x.heat] ?? "🌱"} ${esc(x.title)} · $${esc(x.ticker)}`)].join("\n"));

  if (d.burns && d.burns.total > 0) {
    const b = d.burns;
    out.push(
      [
        `🔥 <b>Burned so far: ${n(b.total)} $${TOKEN.symbol}</b>${b.buybackPct ? ` (buybacks ${b.buybackPct}% of supply)` : ""}`,
        b.last24h.count ? `Last 24h: ${b.last24h.count} burn${b.last24h.count === 1 ? "" : "s"}, ${n(b.last24h.tokens)} tokens` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  const host = siteUrl().replace(/^https?:\/\//, "");
  out.push(`<a href="${siteUrl()}">${esc(host)}</a> · <a href="${siteUrl()}/rugs">Rug Feed</a> · <a href="${siteUrl()}/track">Track Record</a> · <a href="${siteUrl()}/paper">Paper</a>\n<i>Not financial advice.</i>`);
  return out.join("\n\n");
}

const keyboard = (): Keyboard => [
  [{ text: "🛡 Rug Feed", url: `${siteUrl()}/rugs` }, { text: "📊 Track Record", url: `${siteUrl()}/track` }],
  [{ text: "🔮 Narratives", url: `${siteUrl()}/narratives` }, { text: "🤖 Paper", url: `${siteUrl()}/paper` }],
];

// ---------- кому слать ----------

// Явный выбор чата важнее умолчания. Умолчание: личка Holder и выше включена, free и группы выключены.
async function wants(chat: string): Promise<boolean> {
  const p = prefs(chat).digest;
  if (p !== undefined) return p;
  if (chat.startsWith("-")) return false;
  return tierAtLeast(await chatTier(chat).catch(() => "free" as const), "holder");
}

async function recipients(): Promise<string[]> {
  // Кандидаты: все чаты с настройками плюс личные чаты с привязанным кошельком (у них может быть тариф).
  const chats = new Set<string>([...Object.keys(prefsAll()), ...metaEntries("tg:").map(([, v]) => v)]);
  const out: string[] = [];
  for (const c of chats) if (await wants(c)) out.push(c);
  return out;
}

async function broadcast() {
  const d = await digestData();
  const html = digestText(d);
  const kb = keyboard();
  const list = await recipients();
  console.log(`[telegram] digest ${d.date} to ${list.length} chats`);
  for (const chat of list) {
    send(chat, html, kb, inTopic(chat, "digest"));
    await new Promise((r) => setTimeout(r, PACE_MS));
  }
}

// Раз в минуту: пришло время и сегодня ещё не слали. День помечаем до рассылки: упадёт посередине, повтора не будет.
export async function digestTick(now = Date.now()) {
  const today = new Date(now).toISOString().slice(0, 10);
  const slot = Date.parse(`${today}T${String(DIGEST_HOUR_UTC).padStart(2, "0")}:00:00Z`);
  if (now < slot || now - slot > LATE_MS || getMeta(LAST_KEY) === today) return;
  setMeta(LAST_KEY, today);
  await broadcast();
}

const g = globalThis as unknown as { __crawlhiveTgDigest?: boolean };
export function startDigest() {
  if (g.__crawlhiveTgDigest) return;
  g.__crawlhiveTgDigest = true;
  // Заблокировал бота или выгнал из группы: дайджест выключаем, чтобы завтра не слать впустую.
  onChatBlocked((chat) => {
    if (prefsAll()[chat]) setPrefs(chat, { digest: false });
  });
  setInterval(() => void digestTick().catch((e) => console.warn("[telegram] digest", (e as Error).message)), 60_000);
}

// ---------- /digest ----------

const when = () => `${String(DIGEST_HOUR_UTC).padStart(2, "0")}:00 UTC`;

export async function digestCommand(chat: string, arg: string, group?: { userId?: number; thread?: number }) {
  const a = arg.trim().toLowerCase();
  const extra = group?.thread ? { message_thread_id: group.thread } : {};
  if (a === "on" || a === "off") {
    if (group && !(await isAdmin(chat, group.userId))) return send(chat, "Only group admins can change this.", undefined, extra);
    const on = a === "on";
    setPrefs(chat, { digest: on });
    if (group && on) rememberTopic(chat, "digest", group.thread);
    return send(
      chat,
      on
        ? `✅ Daily digest is on: every day at ${when()} ${group ? "this chat" : "you"} get${group ? "s" : ""} the rugs we caught, the best paper signals, top narratives and burns.\nSend /digest off to stop.`
        : "Daily digest is off. Send /digest on to turn it back on.",
      undefined,
      extra,
    );
  }
  const on = await wants(chat);
  const status = `Daily digest: <b>${on ? "on" : "off"}</b>, every day at ${when()}. ${group ? "Admins: " : ""}/digest ${on ? "off" : "on"}`;
  // В группе только статус, чтобы команда не превращалась в спам; в личке сразу показываем сегодняшний дайджест.
  if (group) return send(chat, status, undefined, extra);
  const d = await digestData();
  send(chat, `${digestText(d)}\n\n${status}`, keyboard());
}
