// Ссылка на Telegram-бота: яркий баннер на главной (с примером ответа бота) и плавающая кнопка на телефоне.
import { Bell, Radar, ScanSearch, Target, Users } from "lucide-react";
import { cn } from "@/lib/utils";

export const BOT_URL = "https://t.me/crawlhivebot";
const TG = "#229ED9";

export function TelegramIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M21.94 4.3a1.2 1.2 0 0 0-1.62-1.36L2.9 9.73c-1.13.45-1.12 1.06-.2 1.34l4.47 1.4 1.72 5.3c.21.58.1.81.71.81.47 0 .68-.21.94-.47l2.27-2.2 4.71 3.48c.87.48 1.49.23 1.71-.81l2.71-14.28ZM8.4 12.18l9.06-5.72c.45-.27.86-.12.52.18l-7.76 7-.3 3.22-1.52-4.68Z" />
    </svg>
  );
}

const FEATURES = [
  { icon: ScanSearch, text: "Scan any CA" },
  { icon: Bell, text: "Rug alerts" },
  { icon: Users, text: "Group autoscan" },
  { icon: Radar, text: "Launch Radar" },
  { icon: Target, text: "24h follow-up" },
];

// Пример ответа бота: показывает продукт быстрее любого текста.
function ChatMock() {
  return (
    <div className="relative w-full max-w-[300px] rounded-2xl border border-white/10 bg-[#17212b] p-3 shadow-2xl shadow-black/40">
      <div className="mb-2 flex items-center gap-2 border-b border-white/5 pb-2">
        <div className="grid size-7 place-items-center rounded-full bg-gradient-to-br from-honey to-coral text-sm">🐝</div>
        <div className="leading-tight">
          <div className="text-xs font-semibold text-white">CrawlHive</div>
          <div className="text-[10px] text-[#6c7883]">bot</div>
        </div>
      </div>
      <div className="ml-auto mb-2 w-fit max-w-[85%] rounded-xl rounded-br-sm bg-[#2b5278] px-2.5 py-1.5 font-mono text-[10px] text-white">DezXAZ8z…B263</div>
      <div className="w-[92%] rounded-xl rounded-bl-sm bg-[#182533] p-2 text-[11px] leading-snug text-[#e7edf3]">
        <div className="mb-1.5 flex h-16 items-center justify-center rounded-lg bg-gradient-to-br from-lime/25 via-teal/10 to-transparent">
          <span className="num text-2xl font-bold text-lime">100</span>
          <span className="ml-2 text-[10px] font-semibold text-lime">CLEAN</span>
        </div>
        🟢 <b>$BONK</b> · <b>100 CLEAN</b> · Solana
        <div className="text-[#8a9aa9]">liq $341k · FDV $278M · age 3y</div>
        <div>
          ⚡ Jev: <b>👀 LOOK</b> · 84% sure
        </div>
        <div className="mt-1.5 grid grid-cols-2 gap-1">
          {["🔎 Full scan", "👁 Watch", "📈 Chart", "🔄 Rescan"].map((b) => (
            <span key={b} className="rounded-md bg-white/[0.07] py-1 text-center text-[10px] text-[#64b5ef]">
              {b}
            </span>
          ))}
        </div>
      </div>
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
            live in Telegram · free
          </div>
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Scan memecoins <span style={{ color: "#5bc4f5" }}>right in Telegram</span>
          </h2>
          <p className="mt-2 text-sm text-fg/80">
            Paste a contract address, get the verdict and a ⚡ Jev take in seconds. Watch tokens for rug alerts, add the bot to your group, and 24 hours later it tells you if the verdict came true. Solana and Robinhood Chain.
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
              href={BOT_URL}
              target="_blank"
              rel="noreferrer"
              className="tg-shine group relative inline-flex items-center gap-2.5 overflow-hidden rounded-xl px-5 py-3 text-base font-semibold text-white shadow-lg transition-transform hover:-translate-y-0.5 active:translate-y-0"
              style={{ background: `linear-gradient(135deg, #2AABEE, ${TG})`, boxShadow: `0 10px 30px -8px ${TG}` }}
            >
              <TelegramIcon className="size-5" />
              Open @crawlhivebot
            </a>
            <a href={`${BOT_URL}?startgroup=scan`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-4 py-3 text-sm text-fg/90 hover:border-white/30">
              <Users className="size-4" /> Add to your group
            </a>
          </div>
        </div>
        <div className="hidden shrink-0 md:block">
          <ChatMock />
        </div>
      </div>
    </section>
  );
}

// Плавающая кнопка на телефоне: бот всегда под рукой, пока листаешь сайт.
export function TelegramFab() {
  return (
    <a
      href={BOT_URL}
      target="_blank"
      rel="noreferrer"
      aria-label="Open the CrawlHive Telegram bot"
      className="fixed bottom-4 left-4 z-40 inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold text-white shadow-xl lg:hidden"
      style={{ background: `linear-gradient(135deg, #2AABEE, ${TG})`, boxShadow: `0 8px 24px -6px ${TG}` }}
    >
      <TelegramIcon className="size-4" /> Scan in Telegram
    </a>
  );
}

