"use client";
// On-chain оплата с клиента: сервер собирает транзакцию, Phantom подписывает и отправляет, сервер проверяет.
// Так идут спавн и продление краулера.
import { post } from "./api";
import { phantom } from "@/components/wallet-provider";
import type { PublicCrawler } from "../types";
import type { SpawnPayload } from "./spawn-types";

export type BurnStep = "prepare" | "sign" | "confirm";

async function payWithPhantom<T>(intentUrl: string, payload: unknown, confirmUrl: string, onStep: (s: BurnStep) => void): Promise<T> {
  const provider = phantom();
  if (!provider) throw new Error("Phantom is required to pay on-chain");

  onStep("prepare");
  const intent = await post<{ intentId: string; transaction: string }>(intentUrl, payload);

  onStep("sign");
  // web3.js тяжёлый, грузим его только в момент оплаты.
  const { Transaction } = await import("@solana/web3.js");
  const bytes = Uint8Array.from(atob(intent.transaction), (c) => c.charCodeAt(0));
  let signature: string;
  try {
    ({ signature } = await provider.signAndSendTransaction(Transaction.from(bytes)));
  } catch (e) {
    const msg = (e as Error).message ?? "";
    throw new Error(/reject|cancel|denied/i.test(msg) ? "You cancelled the transaction in Phantom" : `Phantom: ${msg}`);
  }

  onStep("confirm");
  return post<T>(confirmUrl, { intentId: intent.intentId, signature });
}

export function spawnWithBurn(payload: SpawnPayload, onStep: (s: BurnStep) => void): Promise<PublicCrawler> {
  return payWithPhantom("/api/spawn/intent", payload, "/api/spawn/confirm", onStep);
}

export function renewWithPayment(crawlerId: string, onStep: (s: BurnStep) => void): Promise<PublicCrawler> {
  return payWithPhantom(`/api/crawlers/${crawlerId}/renew`, {}, `/api/crawlers/${crawlerId}/renew/confirm`, onStep);
}
