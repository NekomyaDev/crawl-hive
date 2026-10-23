"use client";
// Live Auto Trading: страница торгового кошелька. Данные и действия в /api/live (live-trader.ts, live-wallets.ts).
// Шаги: создать торговый кошелёк и пополнить, выбрать стратегии и размер, дальше панель позиций, вывод на свой
// кошелёк и выдача ключа (только со свежей подписью). Ключ живёт в состоянии, пока открыто окно, и стирается при закрытии.
// Date.now() в рендере нет (cacheComponents): все времена приходят с сервера.
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import qrcode from "qrcode-generator";
import { AlertTriangle, Copy, ExternalLink, KeyRound, Power, ShieldAlert, X } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardHeader, Stat } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useWallet } from "@/components/wallet-provider";
import { useApi } from "@/lib/client/use-api";
import { post } from "@/lib/client/api";
import { useViewerTier } from "@/lib/client/use-tier";
import { TOKEN } from "@/lib/token";
import { cn, short } from "@/lib/utils";
import type { liveStatus } from "@/lib/server/live-trader";

type Live = Awaited<ReturnType<typeof liveStatus>>;
type Wallet = NonNullable<Live["wallet"]>;
type Position = Wallet["open"][number];
type StrategyInfo = Live["strategies"][number];

const solTxt = (n: number | null | undefined, d = 4) => (n == null ? "-" : `${Number(n.toFixed(d))} SOL`);
const signed = (n: number | null | undefined) => (n == null ? "-" : `${n > 0 ? "+" : n < 0 ? "-" : ""}${Number(Math.abs(n).toFixed(4))} SOL`);
const tone = (n: number | null | undefined) => (n == null || n === 0 ? "text-muted" : n > 0 ? "text-lime" : "text-danger");
const when = (ts: number | null | undefined) =>
  ts ? new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "-";
const txUrl = (sig: string) => `https://solscan.io/tx/${sig}`;
const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

function exitsText(x: StrategyInfo["exits"]) {
  if (!x) return "";
  const parts = [
    x.tpPct != null && `TP +${x.tpPct}%`,
    x.slPct != null && `SL -${x.slPct}%`,
    x.partial && `sell ${x.partial.sellPct}% at +${x.partial.atPct}%`,
    x.trailPct != null && `trail ${x.trailPct}%${x.trailArmPct ? ` after +${x.trailArmPct}%` : ""}`,
    `max ${x.maxHoldMin < 60 ? `${x.maxHoldMin}m` : `${Math.round(x.maxHoldMin / 6) / 10}h`}`,
  ];
  return parts.filter(Boolean).join(" · ");
}

// ---------- мелкие части ----------

function ModeBadge({ mode }: { mode: Live["mode"] }) {
  if (mode === "off") return null;
  return mode === "dryrun" ? (
    <span className="inline-flex flex-col rounded-lg border border-honey/50 bg-honey/10 px-3 py-1.5 text-left">
      <span className="text-xs font-black tracking-wide text-honey">DRY RUN</span>
      <span className="text-[11px] text-honey/80">trades are simulated, no swaps are sent</span>
    </span>
  ) : (
    <span className="inline-flex flex-col rounded-lg border border-danger/60 bg-danger/10 px-3 py-1.5 text-left">
      <span className="text-xs font-black tracking-wide text-danger">LIVE</span>
      <span className="text-[11px] text-danger/80">real swaps with real SOL</span>
    </span>
  );
}

function Disclaimer({ fees }: { fees: Live["fees"] }) {
  return (
    <p className="text-[11px] leading-relaxed text-muted">
      Not financial advice. Memecoins are extremely risky and can go to zero. Past paper results do not promise live results. CrawlHive takes {fees.profitFeePct}% of profit on
      winning trades only, never on losses; {fees.buybackSharePct}% of every fee is marked for ${TOKEN.symbol} buyback and burn.
    </p>
  );
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const toast = useToast();
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() =>
        navigator.clipboard
          .writeText(text)
          .then(() => toast("Copied"))
          .catch(() => toast("Copy failed, select the text instead", "error"))
      }
    >
      <Copy className="size-3.5" /> {label}
    </Button>
  );
}

