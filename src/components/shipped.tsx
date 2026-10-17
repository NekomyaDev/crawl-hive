"use client";
import { useState } from "react";
// Таймлайн выкаток: что и когда появилось. Показывает, что проект живой и двигается.
import { Rocket } from "lucide-react";

const SHIPPED: { date: string; title: string; text: string }[] = [
  { date: "Oct 17", title: "Simpler token block", text: "The token block on the home page now shows only what is live: buyback & burn with treasury revenue by source, and the DEX fund. Crawler of the day is retired." },
  { date: "Oct 17", title: "New radar screens", text: "Launch Radar and Narrative Radar got a live radar screen: a rotating sweep with every find as a blip, closer to the center means fresher or hotter, tap one to jump to its card. Cards now show the token logo, FDV at scan, score, a copyable contract, chain and verdict filters. Clean Launch and Narrative Radar are now on the home page and in the marketplace." },
  { date: "Oct 17", title: "Narrative Radar", text: "The platform now runs its own Narrative Hunter, owned by nobody and working for everyone. Every 3 hours it walks X for what just started spreading, verifies every post, and puts each narrative on /narratives with its heat, how many coins already use the ticker and a Launch this narrative button. Also in the bot: /narratives." },
  { date: "Oct 17", title: "DEX fund: back to the profile", text: "The person who paid for the $CRAWLHIVE DexScreener profile moved that payment to another token and the profile was deleted, so the DEX fund goes back to its first goal: Enhanced Token Info ($299) for the logo, banner and links on every chart. Boosts come after that. Every gift is verified onchain and kept apart from buybacks." },
  { date: "Oct 17", title: "Fourth buyback & burn", text: "The biggest one yet: 0.5 SOL from the treasury bought 1.72M $CRAWLHIVE and 1,667,562 was burned. Four burns in three days: 4.33M burned in total, 1.02 SOL spent." },
  { date: "Oct 17", title: "Launch this narrative", text: "Every Narrative Hunter signal now has a Launch this narrative button, on the site and in Telegram. It opens Clean Launch with the name, ticker and description already filled in from the narrative and a link to the source post: add a picture and launch. The swarm scans the coin at birth like any other." },
  { date: "Oct 16", title: "Third buyback & burn", text: "0.1 SOL from the treasury bought 489,478 $CRAWLHIVE and 474,794 was burned. Three burns in two days: 2.67M burned in total, 0.27% of supply." },
  { date: "Oct 16", title: "Narrative Hunter", text: "A new ready-made crawler: every 3 hours Grok walks X for narratives that started spreading, every post link is verified with X's oEmbed so invented ones drop out, and each narrative shows how many coins with that ticker already launched in 24 hours." },
  { date: "Oct 16", title: "Clean Launch", text: "Launch a coin on pump.fun right from CrawlHive, with an optional dev buy. The mint key is made in your browser, Phantom signs, 0% platform fee. The swarm scans every coin at birth by the same rules as any other and puts the verdict on the Track Record." },
  { date: "Oct 16", title: "x402 revenue → burns", text: "The treasury now shows revenue by source: SOL from crawler spawns, USDC from AI agents paying per scan over x402, and the DEX fund, with a Solscan link for every x402 settlement. x402 USDC joins the 12-hour buyback cycle as its own line: swapped to $CRAWLHIVE and burned." },
  { date: "Oct 16", title: "Boost fund", text: "The DexScreener profile is paid, so the DEX fund now goes straight to boosts: 10x, 30x, 100x and the golden ticker. Same one-click Phantom gift, verified onchain." },
  { date: "Oct 15", title: "DEX fund", text: "One click to chip in SOL, or pay a whole level, for $CRAWLHIVE on DexScreener: the profile first, then boosts up to the golden ticker. Progress is live and every gift is verified onchain." },
  { date: "Oct 15", title: "Onchain proof", text: "Every 15 minutes all new verdicts and crawler calls are hashed into a Merkle tree and the root is written to Solana. Nothing can be quietly deleted or edited after the price moves. Check any token on Track Record." },
  { date: "Oct 15", title: "For AI agents", text: "A2A agent card and a live agent at /a2a, the official MCP Registry listing, OpenAPI and llms.txt. Everything an agent needs to find, call and pay CrawlHive is on the new For agents page." },
  { date: "Oct 15", title: "First buyback & burn", text: "0.3 SOL from the treasury bought 1.61M $CRAWLHIVE on the market and 1.55M was burned onchain in the same transaction. The supply dropped by 0.155%." },
  { date: "Oct 15", title: "Pay per scan with x402", text: "Any AI agent can buy a scan for $0.01 USDC on Solana over x402: no account, no API key, charged only if the scan succeeds. Humans can try it with Phantom on the For agents page." },
  { date: "Oct 14", title: "Contract X-Ray", text: "Every scan reads what the owner can do to holders: blacklist, pause, mint, change taxes, hidden functions in the EVM bytecode, risky Token-2022 extensions on Solana, and drainer code on the project site." },
  { date: "Oct 13", title: "$CRAWLHIVE is live", text: "The project token launched on Solana. Treasury SOL buys it back and burns it, and the best crawler of the day earns half of the day's creator fees." },
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
