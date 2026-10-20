// Большой баннер бота в X на главной: как пользоваться @crawlhivebot и пример ответа в треде.
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function XBotBanner({ className }: { className?: string }) {
  return (
    <a
      href="https://x.com/crawlhivebot"
      target="_blank"
      rel="noreferrer"
      className={cn(
        "group relative block overflow-hidden rounded-2xl border-2 border-sky/40 bg-[#05060a] p-5 shadow-[0_0_50px_rgba(56,189,248,0.15)] transition-shadow hover:shadow-[0_0_70px_rgba(56,189,248,0.3)] lg:p-7",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(56,189,248,0.22),transparent_45%),radial-gradient(circle_at_90%_90%,rgba(167,139,250,0.25),transparent_45%)]" />
      <div className="relative grid items-center gap-6 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/bot-avatar.png" alt="" className="size-12 rounded-full ring-2 ring-sky/60" />
            <span className="rounded-full border border-sky/50 bg-sky/10 px-3 py-1 text-xs font-bold tracking-wider text-sky uppercase">New · CrawlHive on 𝕏</span>
          </div>
          <h2 className="mt-4 text-3xl leading-tight font-black tracking-tight lg:text-5xl">
            Tag <span className="text-sky">@crawlhivebot</span>.<br />Get the verdict.
          </h2>
          <p className="mt-3 max-w-lg text-fg/80">Reply to any tweet with a contract address and tag the bot. The swarm scans it and answers right in the thread: score, red flag, Larpcheck second opinion and the full scan.</p>
          <div className="mt-5 flex flex-wrap items-center gap-2 text-sm font-semibold">
            {["🔎 Find a coin on X", "💬 Tag @crawlhivebot + CA", "✅ Verdict in the thread"].map((s, i) => (
              <span key={s} className="flex items-center gap-2">
                <span className="rounded-lg border border-line bg-panel/80 px-3 py-1.5">{s}</span>
                {i < 2 && <ArrowRight className="size-4 text-sky" />}
              </span>
            ))}
          </div>
          <span className="mt-6 inline-flex h-11 items-center gap-2 rounded-xl bg-sky px-5 text-base font-black text-black transition-transform group-hover:scale-[1.03]">
            <span className="text-lg leading-none">𝕏</span> Follow @crawlhivebot
          </span>
        </div>
        <div className="space-y-2 rounded-2xl border border-white/10 bg-black/60 p-4 text-sm">
          <div className="flex gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-panel-2">🐸</span>
            <div>
              <div className="font-bold">degen <span className="font-normal text-muted">@ape_everything</span></div>
              <div>this one is going to 100x 🚀 7xKX…pump</div>
            </div>
          </div>
          <div className="flex gap-3 border-t border-white/10 pt-2">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-panel-2">🙂</span>
            <div>
              <div className="font-bold">you <span className="font-normal text-muted">@you</span></div>
              <div><span className="text-sky">@crawlhivebot</span> 7xKX…pump</div>
            </div>
          </div>
          <div className="flex gap-3 border-t border-white/10 pt-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/bot-avatar.png" alt="" className="size-9 shrink-0 rounded-full" />
            <div className="min-w-0">
              <div className="font-bold">
                CrawlHiveBot <span className="font-normal text-muted">@crawlhivebot</span>{" "}
                <span className="rounded border border-white/15 px-1 text-[10px] font-normal text-muted">Automated</span>
              </div>
              <div className="leading-relaxed">
                🔴 $PUMP: 25/100 DANGER
                <br />
                Dev funded 8 snipers holding 31%
                <br />
                Larpcheck: LIKELY LARP 22
                <br />
                <span className="text-sky">crawlhive.xyz/scan/7xKX…</span>
              </div>
            </div>
          </div>
          <div className="pt-1 text-right text-[10px] text-muted">example reply</div>
        </div>
      </div>
    </a>
  );
}
