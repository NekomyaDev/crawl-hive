"use client";
// Платный скан x402 прямо из браузера через Phantom: та же транзакция, что собирает @x402/svm у агента
// (лимит и цена вычислений, TransferChecked USDC, memo с нонсом, комиссию платит фасилитатор). Кошелёк
// только подписывает; отправляет транзакцию в сеть фасилитатор, и только если скан удался.
import { phantom } from "@/components/wallet-provider";

const PUBLIC_RPC = "https://api.mainnet-beta.solana.com";

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
  const req = pr.accepts.find((a) => a.scheme === "exact" && a.network.startsWith("solana:"));
  if (!req?.extra?.feePayer) throw new Error("No Solana payment option");

  const { publicKey } = await provider.connect();
  const [{ ComputeBudgetProgram, Connection, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction }, spl] = await Promise.all([
    import("@solana/web3.js"),
    import("@solana/spl-token"),
  ]);
  const owner = new PublicKey(publicKey.toString());
  const mint = new PublicKey(req.asset);
  const conn = new Connection(PUBLIC_RPC, "confirmed");
  const mintInfo = await conn.getAccountInfo(mint);
  if (!mintInfo) throw new Error("USDC mint not found");
  const program = mintInfo.owner;
  const decimals = mintInfo.data[44];
  const source = spl.getAssociatedTokenAddressSync(mint, owner, false, program);
  const dest = spl.getAssociatedTokenAddressSync(mint, new PublicKey(req.payTo), true, program);
  const bal = await conn.getTokenAccountBalance(source).catch(() => null);
  if (!bal || BigInt(bal.value.amount) < BigInt(req.amount)) throw new Error(`This wallet needs at least ${Number(req.amount) / 10 ** decimals} USDC`);

  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: new PublicKey(req.extra.feePayer),
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 20_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
      spl.createTransferCheckedInstruction(source, mint, dest, owner, BigInt(req.amount), decimals, [], program),
      new TransactionInstruction({ programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"), keys: [], data: new TextEncoder().encode(nonce) as Buffer }),
    ],
  }).compileToV0Message();

  onStep("sign");
  let signed: { serialize(): Uint8Array };
  try {
    signed = await provider.signTransaction(new VersionedTransaction(msg));
  } catch (e) {
    const m = (e as Error).message ?? "";
    throw new Error(/reject|cancel|denied|4001/i.test(m) ? "You cancelled the payment in Phantom" : `Phantom: ${m}`);
  }

  onStep("scan");
  // Расширения (bazaar) возвращаем как есть: по ним фасилитатор заносит вызов в каталог.
  const payload = { x402Version: 2, resource: pr.resource, accepted: req, payload: { transaction: tob64(signed.serialize()) }, extensions: pr.extensions };
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
