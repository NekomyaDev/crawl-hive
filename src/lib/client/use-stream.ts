"use client";
// Подписка на SSE-поток /api/stream. Одно соединение на вкладку, раздаётся всем подписчикам.
import { useEffect, useRef } from "react";
import type { CrawlerStatus, Listing, PublicCrawler, Signal } from "../types";

export type ClientStreamEvent =
  | { type: "signal"; signal: Signal }
  | { type: "spawn"; crawler: PublicCrawler }
  | { type: "status"; id: string; status: CrawlerStatus }
  | { type: "trade"; listing: Listing; buyer: string }
  | { type: "ping" };

type Listener = (e: ClientStreamEvent) => void;
const listeners = new Set<Listener>();
let source: EventSource | null = null;

function ensureSource() {
  if (source || typeof window === "undefined") return;
  source = new EventSource("/api/stream");
  source.onmessage = (m) => {
    try {
      const e = JSON.parse(m.data) as ClientStreamEvent;
      listeners.forEach((l) => l(e));
    } catch {}
  };
}

export function useStream(fn: Listener) {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => {
    ensureSource();
    const l: Listener = (e) => ref.current(e);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
}
