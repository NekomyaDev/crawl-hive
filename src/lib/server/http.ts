// Обёртки для route handlers: достаём кошелёк из заголовка и превращаем ошибки в JSON.
import "server-only";
import { connection } from "next/server";
import { ApiError } from "./store";

const ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function walletFrom(req: Request, required = true): string {
  const w = req.headers.get("x-wallet")?.trim() ?? "";
  if (!w) {
    if (required) throw new ApiError("Connect a wallet first", 401);
    return "";
  }
  if (!ADDRESS_RE.test(w)) throw new ApiError("Bad wallet address", 400);
  return w;
}

export function isAddress(a: string) {
  return ADDRESS_RE.test(a);
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
