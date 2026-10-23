"use client";
// Репутация разработчика: все монеты, которые мы знаем за кошельком-создателем, и чем каждая кончилась.
// Источники: память роя (роль dev и доказательства запуска), история pump.fun из Helius, Track Record, сканы.
// Ярлык, сводка и последние монеты бесплатно; полную таблицу сервер отдаёт от DEV_TABLE_TIER (api/dev/[address]).
import Link from "next/link";
import { useParams } from "next/navigation";
import { Copy, ExternalLink, Info, Lock, Wallet } from "lucide-react";
import { LivePill } from "@/components/radar-scope";
import { useToast } from "@/components/ui/toast";
import { useWallet } from "@/components/wallet-provider";
import { useApi } from "@/lib/client/use-api";
import { CHAIN_LABEL, VERDICT_COLOR, VERDICT_LABEL, type Verdict } from "@/lib/scan-share";
import { DEV_TABLE_TIER, TIER_NAME } from "@/lib/tier-gate";
import { cn, fmt, short, timeAgo } from "@/lib/utils";

type Outcome = "rugged" | "dumped" | "survived" | "open" | "untracked";
interface Coin {
  token: string;
  chain: string;
  symbol: string | null;
  name: string | null;
  at: number | null;
  atKind: "launch" | "seen";
  launchpad: string | null;
  scanned: boolean;
  verdict: Verdict | null;
  score: number | null;
  outcome: Outcome;
  peakPct: number | null;
  migrated: boolean | null;
  status: "alive" | "dead" | null;
  liq: number | null;
  fdv: number | null;
}
interface Rep {
  dev: string;
  chains: string[];
  badge: "serial" | "mixed" | "clean" | "new";
  badgeLine: string;
  stats: { coins: number; launchedPumpfun: number | null; graded: number; bad: number; rugRate: number | null; medianPeakPct: number | null; migrated: number; alive: number };
  factoryCoins: number;
  operator: { id: string; wallets: number; tokens: number; dumpRate: number | null; strong: boolean; scan: string | null } | null;
  pumpfunError: string | null;
  coins: Coin[];
  hidden: number;
  checkedAt: number;
}

// Правило ярлыка: то же, что BADGE_RULES в dev-reputation.ts.
const RULES =
  "New dev: 0 or 1 coin known. Serial rugger: 3 or more coins rugged or dumped 50%+ within 24h of our scan. Clean record: 2 or more coins known and none rugged or dumped. Mixed: everything else. Coins our Track Record never graded count as not rugged.";
const BADGE: Record<Rep["badge"], { t: string; c: string }> = {
  serial: { t: "Serial rugger", c: "border-danger/60 bg-danger/10 text-danger" },
  mixed: { t: "Mixed", c: "border-honey/60 bg-honey/10 text-honey" },
  clean: { t: "Clean record", c: "border-lime/60 bg-lime/10 text-lime" },
  new: { t: "New dev", c: "border-sky/60 bg-sky/10 text-sky" },
};
const OUTCOME: Record<Outcome, { t: string; c: string }> = {
  rugged: { t: "rugged", c: "border-danger/60 text-danger" },
  dumped: { t: "dumped 50%+", c: "border-coral/50 text-coral" },
  survived: { t: "held up 24h", c: "border-lime/50 text-lime" },
  open: { t: "grading", c: "border-line text-muted" },
  untracked: { t: "not graded", c: "border-line text-muted" },
};

