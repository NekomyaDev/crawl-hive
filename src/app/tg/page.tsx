import type { Metadata } from "next";
import Script from "next/script";
import { Suspense } from "react";
import { TgApp } from "./app";

export const metadata: Metadata = { title: "CrawlHive app", description: "Scan memecoins, watch for rugs and follow Launch Radar inside Telegram." };

// Telegram Mini App. Открывается кнопкой у @crawlhivebot; вне Telegram работает как мобильная страница.
export default function Page() {
  return (
    <>
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" />
      <Suspense fallback={<div className="grid min-h-screen place-items-center text-muted">🐝</div>}>
        <TgApp />
      </Suspense>
    </>
  );
}
