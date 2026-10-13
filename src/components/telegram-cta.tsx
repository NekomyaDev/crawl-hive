// Ссылка на приложение CrawlHive в Telegram (Mini App): яркий баннер на главной с настоящим скриншотом и плавающая кнопка на телефоне.
import { Bell, Radar, ScanSearch, Target, Users } from "lucide-react";
import { cn } from "@/lib/utils";

export const BOT_URL = "https://t.me/crawlhivebot";
// Открывает чат с ботом, и он сразу присылает кнопку «Open the app». Работает всегда, даже без Main Mini App
// в BotFather (с ним можно перейти на ?startapp — откроет приложение без чата).
export const APP_URL = "https://t.me/crawlhivebot?start=app";
const TG = "#229ED9";

export function TelegramIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M21.94 4.3a1.2 1.2 0 0 0-1.62-1.36L2.9 9.73c-1.13.45-1.12 1.06-.2 1.34l4.47 1.4 1.72 5.3c.21.58.1.81.71.81.47 0 .68-.21.94-.47l2.27-2.2 4.71 3.48c.87.48 1.49.23 1.71-.81l2.71-14.28ZM8.4 12.18l9.06-5.72c.45-.27.86-.12.52.18l-7.76 7-.3 3.22-1.52-4.68Z" />
    </svg>
  );
}

const FEATURES = [
  { icon: ScanSearch, text: "Scan any token" },
  { icon: Bell, text: "Rug alerts" },
  { icon: Users, text: "Group autoscan" },
  { icon: Radar, text: "Launch Radar" },
  { icon: Target, text: "24h follow-up" },
];

// Настоящий скриншот приложения в рамке телефона.
function PhoneMock() {
  return (
    <div className="relative w-[230px] rotate-[3deg] rounded-[34px] border-[6px] border-[#1c1f24] bg-black p-1 shadow-2xl shadow-black/50">
      <div className="absolute top-2 left-1/2 z-10 h-4 w-20 -translate-x-1/2 rounded-full bg-black" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/tg/app-scan.png" alt="The CrawlHive Telegram app: scan any memecoin" className="w-full rounded-[26px]" />
    </div>
  );
}

export function TelegramCta({ className }: { className?: string }) {
  return (
    <section
      className={cn("relative overflow-hidden rounded-2xl border p-5 sm:p-6", className)}
      style={{ borderColor: `${TG}66`, background: `linear-gradient(120deg, ${TG}2e, rgba(96,165,250,0.08) 45%, rgba(192,132,252,0.10))` }}
    >
      <div className="pointer-events-none absolute -top-24 -left-16 size-72 rounded-full blur-3xl" style={{ background: `${TG}40` }} />
      <div className="pointer-events-none absolute -right-10 -bottom-28 size-72 rounded-full bg-violet/20 blur-3xl" />
      <div className="relative flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 max-w-xl">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-medium text-white" style={{ borderColor: `${TG}80`, background: `${TG}33` }}>
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full opacity-75" style={{ background: TG }} />
              <span className="relative inline-flex size-2 rounded-full" style={{ background: TG }} />
            </span>
            new · an app inside Telegram · free
          </div>
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            CrawlHive is now <span style={{ color: "#5bc4f5" }}>an app in Telegram</span>
          </h2>
          <p className="mt-2 text-sm text-fg/80">
            Scan any token, browse Launch Radar, watch tokens for rug alerts and check your crawlers, without leaving Telegram. No install, no sign-up: one tap opens it. The bot answers contract addresses in your groups and tells you 24 hours later if the verdict came true. Solana, Robinhood Chain and BNB Chain.
          </p>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {FEATURES.map(({ icon: Icon, text }) => (
              <span key={text} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-fg/90">
                <Icon className="size-3.5" style={{ color: "#5bc4f5" }} />
                {text}
              </span>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <a
              href={APP_URL}
              target="_blank"
              rel="noreferrer"
              className="tg-shine group relative inline-flex items-center gap-2.5 overflow-hidden rounded-xl px-5 py-3 text-base font-semibold text-white shadow-lg transition-transform hover:-translate-y-0.5 active:translate-y-0"
              style={{ background: `linear-gradient(135deg, #2AABEE, ${TG})`, boxShadow: `0 10px 30px -8px ${TG}` }}
            >
              <TelegramIcon className="size-5" />
              Open the app in Telegram
            </a>
            <a href={`${BOT_URL}?startgroup=scan`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-4 py-3 text-sm text-fg/90 hover:border-white/30">
              <Users className="size-4" /> Add the bot to your group
            </a>
          </div>
        </div>
        <div className="hidden shrink-0 md:block">
          <PhoneMock />
        </div>
      </div>
    </section>
  );
}

// Плавающая кнопка на телефоне: бот всегда под рукой, пока листаешь сайт.
export function TelegramFab() {
  return (
    <a
      href={APP_URL}
      target="_blank"
      rel="noreferrer"
      data-chrome
      aria-label="Open the CrawlHive app in Telegram"
      className="fixed bottom-4 left-4 z-40 inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold text-white shadow-xl lg:hidden"
      style={{ background: `linear-gradient(135deg, #2AABEE, ${TG})`, boxShadow: `0 8px 24px -6px ${TG}` }}
    >
      <TelegramIcon className="size-4" /> Telegram app
    </a>
  );
}

