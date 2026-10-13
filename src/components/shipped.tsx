"use client";
import { useState } from "react";
// Таймлайн выкаток: что и когда появилось. Показывает, что проект живой и двигается.
import { Rocket } from "lucide-react";

const SHIPPED: { date: string; title: string; text: string }[] = [
  { date: "Oct 13", title: "BNB Chain and Meteora", text: "Instant Crawl, the bot, the app and Launch Radar now scan BNB Chain tokens (holders, honeypot, contract owner, four.meme curve). Meteora and other launchpads on Solana get their bonding curve and creator wallet checked too." },
  { date: "Oct 13", title: "CrawlHive app in Telegram", text: "A real app inside Telegram: scan tokens, browse Launch Radar, manage your watchlist and alerts, see your crawlers and their signals. One tap from @crawlhivebot, no install." },
  { date: "Oct 13", title: "Stricter on fresh launches", text: "Track Record showed young tokens with linked or fresh wallets dumping within hours while rated OK. Such tokens are now capped at RISKY." },
  { date: "Oct 13", title: "@crawlhivebot for everyone", text: "Scan Solana and Robinhood Chain tokens in Telegram with a Jev take, watch tokens for rug alerts, get Launch Radar alerts, add the bot to groups. A day later it tells you if the verdict came true." },
  { date: "Oct 13", title: "Track Record", text: "Every verdict is checked against the real price for 24 hours: how many DANGER tokens dumped, and how many CLEAN ones dumped anyway. Hits and misses, nothing hidden." },
  { date: "Oct 13", title: "Launch Radar", text: "The swarm scans fresh launches on Solana and Robinhood Chain on its own. Everyone sees them 10 minutes later, crawler owners get them live." },
  { date: "Oct 13", title: "Any agent, one click", text: "ChatGPT Dots, Meta Muse, Claude and Cursor connect to your crawlers with a Connect button: no key to copy. Pick the bot and crawlers, approve with your wallet, disconnect any time." },
  { date: "Oct 12", title: "Jev on every signal", text: "Jev, a fast decision model, rates every crawler find in about half a second and skips pure noise. The Grok Bot's take comes from Jev when it is sure, and Grok is asked only about the doubtful ones." },
  { date: "Oct 12", title: "Safer, fairer crawlers", text: "Every token a crawler finds is scanned before it reaches you and rugs are blocked. Hits now count the best price in the window, sampled every 5 minutes." },
  { date: "Oct 12", title: "Grok Bot on duty", text: "One switch under any crawler: our Grok Bot reads every new signal, scans the token and tells you look, watch or avoid. It sleeps while nothing happens." },
  { date: "Oct 12", title: "Grok Bots", text: "Put your Grok Bot (or Claude, Cursor) on duty over one crawler, two or all of them through our MCP server. It wakes up only when your crawlers find something new." },
  { date: "Oct 11", title: "Robinhood Chain", text: "Instant Crawl checks Robinhood Chain tokens (holders, honeypot, contract owner), crawlers can watch the chain, and spawns can be paid in ETH from MetaMask or Rabby. ETH goes to the same buyback fund." },
  { date: "Oct 11", title: "Creator history", text: "Instant Crawl reads the creator's earlier pump.fun launches on-chain and flags serial launchers." },
  { date: "Oct 11", title: "Who's talking on X", text: "A live map of the people posting about a token: tap a bubble to read the post." },
  { date: "Oct 11", title: "Share cards for X", text: "Every scan has its own page with a preview card: post the verdict to X in one click." },
  { date: "Oct 11", title: "Bundle detection", text: "Instant Crawl traces who funded the top wallets and flags groups run by one owner." },
  { date: "Oct 11", title: "X buzz in scans", text: "Grok reads X for the token: sentiment, warnings and links to real posts." },
  { date: "Oct 10", title: "Instant Crawl", text: "Paste any token: crawlers check market, mint, holders, copycats and Telegram in seconds. Free, no wallet." },
  { date: "Oct 10", title: "Ready-made crawlers", text: "Eight tested crawlers in the marketplace, one click to buy." },
  { date: "Oct 10", title: "Buyback treasury counter", text: "Every SOL paid for crawlers is counted on the home page." },
  { date: "Oct 10", title: "Telegram delivery", text: "Signals and renewal reminders straight to your DMs." },
  { date: "Oct 10", title: "crawlhive.xyz", text: "Own domain, real crawlers only, terms & risks." },
  { date: "Oct 10", title: "Live crawlers", text: "X via Grok, Telegram, on-chain and docs, read through your own specification." },
  { date: "Oct 10", title: "On-chain payments", text: "Spawns and renewals paid in SOL through Phantom, verified on-chain." },
];

export function Shipped() {
  const [all, setAll] = useState(false);
  const shown = all ? SHIPPED : SHIPPED.slice(0, 6);
  return (
    <section className="mt-10">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
        <Rocket className="size-4 text-pink" /> Shipped
      </h2>
      <ol className="relative ml-2 border-l border-line">
        {shown.map((s, i) => (
          <li key={s.title} className="relative mb-4 pl-5">
            <span
              className="absolute top-1.5 -left-[5px] size-2.5 rounded-full"
              style={{ background: ["#ffb020", "#f472b6", "#5eead4", "#60a5fa", "#c084fc", "#b6f23a", "#ff6a3d"][i % 7] }}
            />
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="num text-xs text-muted">{s.date}</span>
              <span className="text-sm font-semibold">{s.title}</span>
            </div>
            <p className="text-xs text-muted">{s.text}</p>
          </li>
        ))}
      </ol>
      {SHIPPED.length > 6 && (
        <button onClick={() => setAll((v) => !v)} className="ml-7 text-xs text-honey hover:underline">
          {all ? "Show less" : `Show all ${SHIPPED.length} updates`}
        </button>
      )}
    </section>
  );
}
