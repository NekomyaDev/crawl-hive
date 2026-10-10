import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Source } from "./types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fmt(n: number, digits = 0): string {
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M`;
  if (Math.abs(n) >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function short(a: string) {
  return a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "";
}

export function timeAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function timeLeft(ts: number): string {
  const s = Math.max(0, Math.round((ts - Date.now()) / 1000));
  if (s === 0) return "ended";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h left`;
  if (h) return `${h}h ${m}m left`;
  return `${m}m ${s % 60}s left`;
}

export const SOURCE_META: Record<Source, { label: string; color: string; tw: string }> = {
  x: { label: "X", color: "#5eead4", tw: "text-teal" },
  telegram: { label: "Telegram", color: "#60a5fa", tw: "text-sky" },
  onchain: { label: "On-chain", color: "#ffb020", tw: "text-honey" },
  docs: { label: "Docs", color: "#c084fc", tw: "text-violet" },
};

export const NARRATIVE_LABEL: Record<string, string> = {
  ai: "AI",
  dogs: "Dogs",
  cats: "Cats",
  politifi: "PolitiFi",
  gaming: "Gaming",
  rwa: "RWA",
  depin: "DePIN",
  celeb: "Celeb",
};
