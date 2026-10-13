# CrawlHive update: the swarm got smarter, cheaper and louder

Three days ago CrawlHive was a scanner with crawlers behind it. Since then we shipped a decision model on every signal, a way for any AI agent to run your crawlers, a public record of every verdict, a radar that scans launches on its own, BNB Chain and Meteora, a full app inside Telegram, and a security audit of the whole codebase. Here is what changed and what it gave us, with real numbers.

[ COVER: images/00-cover.png ]

## The short version

- ⚡ Jev rates every crawler find in half a second for $0.00002.
- 🐙 A Grok Bot can sit on duty over any crawler, and any agent can plug in with one click: Grok Bot, ChatGPT Dots, Meta Muse, Claude, Cursor.
- 🎯 Every verdict is checked against the real price for 24 hours, in public, misses included.
- 📡 The swarm scans fresh launches on Solana, Robinhood Chain and BNB Chain on its own.
- 📱 CrawlHive is now an app inside Telegram: scan, Launch Radar, watchlist and your crawlers, one tap from @crawlhivebot.
- 🤖 The bot scans any token in chat, watches it for rugs, answers contract addresses in groups and works inline in any chat.
- 🟡 Scans now cover BNB Chain and every Solana launchpad, Meteora included.
- 🔥 $CRAWLHIVE is live: the treasury buys it back and burns it every 12 hours, and the best crawler of the day earns half the creator fees.
- 🩻 Contract X-Ray reads the token's code, even unpublished, and lists what the team can still do to holders.
- 🔐 We audited our own code and closed more than a dozen holes before anyone else found them.
- 💸 The same product costs 8 to 50 times less to run, with a hard ceiling of $1.25 a day on AI.

[ IMAGE 01: images/01-home-telegram.png ]

## ⚡ Jev decides, Grok researches

Most of what a crawler does is small decisions. Is this post a real call or a giveaway? Is this token worth a look or noise? Asking a big language model each time is slow and expensive.

Jev is a decision model from TypeSafe. It doesn't write text. It picks an answer from options we define and says how sure it is. We use it in two places:

- Every crawler find. Jev answers "is this worth a trader's attention right now?" with a probability. Pure noise is dropped before the safety scan, and the rest is scanned most promising first. Every signal shows its rating: ⚡ Jev 74%.
- The Grok Bot's verdict. When Jev is at least 70% sure of LOOK, WATCH or AVOID, its answer is final. Grok is asked only about the doubtful ones, in one call.

Measured on production: 0.4–0.7 seconds and about $0.00002 per decision. In its first hour Jev rated 29 real signals for $0.0008 in total. On the 15 latest real signals, the tokens that went on to pump scored 66–83% and the ones that dumped 49–55%, and it dropped none of them. A "FREE AIRDROP, connect wallet" spam post scored 3%.

[ IMAGE 02: images/02-jev-octo.png ]

A crawler running Jev turns pink at the tips and wears the spark. Live on a real crawler, it looks like this:

[ IMAGE 03: images/03-jev-live.png ]

## 🐙 Grok Bot on duty

One switch under any live crawler. Turn it on and our Grok Bot reads every new signal from that crawler: it waits 20 seconds to batch what arrived together, scans the tokens, and writes one line under each signal: LOOK, WATCH or AVOID, with the reason and a link to the scan. The same line follows the signal to Telegram.

It never polls. No signals, no calls, nothing spent. No $200 subscription either: it's a switch.

[ IMAGE 04: images/04-grok-duty.png ]

## 🤝 Any AI agent, one click

OpenAI has Dots. SpaceX has Grok Bot. Meta has Muse. All of them can now run your crawlers.

CrawlHive speaks MCP, the protocol AI agents use to talk to tools. Grok Bot connects with a bot key. ChatGPT Dots, Meta Muse, Claude and Cursor connect with a button:

1. Paste crawlhive.xyz/mcp into your agent and press Connect.
2. CrawlHive opens. Pick an existing bot or create a new one over the crawlers you choose.
3. Approve with your wallet.

The agent gets read access to those crawlers and free token scans, nothing more. It can't change crawlers, spend credits or move funds. Every connected app shows on its bot card and can be disconnected on its own.

Why it matters: an agent that wakes up every few minutes to check a feed burns credits on runs where nothing happened. Your crawlers already watch X, Telegram and the chain around the clock, so the agent asks "anything new?" first and goes back to sleep when the answer is no. Tested live through the Grok API: $0.0006 for a quiet run, $0.006 when there were signals.

[ IMAGE 05: images/05-agents.png ]

## 🔥 $CRAWLHIVE is live: buyback & burn every 12 hours

The project token is out: $CRAWLHIVE on Solana, `D4jNDQa3Cu4v8VMCAc2z7pgGGo7aGqzjXmwGR9wapump`.

