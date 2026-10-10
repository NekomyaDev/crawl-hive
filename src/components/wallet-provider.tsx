"use client";
// Кошелёк и вход. Phantom, если установлен, иначе демо-кошелёк — настоящая локальная пара ключей ed25519,
// чтобы демо тоже могло подписывать. После подключения кошелёк подписывает сообщение (не транзакцию),
// сервер выдаёт токен сессии, и дальше все запросы идут от имени подписанного кошелька.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ed25519 } from "@noble/curves/ed25519";
import { api, post, setApiSession } from "@/lib/client/api";
import type { WalletInfo } from "@/lib/types";

type Mode = "phantom" | "demo";

interface WalletCtx {
  address: string;
  mode: Mode | null;
  signedIn: boolean;
  info: WalletInfo | null;
  connect: () => Promise<void>;
  signIn: () => Promise<void>;
  disconnect: () => void;
  refresh: () => Promise<void>;
  hasPhantom: boolean;
}

const Ctx = createContext<WalletCtx | null>(null);

export interface PhantomProvider {
  isPhantom?: boolean;
  signAndSendTransaction: (tx: unknown) => Promise<{ signature: string }>;
  signMessage: (msg: Uint8Array, display?: "utf8" | "hex") => Promise<{ signature: Uint8Array }>;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toString(): string } }>;
  disconnect: () => Promise<void>;
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

export function WalletProvider({ children }: { children: ReactNode }) {
  const [saved, setSaved] = useState<Saved | null>(null);
  const [info, setInfo] = useState<WalletInfo | null>(null);
  const [hasPhantom, setHasPhantom] = useState(false);

  const apply = (v: Saved | null) => {
    setApiSession(v?.token && tokenValid(v.token) ? v.token : "");
    setSaved(v);
    save(v);
    if (!v) setInfo(null);
  };

  const signInWith = useCallback(async (v: Saved) => {
    const signer =
      v.mode === "demo" && v.seed
        ? async (m: Uint8Array) => ed25519.sign(m, fromHex(v.seed!))
        : async (m: Uint8Array) => {
            const p = phantom();
            if (!p) throw new Error("Phantom not found");
            return (await p.signMessage(m, "utf8")).signature;
          };
    const token = await requestToken(v.address, signer);
    apply({ ...v, token });
  }, []);

  useEffect(() => {
    setHasPhantom(!!phantom());
    const v = load();
    if (!v) return;
    apply(v);
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

  const connect = async () => {
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
    const seed = ed25519.utils.randomPrivateKey();
    const v: Saved = { address: base58(ed25519.getPublicKey(seed)), mode: "demo", seed: toHex(seed) };
    apply(v);
    await signInWith(v).catch(() => {});
  };

  const signIn = async () => {
    if (saved) await signInWith(saved);
  };

  const disconnect = () => {
    phantom()?.disconnect().catch(() => {});
    apply(null);
  };

  return (
    <Ctx.Provider value={{ address, mode: saved?.mode ?? null, signedIn, info, connect, signIn, disconnect, refresh, hasPhantom }}>
      {children}
    </Ctx.Provider>
  );
}

export function useWallet() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet outside WalletProvider");
  return v;
}
