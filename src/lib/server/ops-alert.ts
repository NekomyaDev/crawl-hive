// Оповещения владельцу о поломках внешних сервисов (кончились кредиты Grok, RPC упёрся в лимит и т.п.).
// Шлёт в личку админам бота: чаты из adminChats() плюс пользователи бота с админским id или username.
// Один и тот же ключ не чаще раза в 6 часов, чтобы не заспамить при каждом упавшем запросе. Время последнего
// оповещения храним в meta: иначе каждая выкатка сбрасывает его и тот же алерт приходит после каждого рестарта.
import "server-only";
import { adminRecipients } from "./admin";
import { esc, send } from "./telegram";
import { getMeta, setMeta } from "./store";

const EVERY_MS = 6 * 3600_000;
const g = globalThis as unknown as { __crawlhiveOps?: Map<string, number> };

export function opsAlert(key: string, text: string, everyMs = EVERY_MS) {
  const last = (g.__crawlhiveOps ??= new Map());
  const now = Date.now();
  const prev = last.get(key) ?? Number(getMeta(`ops:${key}`) ?? 0);
  if (now - prev < everyMs) return;
  last.set(key, now);
  setMeta(`ops:${key}`, String(now));
  console.warn(`[ops] ${key}: ${text}`);
  if (!process.env.TELEGRAM_BOT_TOKEN?.trim()) return;
  for (const chat of adminRecipients()) send(chat, `⚠️ <b>CrawlHive ops</b>\n${esc(text)}`);
}