// QR адреса пополнения: qrcode-generator считает матрицу, рисуем её одним path в SVG.
function Qr({ text, size = 168 }: { text: string; size?: number }) {
  const d = useMemo(() => {
    const q = qrcode(0, "M");
    q.addData(text);
    q.make();
    const n = q.getModuleCount();
    let path = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) path += `M${c + 4} ${r + 4}h1v1h-1z`;
    return { n: n + 8, path };
  }, [text]);
  return (
    <svg viewBox={`0 0 ${d.n} ${d.n}`} width={size} height={size} className="rounded-lg bg-white" role="img" aria-label="Deposit address QR code" shapeRendering="crispEdges">
      <path d={d.path} fill="#000" />
    </svg>
  );
}

function Modal({ title, children, onClose }: { title: ReactNode; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-md rounded-xl border border-line bg-panel p-5" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <button onClick={onClose} className="absolute top-3 right-3 text-muted hover:text-fg" aria-label="Close">
          <X className="size-4" />
        </button>
        <div className="mb-3 pr-6 font-semibold">{title}</div>
        {children}
      </div>
    </div>
  );
}

function Confirm({ title, text, action, danger, onYes, onClose }: { title: string; text: ReactNode; action: string; danger?: boolean; onYes: () => Promise<void> | void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose}>
      <div className="mb-4 text-sm text-muted">{text}</div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant={danger ? "danger" : "primary"}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onYes();
              onClose();
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Working..." : action}
        </Button>
      </div>
    </Modal>
  );
}

// Запрос с тостом об ошибке: true, если прошёл.
function useAct() {
  const toast = useToast();
  return async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | null> => {
    try {
      const r = await fn();
      if (ok) toast(ok);
      return r;
    } catch (e) {
      toast((e as Error).message, "error");
      return null;
    }
  };
}

// ---------- шаг 1: торговый кошелёк ----------