Every SOL that crawler owners pay for spawns goes to the treasury, and every 12 hours, at 00:00 and 12:00 UTC, the treasury buys $CRAWLHIVE on the market and burns it in the same transaction. Nothing sits in a wallet waiting to be sold: the supply only goes down, and every buyback is listed on the home page with its transaction.

On top of that, half of the day's creator fees go to the owner of the best crawler of the day, if they hold $CRAWLHIVE. The best crawler is the one whose calls actually pumped, checked against the real price.

The token, its live chart, the countdown to the next buyback and today's crawler leaderboard are on the home page, in the Telegram app, and one /token away in @crawlhivebot.

## 🩻 Contract X-Ray: we reverse engineer every token

AI agents are learning to take apart closed-source software. We pointed the same idea at the place memecoin traps actually hide: the token contract.

- On BNB Chain and Robinhood Chain the scanner reads the contract's bytecode straight from the chain, even when the team never published the source. It lists what the team can still do to you: mint new tokens, blacklist your wallet, raise the sell tax, stop trading, cap how much you can sell, or swap the whole contract through a proxy. If ownership is renounced, those powers are shown as dead.
- Scammers rename their functions, so reading names isn't enough. We run the bytecode through evmole, the EVM engine inside the REA "reverse engineer anything" toolkit, and trace which function writes what. That catches what a name list can't: a function called something harmless that flags your wallet on every transfer, or a fake `Approve` that is really a switch for who can sell. On a fresh BNB launch it caught exactly that: `Approve(address[])` controlling who can trade.
- On Solana it reads Token-2022 extensions, the newer token standard that can carry nasty switches: a permanent delegate that can take tokens from any wallet, a transfer hook that can block sells, a transfer tax, wallets frozen by default.
- And it opens the project's website and checks the code for wallet drainers: hidden unlimited approvals, transfers to a hard-coded wallet, known drainer kits.

Every finding costs points in the score and shows up in a Contract X-Ray panel on the site, in the Telegram app and on the bot's scan card. Agents connected over MCP get it too.

[ IMAGE 12: images/12-contract-xray.png ]

## 🎯 Track Record: we publish our misses

Every scanner says "trust me". We'd rather show the receipts.

Every verdict, from user scans, crawler safety checks, Launch Radar and agents, is stored with the price and liquidity at the moment of the scan. For the next 24 hours the price is sampled every 10 minutes. A token counts as dumped when it falls 50% below the scan price, and as rugged when its liquidity is pulled.

The page shows the outcome per verdict, a "We warned you" list (DANGER or RISKY, and then it dumped) and a "We missed" list (CLEAN or OK, and it dumped anyway). The misses are shown on purpose.

[ IMAGE 06: images/06-track-record.png ]

It paid off within three hours. The "We missed" list filled up with one pattern: tokens under a day old, rated OK because each flag alone cost only a few points, that had linked wallets or a creator wallet only hours old. $SUKI had 12 linked wallets and a creator wallet under an hour old: rated OK, rugged. $WAIFU, with 11 linked wallets and a fresh dev, went the same way.

So we changed the rule the same day. A token under 24 hours old with linked wallets, a fresh dev wallet, fresh holder wallets, an active contract owner or a dev holding a lot can't score above RISKY anymore, however many points it collects. $WALTJR, which was 95 CLEAN before it fell 64%, now scans as 59 RISKY: "Young and linked".

That's the point of a public record. It tells us where the scanner is weak before the market does.

## 📡 Launch Radar

You don't have to paste anything to find something. Every 3 minutes the swarm takes new launches on Solana, Robinhood Chain and BNB Chain, keeps the ones between 36 minutes and 24 hours old with at least $5k of liquidity, and runs the full scan on them: holders, bundles, dev history, copycats.

Everyone sees the verdicts 10 minutes later. Crawler owners get launches like these the second they appear, filtered to their own rules. Every radar verdict also goes into the Track Record.

[ IMAGE 07: images/07-launch-radar.png ]

## 📱 CrawlHive is now an app inside Telegram

Open @crawlhivebot and press Open app. That's it: no App Store, no sign-up, no wallet popup. Telegram tells the app who you are, signed with the bot's key, and the server checks that signature on every request.

Five tabs, built for a phone:

- Scan. Paste or tap the clipboard button. You watch the crawlers work, then get the score ring, the verdict, every flag with its weight, liquidity, FDV and age. Watch it, share it to any chat, or open the full report.
- Radar. Fresh launches the swarm scanned on its own, newest first. Tap one to scan it.
- Watch. Your watchlist with the live price since you started watching, plus switches for Launch Radar alerts and the 24-hour follow-ups.
- Crawlers. Link your wallet once on the site and your crawlers and their private signals show up here, with Jev ratings, Grok Bot takes and outcomes.
- Track. How our verdicts played out.

The app and the bot share everything: add a token to the watchlist in the app and the alert arrives in the chat; tap a button under a scan in the chat and it opens in the app. It follows Telegram's look, vibrates on a verdict (a soft tap for CLEAN, a buzz for DANGER) and uses Telegram's own back button.

