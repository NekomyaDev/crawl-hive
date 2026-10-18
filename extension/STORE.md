# Chrome Web Store listing

**Name:** CrawlHive: memecoin safety scan in your terminal

**Summary (132 chars max):** The CrawlHive verdict on every token page: score, snipers, linked wallets, dev history and LP lock on GMGN, DexScreener, Axiom.

**Category:** Productivity (or Tools)

**Description:**

Stop switching tabs to check a token. CrawlHive puts the swarm's safety verdict right on the token page of the terminal you already use.

Open a token on GMGN, DexScreener, Axiom, Photon, pump.fun, Birdeye or Solscan, and a small panel shows up in the corner:

• Score and verdict: CLEAN, OK, RISKY or DANGER
• The worst red flags, each with a one-line reason
• Snipers: who bought in the first blocks and what they still hold
• Operators: holders, snipers and dev-funded wallets that share a funder, merged into one owner
• LP: burned, locked until a date, or unlocked
• The dev's earlier coins and how they ended, one tap away
• One click to the full scan on crawlhive.xyz

Solana, BNB Chain and Robinhood Chain. Free, no wallet, no account. The extension reads only the URL of token pages on these sites and never touches your wallet.

Every CrawlHive verdict is checked against the price for 24 hours and hashed onchain, and the misses are public too: crawlhive.xyz/replay.

Not financial advice. Memecoins are extremely risky.

**Single purpose:** Show the CrawlHive safety verdict for the token open in the current tab on supported trading sites.

**Permission justifications:**
- `storage`: remembers whether the panel is collapsed.
- Host permission `https://crawlhive.xyz/*`: fetches the verdict for the token in the page URL.
- Content scripts on the listed sites: read the page URL to find the token address and draw the panel.

**Data usage:** Does not collect personally identifiable information, health, financial, authentication, personal communications, location, web history or user activity. The page URL of supported token pages is sent to crawlhive.xyz only to return the verdict.

**Privacy policy URL:** https://crawlhive.xyz/extension/privacy

**Assets:** icon 128×128 (`icons/128.png`), screenshot 1280×800 (`public/extension/screenshot-1.png`), small promo tile 440×280 (`public/extension/promo-440x280.png`), marquee 1400×560 (`public/extension/marquee-1400x560.png`).
