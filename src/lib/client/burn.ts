"use client";
// On-chain спавн с клиента: сервер собирает транзакцию, Phantom подписывает и отправляет, сервер проверяет.
import { post } from "./api";
import { phantom } from "@/components/wallet-provider";
import type { PublicCrawler } from "../types";
import type { SpawnPayload } from "./spawn-types";

export type BurnStep = "prepare" | "sign" | "confirm";

export async function spawnWithBurn(payload: SpawnPayload, onStep: (s: BurnStep) => void): Promise<PublicCrawler> {
  const provider = phantom();
  if (!provider) throw new Error("Phantom is required for an on-chain burn");

  onStep("prepare");
  const intent = await post<{ intentId: string; transaction: string }>("/api/spawn/intent", payload);

  onStep("sign");
  // web3.js тяжёлый, грузим его только в момент спавна.
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
  return post<PublicCrawler>("/api/spawn/confirm", { intentId: intent.intentId, signature });
}
