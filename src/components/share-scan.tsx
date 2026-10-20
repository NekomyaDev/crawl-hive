"use client";
// Большой блок «поделиться сканом»: превью брендированной карточки (та же картинка, что развернётся в X и Telegram)
// и яркие кнопки X, Telegram и «скопировать ссылку». Ссылка ведёт на /scan/<адрес>, у неё своё превью.
import { useState } from "react";
import { Check, Link2, Send } from "lucide-react";
import { scanPath, xIntent } from "@/lib/scan-share";
import { cn } from "@/lib/utils";

export function ShareScan({ id, text, className }: { id: string; text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState(true);
  const url = () => `${window.location.origin}${scanPath(id)}`;
  const copy = () =>
    navigator.clipboard?.writeText(url()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  return (
    <div className={cn("overflow-hidden rounded-2xl border-2 border-honey/50 bg-gradient-to-br from-honey/[0.12] via-panel to-pink/[0.12] p-4 shadow-[0_0_40px_rgba(255,176,32,0.15)]", className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`${scanPath(id)}/opengraph-image`}
            alt="The card your post will show"
            onError={() => setPreview(false)}
            className="w-full rounded-xl border border-line shadow-lg sm:w-56"
            loading="lazy"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-lg font-black">📣 Share this scan</div>
          <p className="mt-0.5 text-sm text-muted">Your post shows this card: verdict, red flags, who holds it and the Larpcheck second opinion. Warn your friends before they ape.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => window.open(xIntent(text, url()), "_blank", "noopener,noreferrer")}
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-honey via-coral to-pink px-5 text-base font-black text-black shadow-[0_0_24px_rgba(255,120,60,0.45)] transition-transform hover:scale-[1.03]"
            >
              <span className="text-lg leading-none">𝕏</span> Share on X
            </button>
            <button
              type="button"
              onClick={() => window.open(`https://t.me/share/url?url=${encodeURIComponent(url())}&text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer")}
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#229ED9] px-4 text-sm font-bold text-white transition-transform hover:scale-[1.03]"
            >
              <Send className="size-4" /> Telegram
            </button>
            <button type="button" onClick={copy} className="inline-flex h-11 items-center gap-2 rounded-xl border border-line bg-panel px-4 text-sm font-semibold transition-colors hover:bg-panel-2">
              {copied ? <Check className="size-4 text-lime" /> : <Link2 className="size-4" />} {copied ? "Copied" : "Copy link"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
