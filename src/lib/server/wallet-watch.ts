// Wallet tracker на вебхуках Helius. Один вебхук на весь сервер: в нём список всех кошельков, за которыми следят
// живые on-chain краулеры (лента «wallets»). Helius сам присылает их свопы на /api/helius/webhook (с секретом в
// заголовке) — опрашивать кошельки не нужно, на событие уходит один кредит. Свопы ложатся в очередь по кошельку,
// краулеры-наблюдатели просыпаются сразу, и их обычный обход превращает сделки в сигналы через общий конвейер
// (дедупликация, Jev, проверка безопасности токена, Telegram).
import "server-only";
import { watchedWallets, wakeWalletWatchers } from "./store";

export interface WalletTrade {
  wallet: string;
  side: "buy" | "sell";
  mint: string;
  sol: number | null; // сколько SOL ушло или пришло, если видно
  signature: string;
  at: number;
}

const QUOTE = new Set([
  "So11111111111111111111111111111111111111112", // wSOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
]);
const KEEP_MS = 6 * 3600_000;
const PER_WALLET = 50;

interface WatchState {
  trades: Map<string, WalletTrade[]>;
  hook?: { id: string; addrs: string };
  started: boolean;
}
const g = globalThis as unknown as { __crawlhiveWallets?: WatchState };
const st = (): WatchState => (g.__crawlhiveWallets ??= { trades: new Map<string, WalletTrade[]>(), started: false });

const heliusKey = () => process.env.HELIUS_API_KEY?.trim() || process.env.SOLANA_RPC_FALLBACK?.match(/api-key=([0-9a-f-]{20,})/i)?.[1] || "";
export const webhookSecret = () => process.env.HELIUS_WEBHOOK_SECRET?.trim() || "";
const siteUrl = () => (process.env.PUBLIC_SITE_URL?.trim() || "https://crawlhive.xyz").replace(/\/$/, "");

interface HeliusTx {
  signature?: string;
  timestamp?: number;
  type?: string;
  tokenTransfers?: { fromUserAccount?: string; toUserAccount?: string; mint?: string; tokenAmount?: number }[];
  nativeTransfers?: { fromUserAccount?: string; toUserAccount?: string; amount?: number }[];
}

// Из «расширенной» транзакции Helius — сделки отслеживаемых кошельков: получил мем-токен — купил, отдал — продал.
export function ingestHelius(body: unknown) {
  const txs = (Array.isArray(body) ? body : [body]) as HeliusTx[];
  const watched = watchedWallets();
  const s = st();
  let added = 0;
  const woke = new Set<string>();
  for (const tx of txs) {
    if (!tx?.signature) continue;
    const at = (tx.timestamp ?? Date.now() / 1000) * 1000;
    const wallets = new Set([...(tx.tokenTransfers ?? []).flatMap((t) => [t.fromUserAccount, t.toUserAccount]), ...(tx.nativeTransfers ?? []).flatMap((t) => [t.fromUserAccount, t.toUserAccount])].filter((w): w is string => !!w && watched.has(w)));
    for (const w of wallets) {
      const sol = (tx.nativeTransfers ?? []).reduce((a, t) => a + (t.fromUserAccount === w ? -(t.amount ?? 0) : 0) + (t.toUserAccount === w ? t.amount ?? 0 : 0), 0) / 1e9;
      for (const t of tx.tokenTransfers ?? []) {
        if (!t.mint || QUOTE.has(t.mint)) continue;
        const side = t.toUserAccount === w ? "buy" : t.fromUserAccount === w ? "sell" : null;
        if (!side) continue;
        const list = (s.trades.get(w) ?? []).filter((x) => Date.now() - x.at < KEEP_MS && !(x.signature === tx.signature && x.mint === t.mint));
        list.push({ wallet: w, side, mint: t.mint, sol: sol ? Math.abs(Math.round(sol * 1000) / 1000) : null, signature: tx.signature, at });
        s.trades.set(w, list.slice(-PER_WALLET));
        added++;
        woke.add(w);
      }
    }
  }
  for (const w of woke) wakeWalletWatchers(w);
  return { added, wallets: woke.size };
}

// Сделки кошелька новее метки (курсор краулера).
export const tradesSince = (wallet: string, since: number) => (st().trades.get(wallet) ?? []).filter((t) => t.at > since);

// Список адресов вебхука = все отслеживаемые кошельки. Меняется — обновляем вебхук; пусто — удаляем его.
async function syncWebhook() {
  const key = heliusKey();
  const secret = webhookSecret();
  if (!key || !secret) return;
  const s = st();
  const addrs = [...watchedWallets()].sort();
  const sig = addrs.join(",");
  if (s.hook && s.hook.addrs === sig) return;
  const api = (path: string, init?: RequestInit) =>
    fetch(`https://api.helius.xyz/v0/webhooks${path}?api-key=${key}`, { ...init, headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(15_000) });
  const url = `${siteUrl()}/api/helius/webhook`;
  // Ищем свой вебхук среди существующих (после рестарта сервера id в памяти нет).
  if (!s.hook) {
    const list = (await (await api("")).json().catch(() => [])) as { webhookID: string; webhookURL: string }[];
    const mine = Array.isArray(list) ? list.find((h) => h.webhookURL === url) : undefined;
    if (mine) s.hook = { id: mine.webhookID, addrs: "?" };
  }
  if (!addrs.length) {
    if (s.hook) {
      await api(`/${s.hook.id}`, { method: "DELETE" }).catch(() => null);
      console.log("[wallets] no wallets to watch, webhook removed");
    }
    s.hook = undefined;
    return;
  }
  const body = JSON.stringify({ webhookURL: url, transactionTypes: ["SWAP"], accountAddresses: addrs, webhookType: "enhanced", authHeader: secret });
  const r = s.hook ? await api(`/${s.hook.id}`, { method: "PUT", body }) : await api("", { method: "POST", body });
  if (!r.ok) {
    console.warn("[wallets] webhook sync failed", r.status, (await r.text().catch(() => "")).slice(0, 200));
    return;
  }
  const j = (await r.json().catch(() => ({}))) as { webhookID?: string };
  s.hook = { id: j.webhookID ?? s.hook?.id ?? "", addrs: sig };
  console.log(`[wallets] webhook watches ${addrs.length} wallet${addrs.length > 1 ? "s" : ""}`);
}

export function startWalletWatch() {
  const s = st();
  if (s.started) return;
  s.started = true;
  if (!heliusKey() || !webhookSecret()) {
    console.log("[wallets] wallet tracker off: set HELIUS_API_KEY (or a Helius SOLANA_RPC_FALLBACK) and HELIUS_WEBHOOK_SECRET");
    return;
  }
  setTimeout(() => syncWebhook().catch((e) => console.warn("[wallets]", (e as Error).message)), 30_000);
  setInterval(() => syncWebhook().catch((e) => console.warn("[wallets]", (e as Error).message)), 2 * 60_000);
}
