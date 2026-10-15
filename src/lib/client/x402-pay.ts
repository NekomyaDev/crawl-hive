"use client";
// Платный скан x402 прямо из браузера через Phantom: та же транзакция, что собирает @x402/svm у агента
// (лимит и цена вычислений, TransferChecked USDC, memo с нонсом, комиссию платит фасилитатор). Кошелёк
// только подписывает; отправляет транзакцию в сеть фасилитатор, и только если скан удался.
import { phantom } from "@/components/wallet-provider";
import { api } from "./api";

interface Requirements {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: { feePayer?: string };
}
interface PaymentRequired {
  x402Version: number;
  resource: unknown;
  accepts: Requirements[];
  extensions?: Record<string, unknown>;
}

const b64json = (s: string) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0))));
const tob64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));

export type PayStep = "price" | "sign" | "scan";

export async function payAndScan(url: string, onStep: (s: PayStep) => void) {
  const provider = phantom() as (ReturnType<typeof phantom> & { signTransaction?: (tx: unknown) => Promise<{ serialize(): Uint8Array }> }) | null;
  if (!provider?.signTransaction) throw new Error("Open the site in a browser with Phantom");
  onStep("price");
  const first = await fetch(url);
  if (first.status !== 402) throw new Error(first.ok ? "This endpoint did not ask for payment" : `Server answered ${first.status}`);
  const header = first.headers.get("PAYMENT-REQUIRED");
  if (!header) throw new Error("No PAYMENT-REQUIRED header");
  const pr = b64json(header) as PaymentRequired;

  const { publicKey } = await provider.connect();
  // Транзакцию собирает наш сервер: публичный RPC Solana не отвечает запросам из браузера.
  const built = await api<{ transaction: string; accepted: Requirements }>(`/api/x402/build?wallet=${publicKey.toString()}&route=${url.includes("scan-x") ? "scan-x" : "scan"}`);
  const { VersionedTransaction } = await import("@solana/web3.js");
  const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(built.transaction), (c) => c.charCodeAt(0)));

  onStep("sign");
  let signed: { serialize(): Uint8Array };
  try {
    signed = await provider.signTransaction(tx);
  } catch (e) {
    const m = (e as Error).message ?? "";
    throw new Error(/reject|cancel|denied|4001/i.test(m) ? "You cancelled the payment in Phantom" : `Phantom: ${m}`);
  }

  onStep("scan");
  // Расширения (bazaar) возвращаем как есть: по ним фасилитатор заносит вызов в каталог.
  const payload = { x402Version: 2, resource: pr.resource, accepted: built.accepted, payload: { transaction: tob64(signed.serialize()) }, extensions: pr.extensions };
  const res = await fetch(url, { headers: { "PAYMENT-SIGNATURE": tob64(new TextEncoder().encode(JSON.stringify(payload))) } });
  const body = await res.json().catch(() => null);
  const resp = res.headers.get("PAYMENT-RESPONSE");
  const settle = resp ? (b64json(resp) as { transaction?: string; success?: boolean }) : null;
  if (!res.ok) {
    const again = res.headers.get("PAYMENT-REQUIRED");
    throw new Error(body?.error ?? (again ? (b64json(again) as { error?: string }).error : null) ?? `Server answered ${res.status}`);
  }
  return { result: body, tx: settle?.transaction ?? null };
}
