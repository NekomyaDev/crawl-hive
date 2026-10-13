// Обёртки для route handlers: достаём кошелёк из заголовка и превращаем ошибки в JSON.
import "server-only";
import { connection } from "next/server";
import { ApiError } from "./store";
import { sessionWallet } from "./auth";

const ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Кошелёк берётся только из подписанной сессии (см. auth.ts), заголовку с адресом мы не верим.
export function walletFrom(req: Request, required = true): string {
  const w = sessionWallet(req);
  if (!w && required) throw new ApiError("Connect and sign in with your wallet first", 401);
  return w ?? "";
}

// Адрес Solana или EVM (Robinhood Chain). Адреса EVM храним в нижнем регистре.
export function isAddress(a: string) {
  return ADDRESS_RE.test(a) || /^0x[0-9a-f]{40}$/.test(a);
}

// Данные живые, поэтому каждый handler сначала ждёт реальный запрос и не пререндерится.
export async function handle<T>(fn: () => T | Promise<T>): Promise<Response> {
  await connection();
  try {
    return Response.json(await fn());
  } catch (e) {
    if (e instanceof ApiError) return Response.json({ error: e.message }, { status: e.status });
    console.error(e);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}

// Настоящий IP клиента: ПОСЛЕДНЕЕ значение X-Forwarded-For — его дописывает наш Caddy. Первое значение
// задаёт сам клиент, по нему лимиты обходились подменой заголовка.
export function clientIp(req: Request) {
  const xff = req.headers.get("x-forwarded-for");
  return (xff ? xff.split(",").at(-1)!.trim() : req.headers.get("x-real-ip")) || "local";
}

// Тела запросов у нас маленькие (спецификации, id): больше 64 КБ — отказ до разбора JSON.
const MAX_BODY = 64 * 1024;

export async function body<T>(req: Request): Promise<T> {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) throw new ApiError("Request body too large", 413);
  try {
    const text = await req.text();
    if (text.length > MAX_BODY) throw new ApiError("Request body too large", 413);
    return JSON.parse(text) as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError("Body must be JSON");
  }
}
