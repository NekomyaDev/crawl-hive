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

export async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiError("Body must be JSON");
  }
}
