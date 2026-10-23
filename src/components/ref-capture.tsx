"use client";
// Рефералка на сайте: ?ref=<код> с любой страницы запоминаем в localStorage (первое касание побеждает),
// а после входа подписью один раз отправляем на /api/ref/claim. Сервер сам решает, засчитать ли (новый кошелёк, не сам себе).
// Ничего не рисует. Date.now() только в эффектах, не при рендере (пререндер с cacheComponents).
import { useEffect } from "react";
import { post } from "@/lib/client/api";
import { useWallet } from "./wallet-provider";

const KEY = "crawlhive.ref";
const TTL_MS = 30 * 86400_000;

function read(): { code: string; at: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return v && typeof v.code === "string" && Date.now() - Number(v.at) < TTL_MS ? v : null;
  } catch {
    return null;
  }
}

export function RefCapture() {
  const { signedIn, address } = useWallet();

  useEffect(() => {
    try {
      const code = new URLSearchParams(window.location.search).get("ref")?.trim().toLowerCase();
      if (code && /^[a-z0-9]{6,16}$/.test(code) && !read()) localStorage.setItem(KEY, JSON.stringify({ code, at: Date.now() }));
    } catch {}
  }, []);

  useEffect(() => {
    if (!signedIn || !address) return;
    const saved = read();
    if (!saved) return;
    post<{ ok: boolean }>("/api/ref/claim", { code: saved.code })
      .then(() => {
        try {
          localStorage.removeItem(KEY);
        } catch {}
      })
      .catch((e: Error) => {
        // Сеть или сервер недоступны: попробуем при следующем входе. Ответ по правилам (4xx) уже окончательный.
        if (!/HTTP 5|unavailable|Failed to fetch|Too many/i.test(e.message))
          try {
            localStorage.removeItem(KEY);
          } catch {}
      });
  }, [signedIn, address]);

  return null;
}
