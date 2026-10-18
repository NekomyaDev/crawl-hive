"use client";
// Репутация разработчика: все монеты кошелька-создателя на pump.fun и чем каждая кончилась.
import Link from "next/link";
import { useParams } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { LivePill } from "@/components/radar-scope";
import { useApi } from "@/lib/client/use-api";
import { cn, fmt, short, timeAgo } from "@/lib/utils";

interface Coin {
  mint: string;
  symbol: string | null;
  name: string | null;
  createdAt: number;
  status: "live" | "dead" | "graduated" | "rugged" | "dumped";
  fdv: number | null;
  liq: number | null;
  url: string | null;
}
interface Profile {
  creator: string;
  launched: number;
  graduated: number;
  coins: Coin[];
  summary: { live: number; dead: number; rugged: number; graduated: number; bestFdv: number | null };
  verdict: "serial" | "weak" | "solid" | "new" | "mixed";
  checkedAt: number;
}

const VERDICT: Record<Profile["verdict"], { t: string; note: string; c: string }> = {
  serial: { t: "Serial launcher", note: "Many launches, none made it to a real pool. Treat new coins from this wallet with care.", c: "border-danger/60 bg-danger/10 text-danger" },
  weak: { t: "Weak record", note: "Most earlier coins from this wallet are dead or rugged.", c: "border-coral/60 bg-coral/10 text-coral" },
  mixed: { t: "Mixed record", note: "Some coins live on, many did not. Look at each one.", c: "border-honey/60 bg-honey/10 text-honey" },
  solid: { t: "Solid record", note: "A good share of earlier coins graduated to a real pool. Still no guarantee.", c: "border-lime/60 bg-lime/10 text-lime" },
  new: { t: "First launch", note: "No earlier coins from this wallet on pump.fun. No history to judge either way.", c: "border-sky/60 bg-sky/10 text-sky" },
};
const STATUS: Record<Coin["status"], { t: string; c: string }> = {
  live: { t: "live", c: "border-lime/50 text-lime" },
  graduated: { t: "graduated", c: "border-teal/50 text-teal" },
  dead: { t: "dead", c: "border-line text-muted" },
  dumped: { t: "dumped", c: "border-coral/50 text-coral" },
  rugged: { t: "rugged", c: "border-danger/60 text-danger" },
};

function Box({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel/70 px-3 py-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={cn("num mt-0.5 text-xl font-bold", tone)}>{value}</div>
    </div>
  );
}

export function DevView() {
  const { address } = useParams<{ address: string }>();
  const { data, error } = useApi<Profile>(`/api/dev/${address}`, 0);
  const v = data ? VERDICT[data.verdict] : null;
  return (
    <>
      <section className="mb-6">
        <LivePill tone="bg-honey">Dev reputation · pump.fun</LivePill>
        <h1 className="num mt-4 text-3xl font-bold tracking-tight break-all lg:text-4xl">{short(address)}</h1>
        <a href={`https://solscan.io/account/${address}`} target="_blank" rel="noreferrer" className="num mt-1 inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
          {address} <ExternalLink className="size-3" />
        </a>
      </section>

      {error && <div className="rounded-2xl border border-danger/40 bg-danger/5 px-4 py-6 text-sm text-danger">{error}</div>}
      {!data && !error && <div className="rounded-2xl border border-line bg-panel px-4 py-12 text-center text-sm text-muted">Reading every coin this wallet created…</div>}

      {data && v && (
        <>
          <div className={cn("mb-5 rounded-2xl border-2 px-4 py-3", v.c)}>
            <div className="text-lg font-bold">{v.t}</div>
            <div className="text-sm text-fg/85">{v.note}</div>
          </div>
          <div className="mb-5 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Box label="Launches on pump.fun" value={data.launched} />
            <Box label="Graduated" value={data.graduated} tone="text-teal" />
            <Box label="Still alive" value={data.summary.live} tone="text-lime" />
            <Box label="Dead" value={data.summary.dead} tone="text-muted" />
            <Box label="Rugged" value={data.summary.rugged} tone="text-danger" />
            <Box label="Best FDV now" value={data.summary.bestFdv ? `$${fmt(data.summary.bestFdv)}` : "—"} tone="text-honey" />
          </div>
          {data.coins.length ? (
            <div className="overflow-x-auto rounded-2xl border border-line bg-panel">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">
                    <th className="px-4 py-2.5">Coin</th>
                    <th className="px-3 py-2.5">Created</th>
                    <th className="px-3 py-2.5 text-right">FDV</th>
                    <th className="px-3 py-2.5 text-right">Liquidity</th>
                    <th className="px-4 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.coins.map((c) => (
                    <tr key={c.mint} className="border-b border-line/60 last:border-0 hover:bg-panel-2/50">
                      <td className="px-4 py-2.5">
                        <Link href={`/scan/${c.mint}`} className="font-semibold hover:text-honey">
                          {c.symbol ? `$${c.symbol}` : short(c.mint)}
                        </Link>
                        {c.name && <span className="ml-2 text-xs text-muted">{c.name}</span>}
                      </td>
                      <td className="num px-3 py-2.5 text-xs text-muted">{timeAgo(c.createdAt)}</td>
                      <td className="num px-3 py-2.5 text-right">{c.fdv ? `$${fmt(c.fdv)}` : "—"}</td>
                      <td className="num px-3 py-2.5 text-right">{c.liq ? `$${fmt(c.liq)}` : "—"}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn("rounded border px-1.5 py-px text-[11px] font-semibold", STATUS[c.status].c)}>{STATUS[c.status].t}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-2xl border border-line bg-panel px-4 py-8 text-center text-sm text-muted">No coins created by this wallet were found on pump.fun.</div>
          )}
          <p className="mt-3 text-xs text-muted">
            Coins from Helius-parsed create transactions (up to the last 300), launch and graduation counts from pump.fun bonding curves, market from DexScreener, rugs and dumps from our Track Record. Refreshed every 6 hours. Not financial advice.
          </p>
        </>
      )}
    </>
  );
}
