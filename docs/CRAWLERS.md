# Crawler specification

Every live crawler is a **source**, a list of **targets** and a **specification**. The scheduler (`src/lib/server/crawl/scheduler.ts`) runs each crawler on its own cycle, turns what it finds into signals, and scores every signal that points at a token against the real price later.

Signals from live crawlers are **private**: only the owner (or the renter during a lease) sees their content. Everyone else sees that a crawler fired, not what it found.

## Sources

| Source | What it reads | Targets | Needs |
|---|---|---|---|
| **X** | Posts found by Grok's `x_search` tool | `@handles` (only these accounts) and/or search queries | `XAI_API_KEY`. Runs at most every `X_MIN_INTERVAL_MIN` (default 30) because each run is a paid search |
| **Telegram** | Public channels via the `t.me/s/<channel>` web preview | `t.me/name` or `@name` | nothing; with `XAI_API_KEY` messages are read by Grok, otherwise by rules |
| **On-chain** | DexScreener: new token profiles, boosted tokens, keyword search | optional token addresses: a watchlist for volume spikes | nothing |
| **Docs** | Any public page; the first run remembers it, later runs report new lines | URLs | nothing; with `XAI_API_KEY` changes are summarised by Grok |

## Specification fields

| Field | Meaning |
|---|---|
| `instructions` | Free text, up to 1200 chars. The owner's edge in plain language: what counts, what to ignore. Passed to Grok as preferences (never as commands that change the output format) |
| `keywords` / `excludeKeywords` | Must match / must not match. Also used as search terms for X and the on-chain search feed |
| `signalKinds` | Which signal types to send: `kol_call`, `mention_spike`, `new_pair`, `whale_buy`, `doc_update` (each source supports a subset) |
| `minConfidence` | Signals below this confidence are dropped |
| `onchain.feeds` | `profiles`, `boosts`, `search` |
| `onchain.minLiquidityUsd`, `minVolume1hUsd`, `maxFdvUsd`, `maxAgeHours` | Pair filters (0 = no limit for max fields) |
| `x.imageUnderstanding` | Let Grok read images in posts (charts, screenshots); costs more |
| `outcome.horizonMin`, `outcome.hitThresholdPct` | How a signal is scored: price after N minutes vs. price at signal time; a rise of at least the threshold is a **hit** |

## Pipeline

1. **Collect.** The source fetches new items since its cursor (last post id, last run time, page hash).
2. **Extract.** With Grok: the model reads the items through the specification and returns structured signals. Without Grok: rules pick items that mention a `$TICKER` or a contract address and match the keywords.
3. **Resolve.** Each signal is matched to a token on DexScreener (by contract, or by exact ticker with the deepest liquidity on the crawler's chain) and the current price is stored.
4. **Deduplicate.** The same token is not reported twice by one crawler within 12 hours.
5. **Deliver.** The signal goes to the owner's *My Signals* inbox and the crawler page; the public feed gets a redacted copy.
6. **Score.** After `horizonMin` the price is checked again: hit or miss. Hits and scored signals feed the reputation formula (`src/lib/reputation.ts`). Signals without a token stay `unscored` and don't affect precision.

## Limits and costs

- Grok calls are capped per day by `XAI_DAILY_CALLS` (default 300).
- X search is billed by xAI at about $5 per 1,000 posts fetched plus tokens.
- At most 3 crawlers run at the same time; a run times out after 2 minutes.
