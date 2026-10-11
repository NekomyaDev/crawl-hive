"use client";
// On-chain оплата с клиента: сервер собирает транзакцию, кошелёк подписывает и отправляет, сервер проверяет.
// Так идут спавн и продление краулера. Phantom платит в SOL, кошелёк EVM — в ETH на Robinhood Chain.
import { post } from "./api";
import { evmProvider, phantom } from "@/components/wallet-provider";
import type { PublicCrawler } from "../types";
import type { SpawnPayload } from "./spawn-types";

export type BurnStep = "prepare" | "sign" | "confirm";

interface Intent {
  intentId: string;
  transaction?: string; // Solana: неподписанная транзакция в base64
  evm?: { chainId: number; to: string; value: string; data: string }; // Robinhood Chain: поля перевода ETH
}

const RH_CHAIN = {
  chainId: "0x1237", // 4663
  chainName: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"],
  blockExplorerUrls: ["https://robin.etherscan.io"],
};

const cancelled = (msg: string) => /reject|cancel|denied|4001/i.test(msg);

async function sendWithPhantom(intent: Intent): Promise<string> {
  const provider = phantom();
  if (!provider) throw new Error("Phantom is required to pay in SOL");
  // web3.js тяжёлый, грузим его только в момент оплаты.
  const { Transaction } = await import("@solana/web3.js");
  const bytes = Uint8Array.from(atob(intent.transaction!), (c) => c.charCodeAt(0));
  try {
    return (await provider.signAndSendTransaction(Transaction.from(bytes))).signature;
  } catch (e) {
    const msg = (e as Error).message ?? "";
    throw new Error(cancelled(msg) ? "You cancelled the transaction in Phantom" : `Phantom: ${msg}`);
  }
}

// Переключаем кошелёк на Robinhood Chain (добавляем сеть, если её там нет) и отправляем перевод ETH.
async function sendWithEvm(intent: Intent): Promise<string> {
  const p = evmProvider();
  if (!p) throw new Error("An EVM wallet (MetaMask, Rabby) is required to pay in ETH");
  const tx = intent.evm!;
  try {
    const [from] = (await p.request({ method: "eth_requestAccounts" })) as string[];
    try {
      await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: RH_CHAIN.chainId }] });
    } catch (e) {
      const code = (e as { code?: number }).code;
      if (code === 4001) throw e;
      await p.request({ method: "wallet_addEthereumChain", params: [RH_CHAIN] });
    }
    return (await p.request({ method: "eth_sendTransaction", params: [{ from, to: tx.to, value: tx.value, data: tx.data }] })) as string;
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    throw new Error(cancelled(msg) || (e as { code?: number }).code === 4001 ? "You cancelled the transaction in your wallet" : `Wallet: ${msg}`);
  }
}

async function payOnchain<T>(intentUrl: string, payload: unknown, confirmUrl: string, onStep: (s: BurnStep) => void): Promise<T> {
  onStep("prepare");
  const intent = await post<Intent>(intentUrl, payload);

  onStep("sign");
  const signature = intent.evm ? await sendWithEvm(intent) : await sendWithPhantom(intent);

  onStep("confirm");
  return post<T>(confirmUrl, { intentId: intent.intentId, signature });
}

export function spawnWithBurn(payload: SpawnPayload, onStep: (s: BurnStep) => void): Promise<PublicCrawler> {
  return payOnchain("/api/spawn/intent", payload, "/api/spawn/confirm", onStep);
}

export function renewWithPayment(crawlerId: string, onStep: (s: BurnStep) => void): Promise<PublicCrawler> {
  return payOnchain(`/api/crawlers/${crawlerId}/renew`, {}, `/api/crawlers/${crawlerId}/renew/confirm`, onStep);
}
