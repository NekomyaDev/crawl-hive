// Таймлайн выкаток: что и когда появилось. Показывает, что проект живой и двигается.
import { Rocket } from "lucide-react";

const SHIPPED: { date: string; title: string; text: string }[] = [
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
  return (
    <section className="mt-10">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
        <Rocket className="size-4 text-pink" /> Shipped
      </h2>
      <ol className="relative ml-2 border-l border-line">
        {SHIPPED.map((s, i) => (
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
    </section>
  );
}
