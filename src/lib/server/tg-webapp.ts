// Вход в Telegram Mini App: Telegram передаёт приложению initData — кто открыл и когда, подписано токеном бота.
// Проверяем подпись по алгоритму из документации (HMAC-SHA256 с ключом от "WebAppData") и свежесть (сутки).
// Никаких паролей и подписей кошельком: пользователь Telegram известен сразу. Его личный чат с ботом
// имеет тот же id, поэтому список наблюдения и настройки общие с ботом.
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiError, metaEntries } from "./store";

const MAX_AGE_S = 24 * 3600;

export interface TgUser {
  id: number;
  first_name?: string;
  username?: string;
  photo_url?: string;
}

export function verifyInitData(raw: string): TgUser | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token || !raw) return null;
  const params = new URLSearchParams(raw);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const expected = createHmac("sha256", secret).update(check).digest();
  const got = Buffer.from(hash, "hex");
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  const authDate = Number(params.get("auth_date"));
  if (!authDate || Date.now() / 1000 - authDate > MAX_AGE_S) return null;
  try {
    const user = JSON.parse(params.get("user") ?? "null") as TgUser | null;
    return user?.id ? user : null;
  } catch {
    return null;
  }
}

// Пользователь из заголовка x-tg-init; без него или с поддельной подписью — 401.
export function tgUserFrom(req: Request): TgUser {
  const u = verifyInitData(req.headers.get("x-tg-init") ?? "");
  if (!u) throw new ApiError("Open the app from @crawlhivebot in Telegram", 401);
  return u;
}

// Кошельки, привязанные к этому Telegram (через «Connect Telegram» на сайте).
export const walletsOf = (u: TgUser) => metaEntries("tg:").filter(([, chat]) => chat === String(u.id)).map(([k]) => k.slice(3));
