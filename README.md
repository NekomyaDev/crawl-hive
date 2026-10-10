# CrawlHive

**Burn $CRAWL, spawn a crawler, join the swarm.**

CrawlHive is a network of user-owned crawlers for the memecoin space. Holders burn tokens to spawn crawlers that dig X, Telegram, on-chain activity and docs for signal. Each crawler is a dot on the live swarm map, earns reputation from the quality of what it finds, takes a share of every epoch's rewards, and can be sold or rented on the marketplace. Holders vote on what the swarm should prioritise.

The flywheel: more trading → more burns → more crawlers → more data → better signals → more attention.

## Status: MVP on mock data

| Part | State |
|---|---|
| Swarm map, filters, live signal stream | works, on a simulated network (130 seeded crawlers, 28 wallets) |
| Spawner (tiers, sources, targets, frequency) | works, the burn is simulated server-side |
| Reputation | works, real formula over simulated stats |
| Marketplace (sell / rent, 2.5% fee burn) | works |
| Leaderboard (crawlers + wallets) | works |
| Governance (token-weighted votes, new proposals) | works |
| Wallet | Phantom connect if installed, otherwise a demo wallet with 250k $CRAWL |
| On-chain burn, real crawlers, Postgres | **not yet**: see Roadmap |

State lives in server memory and resets on restart. Signal tickers are fictional on purpose.

## Run

```bash
npm install
npm run dev          # http://localhost:3000
# or
npm run build && npm start
```

Node 20+.

## Screens

- `/`: **Swarm**. Force-directed map: dots are crawlers (colour = source, size and glow = reputation), hexagons are wallets. Filter by narrative, source, chain and minimum reputation. Dots flash when they fire a signal. Network stats and the epoch timer sit on top.
- `/spawn`: **Spawner**. Pick a tier (how much you burn), a source, narratives, targets and crawl frequency; a live preview shows the cost and starting reputation.
- `/my`: **My Crawlers**. Your fleet and the crawlers you rent, with pause/resume.
- `/crawler/[id]`: a crawler's stats, reputation breakdown, recent signals; the owner can edit targets and list it on the market.
- `/market`: **Marketplace**. Buy outright or rent for N days. While rented, the renter earns the rewards.
- `/leaderboard`: ranks by reputation, rewards, data volume, signal quality or uptime, plus top wallets.
- `/governance`: proposals on crawl priorities, reward split and network params. 1 $CRAWL = 1 vote, re-voting allowed until close.

## Economy

| Tier | Burn | Targets | Fastest cycle | Reward boost |
|---|---|---|---|---|
| Larva | 1,000 | 3 | 30 min | 1× |
| Worker | 5,000 | 8 | 10 min | 1.15× |
| Soldier | 25,000 | 20 | 5 min | 1.35× |
| Queen | 100,000 | 50 | 1 min | 1.75× |

- Every epoch (10 min in the demo) emits 50k $CRAWL, split across working crawlers by `reputation × tier boost`.
- A marketplace trade burns 2.5% of the price.
- Creating a proposal needs a 10k $CRAWL balance.

Parameters live in `src/lib/economy.ts`.

## Reputation

0–1000, recalculated on every tick (`src/lib/reputation.ts`):

| Component | Weight | Measured as |
|---|---|---|
| Signal quality | 40% | `(hits + 2.5) / (signals + 5)`: smoothed so a 1/1 newcomer doesn't top the board |
| Uptime | 25% | time online / time since spawn |
| Data volume | 20% | `log10(items + 1) / 5`, capped at 1, so spam doesn't pay |
| Stake | 15% | `log10(burned + 1) / 5` |

Grades: S ≥ 800, A ≥ 650, B ≥ 500, C ≥ 350, D below that.

## Architecture

```
src/
  app/
    page.tsx                 Swarm dashboard
    spawn/ my/ market/ leaderboard/ governance/ crawler/[id]/
    api/
      swarm/                 GET graph + stats + recent signals
      crawlers/              GET list (filters), POST spawn
      crawlers/[id]/         GET detail, PATCH status / targets
      market/                GET listings, POST list
      market/[id]/           POST buy/rent, DELETE delist
      leaderboard/           GET ?sort=
      governance/            GET proposals, POST create
      governance/[id]/       POST vote
      wallet/[address]/      GET balance, burned, fleet
      stream/                GET Server-Sent Events: signals, spawns, trades
  components/
    swarm/                   map (react-force-graph-2d on canvas) and its filters
    ui/                      button, card, badge, fields, toast
    wallet-provider.tsx      Phantom / demo wallet
  lib/
    types.ts economy.ts reputation.ts
    server/store.ts          in-memory state + simulation tick
    server/seed.ts           deterministic seed network
db/schema.sql                target Postgres schema
```

- **Stack:** Next.js 16 (App Router, Cache Components), React 19, Tailwind 4, react-force-graph-2d, lucide-react. UI primitives are hand-rolled in the shadcn style instead of pulling in the CLI.
- **Auth:** the API trusts an `x-wallet` header. That is fine for a demo; production needs a signed message (SIWS).
- **Real-time:** one SSE connection per tab (`/api/stream`); its timer also drives the simulation tick.
- **Simulation:** each tick, a crawler accrues items from `targets × cycles`, fires signals as a Poisson process, turns them into hits with a hidden per-crawler skill, and earns its share of emission.

## Roadmap

1. **On-chain burn:** SPL `burn` instruction signed in Phantom; the server verifies the tx signature before spawning (`crawlers.burn_tx`).
2. **SIWS auth:** replace the `x-wallet` header with a signed message and a session.
3. **Postgres:** move `store.ts` onto `db/schema.sql`, keep the same function signatures.
4. **Real workers:** a job queue and Playwright/API workers per source; signals scored on outcome (price move, confirmation) to compute real hits.
5. **Snapshot voting:** vote weight from a balance snapshot at proposal start, not the live balance.
6. **Governance → params:** apply winning `params` and `priority` proposals automatically (reputation weights, narrative boosts).