[ IMAGE 10: images/10-telegram-app.png ]

## 🤖 The bot, for chats and groups

The bot is the part of the app that lives in your chats. It greets you with a banner and keeps the menu to two commands: /start, then just send a token, and /support, which goes straight to the team. Answers come back in the same chat.

[ IMAGE 11: images/11-bot-welcome.png ]

- Scan in the chat. Send a Solana mint, a Robinhood Chain 0x address, a pump.fun or DexScreener link, or a $TICKER. You get the scan card with the verdict, the main flags, a Jev take and buttons: Full scan, Watch, Chart, Rescan, Open in the app.
- Groups. Add the bot to a group and it answers every contract address posted there with a short verdict, no command needed. Only group admins can change its settings or switch it off with /autoscan off.
- 👁 Watch for 7 days. One ping if the pair disappears, liquidity falls below 30%, the price drops 50%, or the verdict turns DANGER.
- 24 hours later. The bot comes back and tells you whether the verdict came true: we called it, it held, or we missed this one.
- Inline in any chat. Type @crawlhivebot and a token address or $TICKER in any conversation, and the verdict drops right into it. No need to add the bot anywhere.
- Launch Radar alerts with filters and /track.

[ IMAGE 08: images/08-telegram-bot.png ]

## 🟡 BNB Chain and Meteora

Memecoins don't live on one chain or one launchpad, so neither does the scanner anymore.

- BNB Chain. Paste a 0x address and the scanner finds the chain by itself: holders, the top-10 share, a honeypot check and whether the deployer still controls the contract. Tokens still on the four.meme curve are recognised as such.
- Every Solana launchpad. Before, only pump.fun tokens got their curve and creator checked. Now Meteora, Raydium LaunchLab, Moonshot and the rest do too: a token on a curve is reported as on the curve, not as a pool with $0, and the creator is the wallet that paid for the token's very first transaction. On a fresh token that can mean digging through 6,000 bot trades from the first few minutes, so the scanner reads up to 25 pages of history.

A Meteora token four minutes old used to come back as "too early to judge". Now it reads: on the Meteora curve, 12 linked wallets, a creator wallet 12 minutes old. 45 RISKY.

## 💸 A fraction of the bill

Three days ago a dollar of AI credits could disappear in minutes: every scan ran an X search on a large model with three search rounds. Now:

- A token scan costs $0. The X check runs only when you press the button.
- An X check went from about $0.40 to $0.05, and a repeat within 6 hours is free.
- An X crawler run went from about $0.07 to $0.004.
- A bot verdict went from $0.001 to $0.00002 when Jev decides.

On top of that there are hard daily limits: at most 20 X checks and 60 Grok calls a day. AI spend stays under about $1.25 a day, however much traffic comes in.

[ IMAGE 09: images/09-costs.png ]

## 🛡 Built to take a hit, and audited

- Every IP is limited to 10 requests a second, with room for a burst. Past that it gets 429.
- An IP that keeps hitting the limit for about a minute is banned at the firewall for an hour, so its requests don't even reach the web server.
- SSH takes keys only, brute force is banned automatically, and repeat offenders are banned for a week.
- Only the web ports and SSH are open.
- Bot keys and agent tokens are stored as hashes and shown once.

Then we turned on ourselves. Several agents went through the whole codebase at once, looking for the holes an attacker would look for, and every finding was checked by hand. What we closed:

- A crawler that reads project docs can't be pointed at our own server or the cloud's internal addresses anymore. The check happens at the moment of connection, so swapping DNS halfway doesn't help.
- A crafted text can't freeze the scanner with a slow pattern match.
- Scan limits count the real visitor, not a header anyone can fake.
- A post written to fool the AI can't turn a DANGER token into LOOK. The verdict has a floor that no signal text can lift.
- Wallet sign-in names our domain, so a signature phishing site can't reuse it, and logging out ends every session of that wallet.
- Agent connections show the exact address the app returns to, never preselect a bot, and their tokens can't be reused by another app.
- Anonymous Telegram scans have their own AI budget, so a flood of throwaway accounts can't leave paying crawler owners without Jev.
- The server runs without root and without system privileges, and the site can't be framed by other pages.

## What's next

Track Record showed us exactly where to dig. Next we go deeper on holders: wallets that act as one operator (shared buys, shared funders, wallets that enter in the same block), the first buyers and what they did since, and a memory of operators across launches, so wallets that rugged before are recognised the next time they show up.

## Step inside

Paste a token. Watch the swarm work. Or open the app in Telegram.

🐝 crawlhive.xyz
🔥 $CRAWLHIVE: D4jNDQa3Cu4v8VMCAc2z7pgGGo7aGqzjXmwGR9wapump
📱 t.me/crawlhivebot (press Open app)
🎯 crawlhive.xyz/track
📖 github.com/h100envy/crawl-hive

Not financial advice. Crawlers find signals; you make the calls.
