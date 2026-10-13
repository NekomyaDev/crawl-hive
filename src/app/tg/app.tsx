"use client";
// CrawlHive внутри Telegram: скан, Launch Radar, список наблюдения, свои краулеры, Track Record.
// Пользователя узнаём по initData от Telegram (подпись проверяет сервер), список наблюдения общий с ботом.
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Bell, Bug, ClipboardPaste, Eye, Radar, ScanSearch, Share2, Target, Trash2, X as XIcon } from "lucide-react";
import { VerdictPill, pct } from "@/components/verdict";
import { cn, fmt, short, timeAgo } from "@/lib/utils";

// ---------- Telegram WebApp ----------

interface TgWebApp {
  initData: string;
  initDataUnsafe: { start_param?: string; user?: { first_name?: string } };
  colorScheme: "light" | "dark";
  ready(): void;
  expand(): void;
  setHeaderColor(c: string): void;
  setBackgroundColor(c: string): void;
  disableVerticalSwipes?(): void;
  openLink(url: string): void;
  openTelegramLink(url: string): void;
  switchInlineQuery?(q: string, types?: string[]): void;
  HapticFeedback?: { impactOccurred(s: string): void; notificationOccurred(t: "success" | "warning" | "error"): void; selectionChanged(): void };
  BackButton?: { show(): void; hide(): void; onClick(f: () => void): void; offClick(f: () => void): void };
  isVersionAtLeast?(v: string): boolean;
}
const tgApp = () => (typeof window !== "undefined" ? (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp : undefined);
const haptic = (t: "success" | "warning" | "error" | "tap") => {
  const h = tgApp()?.HapticFeedback;
  if (!h) return;
  if (t === "tap") h.selectionChanged();
  else h.notificationOccurred(t);
};
const SITE = typeof window !== "undefined" ? window.location.origin : "https://crawlhive.xyz";
const openExternal = (url: string) => (tgApp()?.initData ? tgApp()!.openLink(url) : window.open(url, "_blank"));

async function tgApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", "x-tg-init": tgApp()?.initData ?? "", ...init.headers },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

// ---------- типы ----------

interface Factor {
  label: string;
  impact: number;
  note: string;
}
interface ScanRes {
  id: string;
  chain: string;
  symbol: string;
  name: string;
  score: number | null;
  verdict: string;
  reason: string;
  factors: Factor[];
  market?: { priceUsd?: number; liquidityUsd?: number; fdv?: number; ageHours?: number; volume1h?: number };
}
interface Me {
  user: { id: number; name: string; username: string | null };
  wallets: string[];
  watchlist: { id: string; chain: string; symbol: string; verdict: string; at: number; changePct: number | null; liq: number | null; liq0: number; alerted: string[]; gone: boolean }[];
  prefs: { alerts: { on: boolean; mode: "clean" | "all"; minLiq: number }; followups: boolean };
  crawlers: { id: string; name: string; source: string; status: string; tier: string; reputation: number; signals: number; hits: number; scored: number; expiresAt: number | null }[];
  signals: { id: string; crawlerName: string; kind: string; ticker: string; text: string; ts: number; token?: { address: string }; outcome?: { status: string; peakPct?: number; changePct?: number }; jev?: { p: number }; bot?: { take: string } }[];
}
type Tab = "scan" | "radar" | "watch" | "crawlers" | "track";

const CHAIN: Record<string, string> = { solana: "SOL", robinhood: "RH" };
const RING: Record<string, string> = { CLEAN: "#b6f23a", OK: "#b6f23a", RISKY: "#ffb020", DANGER: "#ef4444", TOO_EARLY: "#8a9099" };

// ---------- скан ----------

function ScoreRing({ score, verdict }: { score: number | null; verdict: string }) {
  const c = RING[verdict] ?? "#8a9099";
  const r = 34;
  const len = 2 * Math.PI * r;
  return (
    <svg width="88" height="88" viewBox="0 0 88 88" className="shrink-0">
      <circle cx="44" cy="44" r={r} fill="none" stroke="#22262c" strokeWidth="7" />
      <circle cx="44" cy="44" r={r} fill="none" stroke={c} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${((score ?? 0) / 100) * len} ${len}`} transform="rotate(-90 44 44)" />
      <text x="44" y="50" textAnchor="middle" className="num" fontSize="22" fontWeight="700" fill={c}>
        {score ?? "—"}
      </text>
    </svg>
  );
}

function ScanView({ initial, inTg, onWatched }: { initial: string | null; inTg: boolean; onWatched: () => void }) {
  const [q, setQ] = useState("");
  const [net, setNet] = useState<"solana" | "robinhood">("solana");
  const [logs, setLogs] = useState<string[]>([]);
  const [res, setRes] = useState<ScanRes | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [watched, setWatched] = useState<string | null>(null);
  const es = useRef<EventSource | null>(null);

  const scan = useCallback(
    (input: string) => {
      const v = input.trim();
      if (!v) return;
      es.current?.close();
      setQ(v);
      setRes(null);
      setErr(null);
      setWatched(null);
      setLogs(["crawl " + (v.length > 20 ? short(v) : v)]);
      setBusy(true);
      haptic("tap");
      const src = new EventSource(`/api/scan?q=${encodeURIComponent(v)}&chain=${v.startsWith("0x") ? "robinhood" : net}`);
      es.current = src;
      src.onmessage = (m) => {
        const e = JSON.parse(m.data);
        if (e.type === "log") setLogs((l) => [...l.slice(-5), `${e.crawler} · ${e.text}`]);
        else if (e.type === "result") {
          setRes(e.result);
          setBusy(false);
          haptic(e.result.verdict === "DANGER" ? "error" : e.result.verdict === "RISKY" ? "warning" : "success");
        } else if (e.type === "done" || e.type === "error") {
          if (e.type === "error") {
            setErr(e.message);
            haptic("error");
          }
          setBusy(false);
          src.close();
        }
      };
      src.onerror = () => {
        setBusy(false);
        src.close();
      };
    },
    [net],
  );

  useEffect(() => {
    if (initial) scan(initial);
  }, [initial]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => es.current?.close(), []);

  const paste = async () => {
    try {
      const t = (await navigator.clipboard.readText()).trim();
      if (t) scan(t);
    } catch {
      // буфер обмена недоступен — пользователь вставит руками
    }
  };

  const watch = async () => {
    if (!res) return;
    try {
      await tgApi("/api/tg/watch", { method: "POST", body: JSON.stringify({ id: res.id }) });
      setWatched(res.id);
      haptic("success");
      onWatched();
    } catch (e) {
      setErr((e as Error).message);
      haptic("error");
    }
  };

  const share = () => {
    if (!res) return;
    const t = tgApp();
    if (t?.switchInlineQuery && t.isVersionAtLeast?.("6.7")) t.switchInlineQuery(res.id, ["users", "groups", "channels"]);
    else openExternal(`https://t.me/share/url?url=${encodeURIComponent(`${SITE}/scan/${res.id}`)}`);
  };

  const m = res?.market;
  const flags = (res?.factors ?? []).filter((f) => f.impact !== 0).sort((a, b) => a.impact - b.impact);
  return (
    <div className="space-y-3">
      {!res && !busy && (
        <div className="relative overflow-hidden rounded-2xl border border-line">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/tg/hero.jpg" alt="" className="aspect-[21/9] w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/40 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-3">
            <div className="text-lg font-bold leading-tight">
              Send the <span className="text-gradient">swarm</span> after any memecoin
            </div>
            <div className="text-[11px] text-fg/70">Holders, bundles, dev history, copycats. Solana and Robinhood Chain.</div>
          </div>
        </div>
      )}
      <div className="rounded-2xl border border-line bg-panel p-3">
        <div className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && scan(q)}
            placeholder="Token address, link or $TICKER"
            className="num min-w-0 flex-1 rounded-xl border border-line bg-panel-2 px-3 py-3 text-sm outline-none focus:border-honey/50"
            inputMode="text"
            autoCapitalize="off"
            autoCorrect="off"
          />
          <button onClick={paste} className="grid size-12 shrink-0 place-items-center rounded-xl border border-line text-muted active:bg-panel-2" aria-label="Paste and scan">
            <ClipboardPaste className="size-5" />
          </button>
        </div>
        <div className="mt-2 flex items-center gap-2">
          {(["solana", "robinhood"] as const).map((n) => (
            <button key={n} onClick={() => setNet(n)} className={cn("rounded-lg border px-2.5 py-1 text-xs", net === n ? "border-honey/60 bg-honey/10 text-honey" : "border-line text-muted")}>
              {n === "solana" ? "Solana" : "Robinhood Chain"}
            </button>
          ))}
          <button onClick={() => scan(q)} disabled={busy || !q.trim()} className="ml-auto rounded-xl bg-honey px-5 py-2 text-sm font-semibold text-black disabled:opacity-50">
            {busy ? "Crawling…" : "Crawl"}
          </button>
        </div>
      </div>

      {busy && (
        <div className="num space-y-0.5 rounded-2xl border border-line bg-[#05060a] p-3 text-[11px] text-lime/90">
          {logs.map((l, i) => (
            <div key={i} className="truncate">
              <span className="text-muted">›</span> {l}
            </div>
          ))}
          <div className="animate-pulse text-muted">crawlers at work…</div>
        </div>
      )}
      {err && <div className="rounded-xl border border-danger/40 bg-danger/[0.06] p-3 text-sm text-danger">{err}</div>}

      {res && (
        <div className="overflow-hidden rounded-2xl border border-line bg-panel">
          <div className="flex items-center gap-3 p-4">
            <ScoreRing score={res.score} verdict={res.verdict} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-lg font-bold">${res.symbol}</span>
                <span className="rounded border border-line px-1 text-[10px] text-muted">{CHAIN[res.chain] ?? res.chain}</span>
              </div>
              <VerdictPill verdict={res.verdict} className="mt-1" />
              <p className="mt-1.5 text-sm text-fg/85">{res.reason}</p>
            </div>
          </div>
          {m && (
            <div className="grid grid-cols-3 border-t border-line text-center">
              {[
                ["Liquidity", m.liquidityUsd ? `$${fmt(m.liquidityUsd)}` : "—"],
                ["FDV", m.fdv ? `$${fmt(m.fdv)}` : "—"],
                ["Age", m.ageHours == null ? "—" : m.ageHours < 1 ? `${Math.round(m.ageHours * 60)}m` : m.ageHours < 48 ? `${Math.round(m.ageHours)}h` : `${Math.round(m.ageHours / 24)}d`],
              ].map(([k, v]) => (
                <div key={k} className="border-r border-line py-2.5 last:border-0">
                  <div className="num text-sm font-semibold">{v}</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted">{k}</div>
                </div>
              ))}
            </div>
          )}
          {!!flags.length && (
            <ul className="space-y-1.5 border-t border-line p-4 text-sm">
              {flags.map((f) => (
                <li key={f.label} className="flex gap-2">
                  <span className={cn("num w-9 shrink-0 text-right text-xs font-semibold", f.impact < 0 ? "text-danger" : "text-lime")}>
                    {f.impact > 0 ? "+" : ""}
                    {f.impact}
                  </span>
                  <span className="min-w-0">
                    <b className="font-medium">{f.label}</b> <span className="text-muted">{f.note}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-3 gap-2 border-t border-line p-3">
            <button onClick={watch} disabled={!inTg || watched === res.id} className="flex flex-col items-center gap-1 rounded-xl border border-line py-2 text-xs disabled:opacity-60">
              <Eye className="size-4 text-teal" />
              {watched === res.id ? "Watching" : "Watch"}
            </button>
            <button onClick={share} className="flex flex-col items-center gap-1 rounded-xl border border-line py-2 text-xs">
              <Share2 className="size-4 text-sky" />
              Share
            </button>
            <button onClick={() => openExternal(`${SITE}/scan/${res.id}`)} className="flex flex-col items-center gap-1 rounded-xl border border-line py-2 text-xs">
              <ScanSearch className="size-4 text-honey" />
              Full report
            </button>
          </div>
        </div>
      )}

      {!res && !busy && <RecentScans onPick={scan} />}
    </div>
  );
}

function RecentScans({ onPick }: { onPick: (id: string) => void }) {
  const [rows, setRows] = useState<{ id: string; symbol: string; score: number | null; verdict: string; chain: string; at: number }[]>([]);
  useEffect(() => {
    fetch("/api/scan/recent").then((r) => r.json()).then(setRows).catch(() => {});
  }, []);
  if (!rows.length) return null;
  return (
    <div className="rounded-2xl border border-line bg-panel">
      <div className="border-b border-line px-4 py-2.5 text-xs text-muted">Recently scanned</div>
      {rows.slice(0, 6).map((r) => (
        <button key={r.id} onClick={() => onPick(r.id)} className="flex w-full items-center justify-between border-b border-line/60 px-4 py-2.5 text-left last:border-0 active:bg-panel-2">
          <span className="font-medium">${r.symbol}</span>
          <VerdictPill verdict={r.verdict} score={r.score} />
        </button>
      ))}
    </div>
  );
}

// ---------- Radar ----------

function RadarView({ onPick }: { onPick: (id: string) => void }) {
  const [d, setD] = useState<{ items: { id: string; symbol: string; chain: string; verdict: string; score: number | null; liq: number; fdv: number; ageH: number | null; at: number; reason: string }[]; waiting: number; delayMin: number; day: { scanned: number } } | null>(null);
  useEffect(() => {
    const load = () => fetch("/api/radar").then((r) => r.json()).then(setD).catch(() => {});
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-2xl border border-lime/30 bg-gradient-to-br from-lime/[0.07] to-transparent p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/tg/radar.png" alt="" className="size-20 shrink-0" />
        <div>
        <div className="flex items-center gap-2 font-semibold">
          <Radar className="size-4 text-lime" /> Launch Radar
        </div>
        <p className="mt-1 text-sm text-muted">
          {d ? `${d.day.scanned} fresh launches scanned today by the swarm.` : "Fresh launches scanned by the swarm."} {d?.waiting ? `${d.waiting} newer are live for crawler owners.` : ""}
        </p>
        </div>
      </div>
      <div className="rounded-2xl border border-line bg-panel">
        {(d?.items ?? []).slice(0, 40).map((e) => (
          <button key={e.id} onClick={() => onPick(e.id)} className="flex w-full items-center gap-3 border-b border-line/60 px-4 py-3 text-left last:border-0 active:bg-panel-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-semibold">${e.symbol}</span>
                <span className="rounded border border-line px-1 text-[9px] text-muted">{CHAIN[e.chain] ?? e.chain}</span>
              </div>
              <div className="num truncate text-[11px] text-muted">
                liq ${fmt(e.liq)} · {e.ageH == null ? "" : e.ageH < 1 ? `${Math.round(e.ageH * 60)}m old` : `${e.ageH}h old`} · {timeAgo(e.at)}
              </div>
            </div>
            <VerdictPill verdict={e.verdict} score={e.score} />
          </button>
        ))}
        {d && !d.items.length && <p className="p-6 text-center text-sm text-muted">First launches show up here in a few minutes.</p>}
      </div>
    </div>
  );
}

// ---------- Watchlist ----------

function WatchView({ me, inTg, reload }: { me: Me | null; inTg: boolean; reload: () => void }) {
  if (!inTg) return <OpenInTelegram what="your watchlist" />;
  if (!me) return <p className="p-6 text-center text-sm text-muted">Loading…</p>;
  const a = me.prefs.alerts;
  const setPref = async (patch: object) => {
    haptic("tap");
    await tgApi("/api/tg/prefs", { method: "POST", body: JSON.stringify(patch) }).catch(() => {});
    reload();
  };
  const remove = async (id: string) => {
    haptic("tap");
    await tgApi(`/api/tg/watch?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
    reload();
  };
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-line bg-panel">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Eye className="size-4 text-teal" /> Watching
          </span>
          <span className="text-[11px] text-muted">{me.watchlist.length}/5 · 7 days each</span>
        </div>
        {me.watchlist.map((w) => (
          <div key={w.id} className="flex items-center gap-3 border-b border-line/60 px-4 py-3 last:border-0">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold">${w.symbol}</span>
                <VerdictPill verdict={w.verdict} />
              </div>
              <div className="num text-[11px] text-muted">
                {w.gone ? <span className="text-danger">pair gone</span> : `liq $${fmt(w.liq ?? 0)}`} · since {timeAgo(w.at)}
                {!!w.alerted.length && <span className="text-danger"> · alerted</span>}
              </div>
            </div>
            <span className={cn("num text-sm font-semibold", (w.changePct ?? 0) >= 0 ? "text-lime" : "text-danger")}>{pct(w.changePct)}</span>
            <button onClick={() => remove(w.id)} className="text-muted active:text-danger" aria-label={`Stop watching ${w.symbol}`}>
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
        {!me.watchlist.length && (
          <div className="p-5 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/tg/watch.png" alt="" className="mx-auto size-32" />
            <p className="mt-2 text-sm text-muted">Scan a token and tap Watch. You get a message if liquidity is pulled, the price falls 50% or the verdict turns DANGER.</p>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-line bg-panel p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Bell className="size-4 text-honey" /> Radar alerts
          </span>
          <Toggle on={a.on} onChange={(on) => setPref({ alerts: { on } })} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(["clean", "all"] as const).map((mode) => (
            <Chip key={mode} on={a.mode === mode} onClick={() => setPref({ alerts: { mode } })}>
              {mode === "clean" ? "Clean / OK only" : "All verdicts"}
            </Chip>
          ))}
          {[5_000, 25_000, 100_000].map((v) => (
            <Chip key={v} on={a.minLiq === v} onClick={() => setPref({ alerts: { minLiq: v } })}>
              liq ≥ ${fmt(v)}
            </Chip>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-sm">
          <span>
            24h follow-ups <span className="block text-[11px] text-muted">Did the verdict come true?</span>
          </span>
          <Toggle on={me.prefs.followups} onChange={(on) => setPref({ followups: on })} />
        </div>
      </div>
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)} className={cn("relative h-6 w-11 rounded-full transition-colors", on ? "bg-honey" : "bg-line")}>
      <span className={cn("absolute top-0.5 size-5 rounded-full bg-white shadow transition-all", on ? "left-[22px]" : "left-0.5")} />
    </button>
  );
}
const Chip = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button onClick={onClick} className={cn("rounded-lg border px-2.5 py-1 text-xs", on ? "border-honey/60 bg-honey/10 text-honey" : "border-line text-muted")}>
    {children}
  </button>
);

// ---------- Мои краулеры ----------

function CrawlersView({ me, inTg }: { me: Me | null; inTg: boolean }) {
  if (!inTg) return <OpenInTelegram what="your crawlers" />;
  if (!me) return <p className="p-6 text-center text-sm text-muted">Loading…</p>;
  if (!me.wallets.length)
    return (
      <div className="rounded-2xl border border-honey/30 bg-gradient-to-br from-honey/[0.08] to-transparent p-5 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/tg/hatch.png" alt="" className="mx-auto size-36" />
        <div className="mt-1 font-semibold">Link your wallet once</div>
        <p className="mt-1 text-sm text-muted">Open My Signals on crawlhive.xyz, sign in with your wallet and press Connect Telegram. Your crawlers and their private signals then show up here.</p>
        <button onClick={() => openExternal(`${SITE}/signals`)} className="mt-4 rounded-xl bg-honey px-5 py-2.5 text-sm font-semibold text-black">
          Link wallet on crawlhive.xyz
        </button>
        <button onClick={() => openExternal(`${SITE}/spawn`)} className="mt-2 block w-full text-xs text-honey">
          No crawler yet? Spawn one →
        </button>
      </div>
    );
  return (
    <div className="space-y-3">
      {me.crawlers.map((c) => (
        <div key={c.id} className="rounded-2xl border border-line bg-panel p-4">
          <div className="flex items-center justify-between">
            <span className="font-semibold">{c.name}</span>
            <span className={cn("text-[11px]", c.status === "active" ? "text-lime" : "text-muted")}>{c.status}</span>
          </div>
          <div className="num mt-1 text-[11px] text-muted">
            {c.source} · {c.tier} · rep {c.reputation} · {c.signals} signals · hit {c.scored ? Math.round((c.hits / c.scored) * 100) : 0}%
          </div>
        </div>
      ))}
      <div className="rounded-2xl border border-line bg-panel">
        <div className="border-b border-line px-4 py-2.5 text-sm font-semibold">Latest signals</div>
        {me.signals.map((s) => (
          <div key={s.id} className="border-b border-line/60 px-4 py-3 last:border-0">
            <div className="flex items-center justify-between text-[11px] text-muted">
              <span>{s.crawlerName}</span>
              <span>{timeAgo(s.ts)}</span>
            </div>
            <div className="mt-0.5 text-sm">
              {s.ticker && <b>${s.ticker} </b>}
              {s.text}
            </div>
            <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
              {s.jev && <span className="text-pink">⚡ Jev {Math.round(s.jev.p * 100)}%</span>}
              {s.bot && <span className="text-honey">🐙 {s.bot.take.toUpperCase()}</span>}
              {s.outcome?.status === "hit" && <span className="text-lime">hit peak {pct(s.outcome.peakPct)}</span>}
              {s.outcome?.status === "miss" && <span className="text-danger">miss {pct(s.outcome.changePct)}</span>}
            </div>
          </div>
        ))}
        {!me.signals.length && <p className="p-5 text-center text-sm text-muted">No signals yet. They arrive here and in this chat as soon as a crawler finds something.</p>}
      </div>
    </div>
  );
}

// ---------- Track Record ----------

function TrackView() {
  const [t, setT] = useState<{ total: number; by: { verdict: string; settled: number; dumped: number; tracked: number }[]; signals: { scored: number; hits: number; medianPeak: number | null } } | null>(null);
  useEffect(() => {
    fetch("/api/track").then((r) => r.json()).then(setT).catch(() => {});
  }, []);
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-honey/30 bg-gradient-to-br from-honey/[0.08] to-transparent p-4">
        <div className="flex items-center gap-2 font-semibold">
          <Target className="size-4 text-honey" /> Track Record
        </div>
        <p className="mt-1 text-sm text-muted">Every verdict is checked against the real price for 24 hours. Hits and misses, nothing hidden.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-line bg-panel p-4">
          <div className="num text-2xl font-bold">{t?.total ?? "—"}</div>
          <div className="text-[11px] text-muted">verdicts tracked</div>
        </div>
        <div className="rounded-2xl border border-line bg-panel p-4">
          <div className="num text-2xl font-bold text-lime">{t?.signals.scored ? `${Math.round((t.signals.hits / t.signals.scored) * 100)}%` : "—"}</div>
          <div className="text-[11px] text-muted">crawler signals hit · median peak {pct(t?.signals.medianPeak)}</div>
        </div>
      </div>
      <div className="space-y-2.5 rounded-2xl border border-line bg-panel p-4">
        {(t?.by ?? []).map((b) => {
          const s = b.settled ? Math.round((b.dumped / b.settled) * 100) : null;
          return (
            <div key={b.verdict} className="flex items-center gap-3 text-sm">
              <VerdictPill verdict={b.verdict} className="w-20 justify-center" />
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-line/60">
                <div className={cn("h-full rounded-full", b.verdict === "DANGER" ? "bg-danger" : b.verdict === "RISKY" ? "bg-honey" : "bg-lime")} style={{ width: `${s ?? 0}%` }} />
              </div>
              <span className="num w-24 text-right text-[11px] text-muted">{s == null ? `${b.tracked} tracking` : `${s}% dumped`}</span>
            </div>
          );
        })}
      </div>
      <button onClick={() => openExternal(`${SITE}/track`)} className="w-full rounded-xl border border-line py-2.5 text-sm text-honey">
        Open the full Track Record
      </button>
    </div>
  );
}

function OpenInTelegram({ what }: { what: string }) {
  return (
    <div className="rounded-2xl border border-[#229ED9]/40 bg-[#229ED9]/10 p-5 text-center">
      <div className="font-semibold">Open in Telegram to see {what}</div>
      <a href="https://t.me/crawlhivebot" className="mt-3 inline-block rounded-xl bg-[#229ED9] px-5 py-2.5 text-sm font-semibold text-white">
        Open @crawlhivebot
      </a>
    </div>
  );
}

// ---------- оболочка ----------

const TABS: { id: Tab; label: string; icon: typeof Eye }[] = [
  { id: "scan", label: "Scan", icon: ScanSearch },
  { id: "radar", label: "Radar", icon: Radar },
  { id: "watch", label: "Watch", icon: Eye },
  { id: "crawlers", label: "Crawlers", icon: Bug },
  { id: "track", label: "Track", icon: Target },
];

export function TgApp() {
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>("scan");
  const [inTg, setInTg] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [pick, setPick] = useState<string | null>(params.get("scan"));
  const [name, setName] = useState("");
  const [hideHint, setHideHint] = useState(false);

  const loadMe = useCallback(() => {
    if (!tgApp()?.initData) return;
    tgApi<Me>("/api/tg/me").then(setMe).catch(() => {});
  }, []);

  // Telegram SDK грузится асинхронно: ждём его до 3 секунд, потом работаем как обычная мобильная страница.
  useEffect(() => {
    let tries = 0;
    const t = setInterval(() => {
      const app = tgApp();
      if (app || ++tries > 30) clearInterval(t);
      if (!app) return;
      app.ready();
      app.expand();
      try {
        app.setHeaderColor("#07080a");
        app.setBackgroundColor("#07080a");
        app.disableVerticalSwipes?.();
      } catch {}
      if (app.initData) {
        setInTg(true);
        setName(app.initDataUnsafe.user?.first_name ?? "");
        const sp = app.initDataUnsafe.start_param;
        if (sp?.startsWith("scan_")) setPick(sp.slice(5));
        loadMe();
      }
    }, 100);
    return () => clearInterval(t);
  }, [loadMe]);

  // Кнопка «Назад» Telegram: с любой вкладки возвращает на скан.
  useEffect(() => {
    const bb = tgApp()?.BackButton;
    if (!bb) return;
    const back = () => setTab("scan");
    if (tab !== "scan") {
      bb.show();
      bb.onClick(back);
    } else bb.hide();
    return () => bb.offClick(back);
  }, [tab, inTg]);

  const pickToken = (id: string) => {
    setPick(id + "#" + Date.now()); // одинаковый адрес дважды подряд тоже запускает скан
    setTab("scan");
  };

  return (
    <div data-tg-app className="mx-auto min-h-screen max-w-lg pb-24">
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-line bg-bg/90 px-4 py-3 backdrop-blur">
        <span className="text-xl">🐝</span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="font-bold">
            Crawl<span className="text-honey">Hive</span>
          </div>
          <div className="truncate text-[11px] text-muted">{name ? `Hi ${name} · ` : ""}memecoin crawlers that never sleep</div>
        </div>
        {!inTg && !hideHint && (
          <button onClick={() => setHideHint(true)} className="text-muted" aria-label="Hide">
            <XIcon className="size-4" />
          </button>
        )}
      </header>

      <main className="p-3">
        {tab === "scan" && <ScanView initial={pick ? pick.split("#")[0] : null} inTg={inTg} onWatched={loadMe} key={pick ?? "none"} />}
        {tab === "radar" && <RadarView onPick={pickToken} />}
        {tab === "watch" && <WatchView me={me} inTg={inTg} reload={loadMe} />}
        {tab === "crawlers" && <CrawlersView me={me} inTg={inTg} />}
        {tab === "track" && <TrackView />}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto grid max-w-lg grid-cols-5">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => {
                haptic("tap");
                setTab(id);
              }}
              className={cn("flex flex-col items-center gap-0.5 py-2.5 text-[10px]", tab === id ? "text-honey" : "text-muted")}
            >
              <Icon className="size-5" />
              {label}
              {id === "watch" && !!me?.watchlist.length && <span className="sr-only">{me.watchlist.length} watched</span>}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

