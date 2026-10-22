// Первые покупатели на странице скана: первые 20 кошельков после запуска, через сколько секунд купили, сколько
// (% эмиссии), сколько держат сейчас и что сделали: держат, докупили, продали часть или всё, вывели на другой кошелёк.
// Кто вывел токены на один и тот же кошелёк, помечен общей группой. Чего не видно, так и пишем: unknown.

export type BuyerStatus = "holding" | "added" | "sold_part" | "sold_all" | "moved" | "unknown";
export interface FirstBuyersData {
  buyers: { wallet: string; afterSec?: number; boughtPct: number; leftPct?: number; status: BuyerStatus; to?: string; group?: number }[];
  groups: { to: string; wallets: number }[];
  window: string;
  partial?: boolean;
}

const ADDR: Record<string, string> = { solana: "https://solscan.io/account/", bsc: "https://bscscan.com/address/", base: "https://basescan.org/address/", robinhood: "https://robin.etherscan.io/address/" };
const STATUS: Record<BuyerStatus, { label: string; cls: string }> = {
  holding: { label: "holding", cls: "text-lime" },
  added: { label: "added", cls: "text-lime" },
  sold_part: { label: "sold part", cls: "text-honey" },
  sold_all: { label: "sold all", cls: "text-danger" },
  moved: { label: "moved out", cls: "text-violet" },
  unknown: { label: "unknown", cls: "text-muted" },
};
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const after = (s?: number) => (s === undefined ? "?" : s < 60 ? `+${s}s` : s < 3600 ? `+${Math.floor(s / 60)}m ${s % 60}s` : `+${Math.floor(s / 3600)}h`);
const pc = (n: number) => `${n < 0.01 && n > 0 ? "<0.01" : n.toFixed(2)}%`;

export function FirstBuyers({ f, chain, className }: { f?: FirstBuyersData; chain: string; className?: string }) {
  if (!f?.buyers.length) return null;
  const link = (w: string) => (ADDR[chain] ? ADDR[chain] + w : undefined);
  const count = (s: BuyerStatus) => f.buyers.filter((b) => b.status === s).length;
  return (
    <div className={`rounded-lg border border-line bg-panel-2/50 p-3 text-xs ${className ?? ""}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">First {f.buyers.length} buyers</span>
        <span className="text-[10px] text-muted">{f.window} after launch · creator not counted</span>
      </div>
      <p className="mt-1 text-muted">
        {count("holding") + count("added")} still holding · {count("sold_part") + count("sold_all")} sold · {count("moved")} moved out
        {count("unknown") ? ` · ${count("unknown")} unknown` : ""}
      </p>
      {!!f.groups.length && (
        <ul className="mt-1.5 space-y-0.5">
          {f.groups.map((g, i) => (
            <li key={g.to} className="text-violet">
              Group {i + 1}: {g.wallets} buyers sent tokens to{" "}
              <a href={link(g.to)} target="_blank" rel="noreferrer" className="num hover:underline">
                {short(g.to)}
              </a>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[22rem] text-left">
          <thead className="text-[10px] text-muted uppercase">
            <tr>
              <th className="py-1 pr-2 font-normal">#</th>
              <th className="py-1 pr-2 font-normal">Wallet</th>
              <th className="py-1 pr-2 font-normal">Time</th>
              <th className="py-1 pr-2 text-right font-normal">Bought</th>
              <th className="py-1 pr-2 text-right font-normal">Now</th>
              <th className="py-1 font-normal">Since</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {f.buyers.map((b, i) => (
              <tr key={b.wallet}>
                <td className="num py-1 pr-2 text-muted">{i + 1}</td>
                <td className="py-1 pr-2">
                  <a href={link(b.wallet)} target="_blank" rel="noreferrer" className="num hover:underline">
                    {short(b.wallet)}
                  </a>
                  {b.group && <span className="ml-1 rounded border border-violet/40 px-1 text-[10px] text-violet">G{b.group}</span>}
                </td>
                <td className="num py-1 pr-2 text-muted">{after(b.afterSec)}</td>
                <td className="num py-1 pr-2 text-right">{pc(b.boughtPct)}</td>
                <td className="num py-1 pr-2 text-right">{b.leftPct === undefined ? "?" : pc(b.leftPct)}</td>
                <td className={`py-1 ${STATUS[b.status].cls}`}>
                  {STATUS[b.status].label}
                  {b.to && (
                    <a href={link(b.to)} target="_blank" rel="noreferrer" className="num ml-1 text-muted hover:underline">
                      to {short(b.to)}
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {f.partial && <p className="mt-1.5 text-[10px] text-muted">Outgoing transfers were read only for part of the wallets or blocks: where a drop could not be explained, the status is unknown.</p>}
    </div>
  );
}