function DepositCard({ live, wallet }: { live: Live; wallet: Wallet }) {
  return (
    <Card>
      <CardHeader title="1. Trading wallet" sub="Send SOL to this address to fund live trades." />
      <div className="flex flex-col gap-4 p-4 sm:flex-row">
        <div className="shrink-0 self-center">
          <Qr text={wallet.pubkey} />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <Label>Deposit address (Solana)</Label>
            <div className="num rounded-lg border border-line bg-panel-2 px-3 py-2 text-xs break-all">{wallet.pubkey}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <CopyButton text={wallet.pubkey} label="Copy address" />
              <a href={`https://solscan.io/account/${wallet.pubkey}`} target="_blank" rel="noreferrer">
                <Button variant="ghost" size="sm">
                  <ExternalLink className="size-3.5" /> Solscan
                </Button>
              </a>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>
              Balance: <b className="num">{wallet.balanceSol == null ? "unknown" : solTxt(wallet.balanceSol)}</b>
            </span>
            <span className="text-muted">
              Cap {live.caps.maxWalletSol} SOL · keeps {live.caps.feeReserveSol} SOL for fees
            </span>
          </div>
          <div className="flex gap-2 rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              This is a hot wallet run by CrawlHive. Only deposit what you can afford to lose. Memecoins can go to zero. You can withdraw to your own wallet or export the key at any
              time.
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}

function CreateWallet({ live, onDone }: { live: Live; onDone: () => void }) {
  const act = useAct();
  const [busy, setBusy] = useState(false);
  return (
    <Card>
      <CardHeader title="1. Create your trading wallet" sub="One server-side Solana wallet per connected wallet. Its key is encrypted at rest and never shown in the API." />
      <div className="space-y-3 p-4">
        <div className="flex gap-2 rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            This is a hot wallet run by CrawlHive. Only deposit what you can afford to lose. Memecoins can go to zero. You can withdraw to your own wallet or export the key at any time.
          </span>
        </div>
        <Button
          disabled={busy || !live.ready}
          onClick={async () => {
            setBusy(true);
            await act(() => post("/api/live/wallet"), "Trading wallet created");
            setBusy(false);
            onDone();
          }}
        >
          {busy ? "Creating..." : "Create trading wallet"}
        </Button>
      </div>
    </Card>
  );
}

// ---------- шаг 2: настройки ----------

function SettingsCard({ live, wallet, onDone }: { live: Live; wallet: Wallet; onDone: () => void }) {
  const act = useAct();
  const s = wallet.settings;
  const [enabled, setEnabled] = useState(s.enabled);
  const [picked, setPicked] = useState<string[]>(s.strategies);
  const [size, setSize] = useState(String(s.tradeSol));
  const [slip, setSlip] = useState(String(s.slippagePct));
  const [busy, setBusy] = useState(false);
  // Сервер прислал другие настройки (сохранили на другом устройстве): подтягиваем.
  const key = JSON.stringify(s);
  useEffect(() => {
    setEnabled(s.enabled);
    setPicked(s.strategies);
    setSize(String(s.tradeSol));
    setSlip(String(s.slippagePct));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const c = live.caps;
  const sizeN = Number(size);
  const slipN = Number(slip);
  const sizeBad = !(sizeN >= c.minTradeSol && sizeN <= c.maxTradeSol);
  const slipBad = !(slipN >= 0.5 && slipN <= c.maxSlippagePct);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <Card>
      <CardHeader
        title="2. Settings"
        sub="When a picked strategy opens a paper position, the engine buys the same coin with your trading wallet and sells when the strategy exits."
        action={
          <button
            type="button"
            onClick={() => setEnabled((v) => !v)}
            className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold", enabled ? "border-lime/60 bg-lime/15 text-lime" : "border-line text-muted")}
            aria-pressed={enabled}
          >
            <Power className="size-3.5" /> {enabled ? "Enabled" : "Disabled"}
          </button>
        }
      />
      <div className="space-y-4 p-4">
        {wallet.paused && (
          <div className="rounded-lg border border-honey/40 bg-honey/10 p-3 text-xs text-honey">
            Trading is paused{wallet.pausedReason ? ` (${wallet.pausedReason})` : ""}. Saving with Enabled on resumes it.
          </div>
        )}
        <div>
          <Label hint="pick one or more">Strategies</Label>
          <div className="grid gap-2 md:grid-cols-3">
            {live.strategies.map((st) => {
              const on = picked.includes(st.id);
              return (
                <div key={st.id} className={cn("rounded-lg border transition", on ? "border-honey/70 bg-honey/10" : "border-line hover:border-honey/40")}>
                  <button type="button" onClick={() => toggle(st.id)} className="block w-full p-3 pb-1 text-left" aria-pressed={on}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">
                        {st.id.toUpperCase()} {st.label}
                      </span>
                      <span className={cn("size-3 shrink-0 rounded-full border", on ? "border-honey bg-honey" : "border-line")} />
                    </div>
                    {st.note && <div className="mt-1 text-[11px] text-muted">{st.note}</div>}
                    {st.exits && <div className="num mt-1 text-[11px] text-fg/80">{exitsText(st.exits)}</div>}
                  </button>
                  <Link href="/paper" className="mx-3 mb-2.5 inline-block text-[11px] text-lime hover:underline">
                    Paper stats for {st.id.toUpperCase()}
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label hint={`${c.minTradeSol} to ${c.maxTradeSol} SOL`}>Trade size (SOL)</Label>
            <Input type="number" inputMode="decimal" step="0.01" min={c.minTradeSol} max={c.maxTradeSol} value={size} onChange={(e) => setSize(e.target.value)} className={cn(sizeBad && "border-danger/60")} />
          </div>
          <div>
            <Label hint={`0.5 to ${c.maxSlippagePct}%`}>Slippage %</Label>
            <Input type="number" inputMode="decimal" step="0.5" min={0.5} max={c.maxSlippagePct} value={slip} onChange={(e) => setSlip(e.target.value)} className={cn(slipBad && "border-danger/60")} />
          </div>
        </div>
        <p className="text-[11px] text-muted">
          Limits: up to {c.maxOpen} open positions, new entries stop after a {c.dailyLossSol} SOL realized loss in a UTC day, buys with price impact above the cap are skipped. Sells retry with
          higher slippage if needed.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={busy || sizeBad || slipBad || (enabled && !picked.length)}
            onClick={async () => {
              setBusy(true);
              await act(() => post("/api/live/settings", { enabled, strategies: picked, tradeSol: sizeN, slippagePct: slipN }), "Settings saved");
              setBusy(false);
              onDone();
            }}
          >
            {busy ? "Saving..." : "Save settings"}
          </Button>
          {enabled && !picked.length && <span className="text-xs text-danger">Pick at least one strategy to enable trading.</span>}
        </div>
      </div>
    </Card>
  );
}

// ---------- панель ----------

const STATUS_CLS: Record<string, string> = { opening: "text-sky", open: "text-lime", closing: "text-honey", closed: "text-muted", failed: "text-danger" };

function TxLinks({ p }: { p: Position }) {
  return (
    <span className="flex gap-2">
      {p.buySig ? (
        <a href={txUrl(p.buySig)} target="_blank" rel="noreferrer" className="text-sky hover:underline">
          buy
        </a>
      ) : (
        p.mode === "dryrun" && <span className="text-muted">sim</span>
      )}
      {p.sellSig && (
        <a href={txUrl(p.sellSig)} target="_blank" rel="noreferrer" className="text-sky hover:underline">
          sell
        </a>
      )}
    </span>
  );
}

function OpenPositions({ wallet, onDone }: { wallet: Wallet; onDone: () => void }) {
  const act = useAct();
  const [ask, setAsk] = useState<null | { all: true } | { id: number; symbol: string }>(null);
  const rows = wallet.open;
  return (
    <Card>
      <CardHeader
        title={`Open positions (${rows.length})`}
        action={
          rows.length > 0 && (
            <Button variant="danger" size="sm" onClick={() => setAsk({ all: true })}>
              Close all
            </Button>
          )
        }
      />
      {rows.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-muted">No open positions.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="num w-full min-w-[640px] text-xs">
            <thead className="text-left text-muted">
              <tr className="border-b border-line">
                <th className="px-4 py-2 font-medium">Token</th>
                <th className="px-2 py-2 font-medium">Strategy</th>
                <th className="px-2 py-2 text-right font-medium">Size</th>
                <th className="px-2 py-2 font-medium">Entry</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2 font-medium">Tx</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2">
                    <Link href={`/scan/${p.token}`} className="font-semibold text-fg hover:text-honey">
                      ${p.symbol}
                    </Link>
                    {p.mode === "dryrun" && <span className="ml-1.5 rounded bg-honey/15 px-1 text-[9px] font-bold text-honey">DRY</span>}
                  </td>
                  <td className="px-2 py-2">{p.strategy.toUpperCase()}</td>
                  <td className="px-2 py-2 text-right">{solTxt(p.solIn ?? p.tradeSol)}</td>
                  <td className="px-2 py-2">{when(p.entryAt ?? p.createdAt)}</td>
                  <td className={cn("px-2 py-2", STATUS_CLS[p.status])}>
                    {p.status}
                    {p.sellAttempts > 0 && <span className="text-danger"> · {p.sellAttempts} failed sells</span>}
                    {p.lastError && <div className="max-w-[220px] truncate text-[10px] text-muted" title={p.lastError}>{p.lastError}</div>}
                  </td>
                  <td className="px-2 py-2">
                    <TxLinks p={p} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    {(p.status === "open" || p.status === "opening") && (
                      <Button variant="outline" size="sm" onClick={() => setAsk({ id: p.id, symbol: p.symbol })}>
                        Close
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {ask && (
        <Confirm
          title={"all" in ask ? "Close all positions?" : `Close $${ask.symbol}?`}
          text={"all" in ask ? "Every open position is sold at market right away. A buy still in flight is sold as soon as it confirms." : "This position is sold at market right away."}
          action={"all" in ask ? "Close all" : "Close"}
          danger
          onClose={() => setAsk(null)}
          onYes={async () => {
            const r = await act(() => post<{ queued: number }>("/api/live/close", "all" in ask ? { all: true } : { positionId: ask.id }));
            if (r) onDone();
          }}
        />
      )}
    </Card>
  );
}

function History({ wallet }: { wallet: Wallet }) {
  const rows = wallet.history;
  return (
    <Card>
      <CardHeader title="History" sub="Last 50 closed or failed trades." />
      {rows.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-muted">No trades yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="num w-full min-w-[700px] text-xs">
            <thead className="text-left text-muted">
              <tr className="border-b border-line">
                <th className="px-4 py-2 font-medium">Token</th>
                <th className="px-2 py-2 font-medium">Strategy</th>
                <th className="px-2 py-2 text-right font-medium">In</th>
                <th className="px-2 py-2 text-right font-medium">Out</th>
                <th className="px-2 py-2 text-right font-medium">P&amp;L</th>
                <th className="px-2 py-2 text-right font-medium">Fee</th>
                <th className="px-2 py-2 font-medium">Exit</th>
                <th className="px-4 py-2 font-medium">Tx</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2">
                    <span className="font-semibold">${p.symbol}</span>
                    {p.mode === "dryrun" && <span className="ml-1.5 rounded bg-honey/15 px-1 text-[9px] font-bold text-honey">DRY</span>}
                  </td>
                  <td className="px-2 py-2">{p.strategy.toUpperCase()}</td>
                  <td className="px-2 py-2 text-right">{solTxt(p.solIn)}</td>
                  <td className="px-2 py-2 text-right">{solTxt(p.solOut)}</td>
                  <td className={cn("px-2 py-2 text-right font-semibold", tone(p.pnlSol))}>{p.status === "failed" ? <span className="text-danger">failed</span> : signed(p.pnlSol)}</td>
                  <td className="px-2 py-2 text-right text-muted">{p.feeSol ? solTxt(p.feeSol) : "-"}</td>
                  <td className="px-2 py-2">
                    {p.status === "failed" ? <span className="text-[11px] text-muted" title={p.lastError ?? ""}>{(p.lastError ?? "buy failed").slice(0, 60)}</span> : <>{p.exitReason ?? "-"} · {when(p.exitAt)}</>}
                  </td>
                  <td className="px-4 py-2">
                    <TxLinks p={p} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Summary({ live, wallet }: { live: Live; wallet: Wallet }) {
  const t = wallet.totals;
  const today = wallet.today;
  const line = (k: string) => (t[k] ? `${t[k].trades} trades · fees ${solTxt(t[k].feesSol)}` : "no trades yet");
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Live P&L" value={<span className={tone(t.live?.pnlSol)}>{signed(t.live?.pnlSol ?? 0)}</span>} hint={line("live")} tone="coral" />
      <Stat label="Dry run P&L" value={<span className={tone(t.dryrun?.pnlSol)}>{signed(t.dryrun?.pnlSol ?? 0)}</span>} hint={line("dryrun")} tone="honey" />
      <Stat
        label="Today (UTC)"
        value={<span className={tone(today.pnlSol)}>{signed(today.pnlSol)}</span>}
        hint={today.lossLimitHit ? <span className="text-danger">Loss limit hit, entries resume {when(today.resumesAt)}</span> : `daily loss limit ${live.caps.dailyLossSol} SOL`}
        tone="sky"
      />
      <Stat label="Pending fees" value={solTxt(wallet.pendingFeesSol)} hint="paid from profit on next transfer" tone="violet" />
    </div>
  );
}

function Notices({ wallet }: { wallet: Wallet }) {
  if (!wallet.notices.length) return null;
  return (
    <Card>
      <CardHeader title="Notices" />
      <ul className="divide-y divide-line/60 text-xs">
        {wallet.notices.map((n, i) => (
          <li key={`${n.at}-${i}`} className="flex gap-3 px-4 py-2">
            <span className="num shrink-0 text-muted">{when(n.at)}</span>
            <span>{n.text}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---------- вывод ----------

function Withdraw({ wallet, owner, onDone }: { wallet: Wallet; owner: string; onDone: () => void }) {
  const act = useAct();
  // Токены из позиций кошелька: их и предлагаем, плюс любой минт вручную.
  const tokens = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of [...wallet.open, ...wallet.history]) if (!m.has(p.token)) m.set(p.token, p.symbol);
    return [...m];
  }, [wallet.open, wallet.history]);
  const [asset, setAsset] = useState("SOL");
  const [mint, setMint] = useState("");
  const [amount, setAmount] = useState("");
  const [all, setAll] = useState(false);
  const [ask, setAsk] = useState(false);
  const realAsset = asset === "other" ? mint.trim() : asset;
  const ok = !!realAsset && (all || Number(amount) > 0);
  return (
    <Card>
      <CardHeader title="Withdraw" sub="Always to your own connected wallet. Pending fees are settled in the same transaction." />
      <div className="space-y-3 p-4">
        <div>
          <Label>Destination</Label>
          <div className="num rounded-lg border border-line bg-panel-2 px-3 py-2 text-xs break-all">{owner}</div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Asset</Label>
            <select value={asset} onChange={(e) => setAsset(e.target.value)} className="h-9 w-full rounded-lg border border-line bg-panel-2 px-3 text-sm outline-none focus:border-honey/60">
              <option value="SOL">SOL</option>
              {tokens.map(([t, s]) => (
                <option key={t} value={t}>
                  ${s} ({short(t)})
                </option>
              ))}
              <option value="other">Other token (paste mint)</option>
            </select>
          </div>
          <div>
            <Label hint={asset === "SOL" ? "in SOL" : "in tokens"}>Amount</Label>
            <div className="flex items-center gap-2">
              <Input type="number" inputMode="decimal" min={0} step="any" value={all ? "" : amount} disabled={all} placeholder={all ? "everything" : "0.0"} onChange={(e) => setAmount(e.target.value)} />
              <label className="flex shrink-0 items-center gap-1.5 text-xs">
                <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> All
              </label>
            </div>
          </div>
        </div>
        {asset === "other" && <Input placeholder="Token mint address" value={mint} onChange={(e) => setMint(e.target.value)} />}
        <Button disabled={!ok} onClick={() => setAsk(true)}>
          Withdraw
        </Button>
      </div>
      {ask && (
        <Confirm
          title="Confirm withdrawal"
          text={
            <>
              Send {all ? "all" : amount} {asset === "SOL" ? "SOL" : "tokens"} to <span className="num break-all text-fg">{owner}</span>?
            </>
          }
          action="Withdraw"
          onClose={() => setAsk(false)}
          onYes={async () => {
            const r = await act(() => post<{ confirmed: boolean; sig: string }>("/api/live/withdraw", { asset: realAsset, amount: all ? "all" : amount.trim() }));
            if (r) {
              setAmount("");
              setAll(false);
              onDone();
            }
          }}
        />
      )}
    </Card>
  );
}

// ---------- выдача ключа ----------

function ExportKey({ wallet }: { wallet: Wallet }) {
  const { signMessage } = useWallet();
  const act = useAct();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<{ pubkey: string; key: string } | null>(null);
  // Ключ в состоянии только пока открыто окно: закрыли или прошло 2 минуты: стёрли (уход со страницы снимает компонент).
  useEffect(() => {
    if (!secret) return;
    const t = setTimeout(() => setSecret(null), 120_000);
    return () => clearTimeout(t);
  }, [secret]);

  const run = async () => {
    setBusy(true);
    const r = await act(async () => {
      const n = await post<{ nonce: string; message: string }>("/api/live/export/nonce");
      const sig = await signMessage(new TextEncoder().encode(n.message));
      return post<{ pubkey: string; secretKey: string }>("/api/live/export", { confirm: true, nonce: n.nonce, signature: toB64(sig) });
    });
    setBusy(false);
    setTyped("");
    setUnderstood(false);
    if (r) setSecret({ pubkey: r.pubkey, key: r.secretKey });
  };

  return (
    <Card>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold">
        <span className="flex items-center gap-2">
          <KeyRound className="size-4 text-muted" /> Advanced
        </span>
        <span className="text-xs text-muted">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-line p-4">
          <div className="font-semibold">Export private key</div>
          <div className="flex gap-2 rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              Anyone with this key controls the trading wallet and its funds. Never paste it into a website or share it with anyone, including CrawlHive support. The export is logged
              and you get a Telegram alert. {wallet.exportsLeftToday} exports left today.
            </span>
          </div>
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" className="mt-0.5" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
            I understand the key gives full control of the trading wallet.
          </label>
          <div>
            <Label hint="then sign a message with your wallet">Type EXPORT to confirm</Label>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="EXPORT" autoComplete="off" spellCheck={false} />
          </div>
          <Button variant="danger" disabled={busy || typed !== "EXPORT" || !understood || wallet.exportsLeftToday <= 0} onClick={run}>
            {busy ? "Waiting for signature..." : "Sign and export key"}
          </Button>
        </div>
      )}
      {secret && (
        <Modal title="Trading wallet private key" onClose={() => setSecret(null)}>
          <div className="mb-3 flex gap-2 rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            <span>Shown once. It is cleared when you close this window. Import it into Phantom (base58 private key) and store it offline.</span>
          </div>
          <Label>Address</Label>
          <div className="num mb-3 text-xs break-all text-muted">{secret.pubkey}</div>
          <Label>Private key (base58)</Label>
          <div className="num mb-3 rounded-lg border border-line bg-panel-2 px-3 py-2 text-xs break-all select-all">{secret.key}</div>
          <div className="flex justify-between gap-2">
            <CopyButton text={secret.key} label="Copy key" />
            <Button onClick={() => setSecret(null)}>Done, clear it</Button>
          </div>
        </Modal>
      )}
    </Card>
  );
}

// ---------- админ ----------

function AdminPanel({ admin, onDone }: { admin: NonNullable<Live["admin"]>; onDone: () => void }) {
  const act = useAct();
  const [ask, setAsk] = useState<null | "kill" | "close">(null);
  const killOn = admin.kill.on;
  return (
    <Card className="border-violet/40">
      <CardHeader title="Admin" sub="Visible only to admin wallets." />
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Wallets" value={admin.wallets} hint={`${admin.enabled} enabled`} />
          <Stat label="Open positions" value={admin.openPositions} hint={`${admin.stuckSells} with failed sells`} />
          <Stat label="Fees paid" value={solTxt(admin.feesPaidSol)} hint={`${solTxt(admin.feesPendingSol)} pending`} />
          <Stat label="Buyback marked" value={solTxt(admin.buybackMarkedSol)} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className={cn("text-sm font-semibold", killOn ? "text-danger" : "text-lime")}>Kill switch {killOn ? `ON since ${when(admin.kill.at)}` : "off"}</span>
          <Button variant={killOn ? "outline" : "danger"} size="sm" onClick={() => setAsk("kill")}>
            {killOn ? "Resume new entries" : "Stop new entries"}
          </Button>
          <Button variant="danger" size="sm" onClick={() => setAsk("close")}>
            Close every position
          </Button>
        </div>
      </div>
      {ask && (
        <Confirm
          title={ask === "kill" ? (killOn ? "Resume live trading?" : "Turn on the kill switch?") : "Close every open position for every user?"}
          text={ask === "kill" ? (killOn ? "New entries start again for everyone." : "No new entries for anyone. Open positions stay until they exit or are closed.") : "This also turns the kill switch on. Every open position is sold at market."}
          action="Confirm"
          danger={ask === "close" || !killOn}
          onClose={() => setAsk(null)}
          onYes={async () => {
            const r = await act(() => post("/api/live/admin", ask === "kill" ? { kill: !killOn } : { kill: true, closeAll: true }), "Done");
            if (r) onDone();
          }}
        />
      )}
    </Card>
  );
}

// ---------- страница ----------

function Gate({ icon, title, text, children }: { icon?: ReactNode; title: string; text: ReactNode; children?: ReactNode }) {
  return (
    <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      {icon}
      <div className="font-semibold">{title}</div>
      <div className="max-w-md text-sm text-muted">{text}</div>
      {children}
    </Card>
  );
}

export function LiveView() {
  const { address, signedIn, mode: walletMode, connect, signIn } = useWallet();
  const tier = useViewerTier();
  const { data: live, error, reload } = useApi<Live>(signedIn ? `/api/live?w=${address}` : "/api/live", 15_000);

  const header = (
    <PageHeader
      title={
        <>
          Live Auto Trading <span className="ml-1 rounded bg-lime/15 px-1.5 py-0.5 align-middle text-xs font-bold text-lime">BETA</span>
        </>
      }
      sub="Your own trading wallet follows the strongest paper strategies with real swaps on Jupiter. Holders only."
      action={live && <ModeBadge mode={live.mode} />}
    />
  );

  if (!live)
    return (
      <>
        {header}
        <Card className="px-6 py-12 text-center text-sm text-muted">{error ? `Could not load live trading: ${error}` : "Loading..."}</Card>
      </>
    );

  if (live.mode === "off")
    return (
      <>
        {header}
        <Gate
          icon={<Power className="size-8 text-honey" />}
          title="Live auto trading is coming soon"
          text="Holders will get a personal trading wallet that copies the most consistent paper strategies with real swaps, with stops, daily loss limits and withdrawals any time. Until it is switched on, follow the strategies on paper."
        >
          <Link href="/paper">
            <Button>See paper trading results</Button>
          </Link>
        </Gate>
        <div className="mt-4">
          <Disclaimer fees={live.fees} />
        </div>
      </>
    );

  const wallet = live.wallet;
  let body: ReactNode;
  if (!address) body = <Gate icon={<KeyRound className="size-8 text-honey" />} title="Connect your wallet" text="Sign in with your Solana wallet to set up live trading."><Button onClick={() => connect()}>Connect wallet</Button></Gate>;
  else if (!signedIn) body = <Gate title="Sign in to continue" text="Signing is a free message, not a transaction."><Button onClick={() => signIn().catch(() => {})}>Sign in</Button></Gate>;
  else if (walletMode === "evm") body = <Gate title="Solana wallet needed" text="Live trading runs on Solana. Connect Phantom to use it." />;
  else if (!wallet && tier.loading) body = <Card className="px-6 py-12 text-center text-sm text-muted">Checking your tier...</Card>;
  else if (!wallet && !tier.at("holder"))
    body = (
      <Gate icon={<ShieldAlert className="size-8 text-honey" />} title="Holder tier needed" text={`Live auto trading is for $${TOKEN.symbol} holders. Hold enough $${TOKEN.symbol} to reach the Holder tier, then come back.`}>
        <Link href="/pricing">
          <Button>See tiers</Button>
        </Link>
      </Gate>
    );
  else if (!wallet) body = <CreateWallet live={live} onDone={reload} />;
  else
    body = (
      <div className="space-y-4">
        {!tier.loading && !tier.at("holder") && (
          <div className="rounded-lg border border-honey/40 bg-honey/10 p-3 text-xs text-honey">
            Your wallet is below the Holder tier, so new entries are skipped. You can still close positions and withdraw. <Link href="/pricing" className="underline">See tiers</Link>
          </div>
        )}
        <Summary live={live} wallet={wallet} />
        <div className="grid gap-4 xl:grid-cols-2">
          <DepositCard live={live} wallet={wallet} />
          <SettingsCard live={live} wallet={wallet} onDone={reload} />
        </div>
        <OpenPositions wallet={wallet} onDone={reload} />
        <Notices wallet={wallet} />
        <History wallet={wallet} />
        <div className="grid gap-4 xl:grid-cols-2">
          <Withdraw wallet={wallet} owner={address} onDone={reload} />
          <ExportKey wallet={wallet} />
        </div>
      </div>
    );

  return (
    <>
      {header}
      <div className="space-y-4">
        {!live.ready && (
          <div className="rounded-lg border border-honey/40 bg-honey/10 p-3 text-xs text-honey">Live trading is not fully set up on this server yet: {live.reason ?? "unknown reason"}.</div>
        )}
        {live.kill.on && <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs text-danger">New entries are paused by the admin. Open positions can still be closed and funds withdrawn.</div>}
        <Disclaimer fees={live.fees} />
        {body}
        {live.admin && <AdminPanel admin={live.admin} onDone={reload} />}
        <Disclaimer fees={live.fees} />
      </div>
    </>
  );
}
