"use client";
// Кошелёк и вход. Phantom, если установлен. Демо-кошелёк (настоящая локальная пара ключей ed25519,
// чтобы демо тоже могло подписывать) создаётся только без on-chain оплаты, то есть в локальной разработке:
// на проде без Phantom показываем, как его поставить или открыть сайт в приложении Phantom. После подключения кошелёк подписывает сообщение (не транзакцию),
// сервер выдаёт токен сессии, и дальше все запросы идут от имени подписанного кошелька.
// Кошелёк EVM (MetaMask, Rabby) — для Robinhood Chain: входит через personal_sign и платит в ETH.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { ed25519 } from "@noble/curves/ed25519";
import { api, post, setApiSession } from "@/lib/client/api";
import type { WalletInfo } from "@/lib/types";

type Mode = "phantom" | "evm" | "demo";
export type WalletKind = "phantom" | "evm";

interface WalletCtx {
  address: string;
  mode: Mode | null;
  signedIn: boolean;
  info: WalletInfo | null;
  connect: (kind?: WalletKind) => Promise<void>;
  signIn: () => Promise<void>;
  disconnect: () => void;
  refresh: () => Promise<void>;
  // Подписать произвольное сообщение подключённым кошельком (свежая подпись для опасных действий, например выдачи ключа).
  signMessage: (msg: Uint8Array) => Promise<Uint8Array>;
  hasPhantom: boolean;
}

const Ctx = createContext<WalletCtx | null>(null);

export interface PhantomProvider {
  isPhantom?: boolean;
  signAndSendTransaction: (tx: unknown) => Promise<{ signature: string }>;
  signTransaction?: <T>(tx: T) => Promise<T>;
  signMessage: (msg: Uint8Array, display?: "utf8" | "hex") => Promise<{ signature: Uint8Array }>;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toString(): string } }>;
  disconnect: () => Promise<void>;
}

// EIP-1193: MetaMask, Rabby и другие кошельки EVM, встроенные в браузер.
export interface EvmProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

export function evmProvider(): EvmProvider | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { ethereum?: EvmProvider }).ethereum ?? null;
}