const pct = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n)}%`;

function Box({ label, value, tone, hint }: { label: string; value: React.ReactNode; tone?: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel/70 px-3 py-2" title={hint}>
      <div className="text-[11px] text-muted">{label}</div>
      <div className={cn("num mt-0.5 text-xl font-bold", tone)}>{value}</div>
    </div>
  );
}

export function DevView() {
  const { address } = useParams<{ address: string }>();
  const { address: me, signedIn, connect, signIn } = useWallet();
  const toast = useToast();
  // Кошелёк в пути, чтобы после входа таблица перечиталась с тарифом (сервер читает только сессию).
  const { data, error } = useApi<Rep>(`/api/dev/${address}${signedIn && me ? `?w=${me}` : ""}`, 0);
  const b = data ? BADGE[data.badge] : null;
  const s = data?.stats;
  const sol = !address.startsWith("0x");
  return (
    <>
      <section className="mb-6">
        <LivePill tone="bg-honey">Dev reputation</LivePill>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <h1 className="num text-3xl font-bold tracking-tight break-all lg:text-4xl">{short(address)}</h1>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(address).then(() => toast("Address copied"))}
            className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-muted hover:border-honey/60 hover:text-honey"
          >
            <Copy className="size-3" /> Copy
          </button>
          {data?.chains.map((c) => (
            <span key={c} className="rounded-md border border-violet/40 px-1.5 py-0.5 text-[11px] text-violet">
              {CHAIN_LABEL[c] ?? c}
            </span>
          ))}
        </div>
        {sol ? (
          <a href={`https://solscan.io/account/${address}`} target="_blank" rel="noreferrer" className="num mt-1 inline-flex items-center gap-1 text-xs break-all text-muted hover:text-fg">
            {address} <ExternalLink className="size-3" />
          </a>
        ) : (
          <div className="num mt-1 text-xs break-all text-muted">{address}</div>
        )}
      </section>

      {error && <div className="rounded-2xl border border-danger/40 bg-danger/5 px-4 py-6 text-sm text-danger">{error}</div>}
      {!data && !error && (
        <div className="space-y-3" aria-label="Loading dev history">
          <div className="h-14 animate-pulse rounded-2xl border border-line bg-panel" />
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl border border-line bg-panel" />
            ))}
          </div>
          <div className="h-60 animate-pulse rounded-2xl border border-line bg-panel" />
        </div>
      )}

      {data && b && s && (
        <>
          <div className={cn("mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border-2 px-4 py-3", b.c)}>
            <span className="text-lg font-bold">{b.t}</span>
            <span className="text-sm text-fg/85">{data.badgeLine}</span>
            <span className="ml-auto inline-flex cursor-help items-center gap-1 text-[11px] text-muted" title={RULES}>
              <Info className="size-3.5" /> How this is decided
            </span>
          </div>
          {data.factoryCoins > 0 && (
            <div className="mb-5 rounded-xl border border-sky/40 bg-sky/5 px-4 py-2.5 text-sm text-fg/85">
              This address is a launchpad or factory contract on {data.factoryCoins} coin{data.factoryCoins > 1 ? "s" : ""}. It creates tokens for many different deployers, so those coins are not one
              person&apos;s launches and are left out below.
            </div>
          )}
          <div className="mb-5 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Box
              label="Coins launched"
              value={Math.max(s.coins, s.launchedPumpfun ?? 0)}
              hint={s.launchedPumpfun !== null && s.launchedPumpfun > s.coins ? `${s.launchedPumpfun} launches on pump.fun bonding curves, ${s.coins} listed below` : undefined}
            />
            <Box label="Graded by Track Record" value={s.graded} hint="Coins our Track Record followed for 24h after a scan" />
            <Box
              label="Rug rate"
              value={s.rugRate === null ? "-" : `${Math.round(s.rugRate * 100)}%`}
              tone={s.rugRate !== null && s.rugRate >= 0.5 ? "text-danger" : undefined}
              hint={`${s.bad} of ${s.graded} graded coins rugged or dumped 50%+`}
            />
            <Box label="Median peak" value={s.medianPeakPct === null ? "-" : pct(s.medianPeakPct)} tone="text-honey" hint="Highest price after our scan, median across tracked coins" />
            <Box label="Migrated" value={s.migrated} tone="text-teal" hint="Left the pump.fun bonding curve for a real pool" />
            <Box label="Alive now" value={s.alive} tone="text-lime" hint="Liquidity of $1k or more right now" />
          </div>

          {data.operator && (
            <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line bg-panel/70 px-4 py-2.5 text-sm">
              <span className="font-semibold">{data.operator.strong ? "Operator group" : "Linked wallets"}</span>
              <span className="text-fg/85">
                {data.operator.wallets} wallets across {data.operator.tokens} coins
                {data.operator.dumpRate !== null ? `, ${Math.round(data.operator.dumpRate * 100)}% of graded coins dumped` : ""}
                {data.operator.strong ? " (linked by bundles or dev money)" : " (linked by shared funders: a connection, not proof of common control)"}
              </span>
              <span className="ml-auto flex gap-3 text-xs">
                {data.operator.scan && (
                  <Link href={`/scan/${data.operator.scan}#full-analysis`} className="text-honey hover:underline">
                    Bubble map
                  </Link>
                )}
                <a href={`/api/brain/v1/operator/${data.operator.id}`} target="_blank" rel="noreferrer" className="num text-muted hover:text-fg">
                  {data.operator.id}
                </a>
              </span>
            </div>
          )}

          {data.coins.length ? (
            <div className="overflow-x-auto rounded-2xl border border-line bg-panel">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">
                    <th className="px-4 py-2.5">Coin</th>
                    <th className="px-3 py-2.5">Launched</th>
                    <th className="px-3 py-2.5">Launchpad</th>
                    <th className="px-3 py-2.5">Our verdict</th>
                    <th className="px-3 py-2.5">Outcome</th>
                    <th className="px-3 py-2.5 text-right">Peak</th>
                    <th className="px-4 py-2.5">Now</th>
                  </tr>
                </thead>
                <tbody>
                  {data.coins.map((c) => (
                    <tr key={c.token} className="border-b border-line/60 last:border-0 hover:bg-panel-2/50">
                      <td className="px-4 py-2.5">
                        <span className="font-semibold">{c.symbol ? `$${c.symbol}` : short(c.token)}</span>
                        {c.name && <span className="ml-2 text-xs text-muted">{c.name}</span>}
                      </td>
                      <td className="num px-3 py-2.5 text-xs text-muted" title={c.atKind === "seen" ? "Launch time unknown: when the swarm first saw it" : undefined}>
                        {c.at ? timeAgo(c.at) : "-"}
                        {c.at && c.atKind === "seen" ? " (seen)" : ""}
                      </td>
                      <td className="px-3 py-2.5 text-xs">{c.launchpad ?? <span className="text-muted">-</span>}</td>
                      <td className="px-3 py-2.5 text-xs">
                        {c.verdict ? (
                          c.scanned ? (
                            <Link href={`/scan/${c.token}`} className="font-semibold hover:underline" style={{ color: VERDICT_COLOR[c.verdict] }}>
                              {VERDICT_LABEL[c.verdict]}
                              {c.score !== null ? ` ${c.score}` : ""}
                            </Link>
                          ) : (
                            <span className="font-semibold" style={{ color: VERDICT_COLOR[c.verdict] }}>
                              {VERDICT_LABEL[c.verdict]}
                            </span>
                          )
                        ) : (
                          <Link href={`/?scan=${c.token}`} className="text-muted hover:text-honey">
                            not scanned, scan it
                          </Link>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={cn("rounded border px-1.5 py-px text-[11px] font-semibold", OUTCOME[c.outcome].c)}>{OUTCOME[c.outcome].t}</span>
                        {c.migrated && <span className="ml-1 rounded border border-teal/50 px-1.5 py-px text-[11px] font-semibold text-teal">migrated</span>}
                      </td>
                      <td className={cn("num px-3 py-2.5 text-right", (c.peakPct ?? 0) > 0 ? "text-lime" : "text-muted")}>{c.peakPct !== null ? pct(c.peakPct) : "-"}</td>
                      <td className="px-4 py-2.5 text-xs">
                        {c.status === null ? (
                          <span className="text-muted">-</span>
                        ) : c.status === "alive" ? (
                          <span className="text-lime" title={c.fdv ? `FDV $${fmt(c.fdv)}` : undefined}>
                            alive{c.liq ? ` · $${fmt(c.liq)} liq` : ""}
                          </span>
                        ) : (
                          <span className="text-muted">dead liquidity</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.hidden > 0 && (
                <div className="flex flex-wrap items-center justify-center gap-3 border-t border-honey/30 bg-honey/5 px-4 py-4 text-center text-sm">
                  <Lock className="size-4 text-honey" />
                  <span>
                    {data.hidden} older coin{data.hidden > 1 ? "s" : ""} hidden. The full history is for the <span className="font-semibold text-lime">{TIER_NAME[DEV_TABLE_TIER]}</span> tier and up.
                  </span>
                  <Link href="/pricing" className="inline-flex h-8 items-center rounded-lg bg-honey px-3 text-xs font-semibold text-black hover:bg-[#ffc24d]">
                    Unlock with {TIER_NAME[DEV_TABLE_TIER]}
                  </Link>
                  {!signedIn && (
                    <button
                      type="button"
                      onClick={() => (me ? signIn() : connect()).catch(() => {})}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-xs hover:border-honey/60 hover:text-honey"
                    >
                      <Wallet className="size-3.5" /> {me ? "Sign in" : "Connect wallet"}
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-line bg-panel px-4 py-8 text-center text-sm text-muted">No coins launched by this wallet are in our memory yet.</div>
          )}
          {data.pumpfunError && <p className="mt-3 text-xs text-honey">pump.fun history not loaded: {data.pumpfunError}</p>}
          <p className="mt-3 text-xs text-muted">
            Coins from the swarm&apos;s memory of launches (the wallet that signed the launch) and, on Solana, Helius-parsed pump.fun create transactions (up to the last 300). Verdict and outcome from our
            scans and Track Record: dumped means it fell 50%+ within 24h of the scan. Current liquidity from DexScreener. Updated {timeAgo(data.checkedAt)}. A history, not an accusation, and not financial
            advice.
          </p>
        </>
      )}
    </>
  );
}
