"use client";
// Кошелёк: Phantom, если установлен, иначе демо-адрес в localStorage.
// В MVP сжигание симулируется на сервере; подпись транзакции burn — следующий шаг (см. README).
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, setApiWallet } from "@/lib/client/api";
import type { WalletInfo } from "@/lib/types";

type Mode = "phantom" | "demo";

interface WalletCtx {
  address: string;
  mode: Mode | null;
  info: WalletInfo | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  refresh: () => Promise<void>;
  hasPhantom: boolean;
}

const Ctx = createContext<WalletCtx | null>(null);

interface PhantomProvider {
  isPhantom?: boolean;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toString(): string } }>;
  disconnect: () => Promise<void>;
}

function phantom(): PhantomProvider | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { phantom?: { solana?: PhantomProvider } };
  return w.phantom?.solana?.isPhantom ? w.phantom.solana : null;
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function demoAddress() {
  const bytes = crypto.getRandomValues(new Uint8Array(44));
  return Array.from(bytes, (b) => B58[b % B58.length]).join("");
}

const KEY = "crawlhive.wallet";

function load(): { address: string; mode: Mode } | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function save(v: { address: string; mode: Mode } | null) {
  try {
    if (v) localStorage.setItem(KEY, JSON.stringify(v));
    else localStorage.removeItem(KEY);
  } catch {}
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState("");
  const [mode, setMode] = useState<Mode | null>(null);
  const [info, setInfo] = useState<WalletInfo | null>(null);
  const [hasPhantom, setHasPhantom] = useState(false);

  const apply = (addr: string, m: Mode | null) => {
    setApiWallet(addr);
    setAddress(addr);
    setMode(m);
    if (!addr) setInfo(null);
  };

  useEffect(() => {
    setHasPhantom(!!phantom());
    const saved = load();
    if (saved) apply(saved.address, saved.mode);
  }, []);

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
        const addr = res.publicKey.toString();
        save({ address: addr, mode: "phantom" });
        apply(addr, "phantom");
        return;
      } catch {
        // пользователь отказался — падаем в демо
      }
    }
    const addr = demoAddress();
    save({ address: addr, mode: "demo" });
    apply(addr, "demo");
  };

  const disconnect = () => {
    phantom()?.disconnect().catch(() => {});
    save(null);
    apply("", null);
  };

  return (
    <Ctx.Provider value={{ address, mode, info, connect, disconnect, refresh, hasPhantom }}>{children}</Ctx.Provider>
  );
}

export function useWallet() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet outside WalletProvider");
  return v;
}