export function phantom(): PhantomProvider | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { phantom?: { solana?: PhantomProvider } };
  return w.phantom?.solana?.isPhantom ? w.phantom.solana : null;
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: Uint8Array) {
  let n = BigInt("0x" + (Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("") || "0"));
  let out = "";
  while (n > BigInt(0)) {
    out = B58[Number(n % BigInt(58))] + out;
    n /= BigInt(58);
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}
const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const fromHex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

interface Saved {
  address: string;
  mode: Mode;
  token?: string;
  seed?: string; // только у демо-кошелька: hex секретного ключа, живёт лишь в этом браузере
}

const KEY = "crawlhive.wallet.v2";

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function save(v: Saved | null) {
  try {
    if (v) localStorage.setItem(KEY, JSON.stringify(v));
    else localStorage.removeItem(KEY);
    localStorage.removeItem("crawlhive.wallet"); // старый формат без подписи
  } catch {}
}

function tokenValid(token?: string) {
  if (!token) return false;
  try {
    const { exp } = JSON.parse(atob(token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/")));
    return exp > Date.now() + 60_000;
  } catch {
    return false;
  }
}

async function requestToken(address: string, signer: (msg: Uint8Array) => Promise<Uint8Array>) {
  const n = await api<{ nonce: string; issuedAt: string; message: string }>(`/api/auth/nonce?address=${address}`);
  const signature = await signer(new TextEncoder().encode(n.message));
  const { token } = await post<{ token: string }>("/api/auth/verify", {
    address,
    nonce: n.nonce,
    issuedAt: n.issuedAt,
    signature: toB64(signature),
  });
  return token;
}

// Чем подписывать сообщения: демо-ключом, EVM-кошельком (personal_sign) или Phantom.
function signerFor(v: Saved): (m: Uint8Array) => Promise<Uint8Array> {
  return v.mode === "demo" && v.seed
        ? async (m: Uint8Array) => ed25519.sign(m, fromHex(v.seed!))
        : v.mode === "evm"
          ? async (m: Uint8Array) => {
              const p = evmProvider();
              if (!p) throw new Error("No EVM wallet found");
              const sig = (await p.request({ method: "personal_sign", params: [`0x${toHex(m)}`, v.address] })) as string;
              return fromHex(sig.replace(/^0x/, ""));
            }
          : async (m: Uint8Array) => {
            const p = phantom();
            if (!p) throw new Error("Phantom not found");
            return (await p.signMessage(m, "utf8")).signature;
          };
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [saved, setSaved] = useState<Saved | null>(null);
  const [info, setInfo] = useState<WalletInfo | null>(null);
  const [hasPhantom, setHasPhantom] = useState(false);
  const [needPhantom, setNeedPhantom] = useState(false);
  const [needEvm, setNeedEvm] = useState(false);
  const [picker, setPicker] = useState(false);
  const [ethOn, setEthOn] = useState(false);

  const apply = (v: Saved | null) => {
    setApiSession(v?.token && tokenValid(v.token) ? v.token : "");
    setSaved(v);
    save(v);
    if (!v) setInfo(null);
  };

  const signInWith = useCallback(async (v: Saved) => {
    const token = await requestToken(v.address, signerFor(v));
    apply({ ...v, token });
  }, []);

  useEffect(() => {
    setHasPhantom(!!phantom());
    api<{ eth: unknown }>("/api/config")
      .then((c) => setEthOn(!!c.eth))
      .catch(() => {});
    const v = load();
    if (!v) return;
    apply(v);
    // Демо-кошелёк, оставшийся с локальной разработки, на сервере с настоящей оплатой не нужен.
    if (v.mode === "demo")
      onchainPayments().then((on) => {
        if (on) apply(null);
      });
    // Демо-кошелёк переподписывается сам; Phantom попросит подтверждение кнопкой «Sign in».
    if (!tokenValid(v.token) && v.mode === "demo" && v.seed) signInWith(v).catch(() => {});
  }, [signInWith]);

  const address = saved?.address ?? "";
  const signedIn = !!saved && tokenValid(saved.token);

  const refresh = useCallback(async () => {
    if (!address) return;
    try {
      setInfo(await api<WalletInfo>(`/api/wallet/${address}`));
    } catch {}
  }, [address]);

  useEffect(() => {
    refresh();
    if (!address) return;
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [address, refresh]);

  const connect = async (kind?: WalletKind) => {
    // Оплата в ETH на Robinhood Chain включена — даём выбрать кошелёк.
    if (!kind && ethOn) {
      setPicker(true);
      return;
    }
    setPicker(false);
    if (kind === "evm") {
      const e = evmProvider();
      if (!e) {
        setNeedEvm(true);
        return;
      }
      try {
        const [acc] = (await e.request({ method: "eth_requestAccounts" })) as string[];
        const v: Saved = { address: acc.toLowerCase(), mode: "evm" };
        apply(v);
        await signInWith(v);
      } catch {
        // отказался — кошелёк остаётся подключённым, «Sign in» предложит ещё раз
      }
      return;
    }
    const p = phantom();
    if (p) {
      try {
        const res = await p.connect();
        const v: Saved = { address: res.publicKey.toString(), mode: "phantom" };
        apply(v);
        await signInWith(v);
      } catch {
        // отказался подписывать — кошелёк остаётся подключённым, кнопка «Sign in» предложит ещё раз
      }
      return;
    }
    if (await onchainPayments()) {
      setNeedPhantom(true);
      return;
    }
    const seed = ed25519.utils.randomPrivateKey();
    const v: Saved = { address: base58(ed25519.getPublicKey(seed)), mode: "demo", seed: toHex(seed) };
    apply(v);
    await signInWith(v).catch(() => {});
  };

  const signIn = async () => {
    if (saved) await signInWith(saved);
  };

  const signMessage = async (m: Uint8Array) => {
    if (!saved) throw new Error("Connect a wallet first");
    return signerFor(saved)(m);
  };

  const disconnect = () => {
    if (saved?.mode === "phantom") phantom()?.disconnect().catch(() => {});
    apply(null);
  };

  return (
    <Ctx.Provider value={{ address, mode: saved?.mode ?? null, signedIn, info, connect, signIn, disconnect, refresh, signMessage, hasPhantom }}>
      {children}
      {needPhantom && <PhantomPrompt onClose={() => setNeedPhantom(false)} />}
      {needEvm && <EvmPrompt onClose={() => setNeedEvm(false)} />}
      {picker && <WalletPicker onPick={connect} onClose={() => setPicker(false)} />}
    </Ctx.Provider>
  );
}

async function onchainPayments(): Promise<boolean> {
  try {
    return (await api<{ payment: string }>("/api/config")).payment !== "simulated";
  } catch {
    return true; // не знаем — не создаём кошелёк, который не сможет платить
  }
}

// Phantom не найден. На телефоне сайт можно открыть во встроенном браузере Phantom (deep link),
// на компьютере — поставить расширение.
function PhantomPrompt({ onClose }: { onClose: () => void }) {
  const mobile = typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const here = typeof window !== "undefined" ? window.location.href : "";
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const deepLink = `https://phantom.app/ul/browse/${encodeURIComponent(here)}?ref=${encodeURIComponent(origin)}`;
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-sm rounded-xl border border-line bg-panel p-5" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-3 right-3 text-muted hover:text-fg" aria-label="Close">
          <X className="size-4" />
        </button>
        <div className="mb-1 font-semibold">Phantom wallet needed</div>
        <p className="mb-4 text-sm text-muted">
          CrawlHive takes real on-chain payments, so it works with the Phantom wallet. Signing in is free and sends no transaction.
        </p>
        <div className="flex flex-col gap-2">
          {mobile && (
            <a href={deepLink} className="rounded-lg bg-honey px-4 py-2 text-center text-sm font-semibold text-black">
              Open in Phantom app
            </a>
          )}
          <a
            href="https://phantom.com/download"
            target="_blank"
            rel="noreferrer"
            className={mobile ? "rounded-lg border border-line px-4 py-2 text-center text-sm" : "rounded-lg bg-honey px-4 py-2 text-center text-sm font-semibold text-black"}
          >
            Install Phantom
          </a>
          {!mobile && <p className="text-center text-xs text-muted">Already installed? Reload the page after enabling the extension.</p>}
        </div>
      </div>
    </div>
  );
}

// Выбор кошелька: Phantom на Solana (оплата в SOL) или EVM-кошелёк на Robinhood Chain (оплата в ETH).
function WalletPicker({ onPick, onClose }: { onPick: (k: WalletKind) => void; onClose: () => void }) {
  const opts: { kind: WalletKind; title: string; text: string; dot: string }[] = [
    { kind: "phantom", title: "Phantom", text: "Solana · pay in SOL", dot: "bg-violet" },
    { kind: "evm", title: "MetaMask, Rabby or any EVM wallet", text: "Robinhood Chain · pay in ETH", dot: "bg-lime" },
  ];
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-sm rounded-xl border border-line bg-panel p-5" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-3 right-3 text-muted hover:text-fg" aria-label="Close">
          <X className="size-4" />
        </button>
        <div className="mb-1 font-semibold">Connect a wallet</div>
        <p className="mb-4 text-sm text-muted">Signing in is a free message, not a transaction. You pay only when you spawn or renew a crawler.</p>
        <div className="flex flex-col gap-2">
          {opts.map((o) => (
            <button
              key={o.kind}
              type="button"
              onClick={() => onPick(o.kind)}
              className="flex items-center gap-3 rounded-lg border border-line px-4 py-3 text-left transition hover:border-honey/60 hover:bg-panel-2"
            >
              <span className={`size-2.5 shrink-0 rounded-full ${o.dot}`} />
              <span>
                <span className="block text-sm font-semibold">{o.title}</span>
                <span className="block text-xs text-muted">{o.text}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Кошелька EVM в браузере нет: на телефоне открываем сайт в MetaMask, на компьютере предлагаем поставить.
function EvmPrompt({ onClose }: { onClose: () => void }) {
  const mobile = typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const here = typeof window !== "undefined" ? window.location.href.replace(/^https?:\/\//, "") : "";
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-sm rounded-xl border border-line bg-panel p-5" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-3 right-3 text-muted hover:text-fg" aria-label="Close">
          <X className="size-4" />
        </button>
        <div className="mb-1 font-semibold">EVM wallet needed</div>
        <p className="mb-4 text-sm text-muted">To pay in ETH on Robinhood Chain, use MetaMask, Rabby or another EVM wallet. The site adds the network for you.</p>
        <div className="flex flex-col gap-2">
          {mobile && (
            <a href={`https://metamask.app.link/dapp/${here}`} className="rounded-lg bg-honey px-4 py-2 text-center text-sm font-semibold text-black">
              Open in MetaMask app
            </a>
          )}
          <a href="https://metamask.io/download" target="_blank" rel="noreferrer" className={mobile ? "rounded-lg border border-line px-4 py-2 text-center text-sm" : "rounded-lg bg-honey px-4 py-2 text-center text-sm font-semibold text-black"}>
            Install MetaMask
          </a>
          <a href="https://rabby.io" target="_blank" rel="noreferrer" className="rounded-lg border border-line px-4 py-2 text-center text-sm">
            Install Rabby
          </a>
        </div>
      </div>
    </div>
  );
}

export function useWallet() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet outside WalletProvider");
  return v;
}
