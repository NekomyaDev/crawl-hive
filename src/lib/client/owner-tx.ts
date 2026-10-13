"use client";
// Транзакции владельца проекта (байбек, сжигание остатка, выплата победителю дня): сервер собирает,
// Phantom подписывает и отправляет, сервер проверяет в сети. Ключ казны живёт только в Phantom.
import { post } from "./api";
import { phantom } from "@/components/wallet-provider";

export type OwnerStep = "prepare" | "sign" | "confirm";

const cancelled = (msg: string) => /reject|cancel|denied|4001/i.test(msg);

// Байбек собирается как v0-транзакция (таблицы адресов Jupiter), выплата — как обычная.
async function signAndSend(b64: string): Promise<string> {
  const provider = phantom();
  if (!provider) throw new Error("Open the site in a browser with Phantom");
  // web3.js тяжёлый, грузим его только в момент подписи.
  const { Transaction, VersionedTransaction } = await import("@solana/web3.js");
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  let tx: unknown;
  try {
    tx = VersionedTransaction.deserialize(bytes);
  } catch {
    tx = Transaction.from(bytes);
  }
  try {
    return (await provider.signAndSendTransaction(tx)).signature;
  } catch (e) {
    const msg = (e as Error).message ?? "";
    throw new Error(cancelled(msg) ? "You cancelled the transaction in Phantom" : `Phantom: ${msg}`);
  }
}

export async function runOwnerTx<B extends { transaction: string }, R>(
  buildUrl: string,
  payload: unknown,
  confirmUrl: string,
  confirmExtra: Record<string, unknown>,
  onStep: (s: OwnerStep, built?: B, signature?: string) => void,
): Promise<{ built: B; result: R }> {
  onStep("prepare");
  const built = await post<B>(buildUrl, payload);
  onStep("sign", built);
  const signature = await signAndSend(built.transaction);
  onStep("confirm", built, signature); // подпись нужна, чтобы повторить проверку, если RPC отстаёт
  const result = await post<R>(confirmUrl, { ...confirmExtra, signature });
  return { built, result };
}
