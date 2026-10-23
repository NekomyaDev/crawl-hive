"use client";
// Crawler Arena: личные бумажные стратегии холдеров соревнуются вживую в дневных раундах (arena.ts, api/arena).
// Главное: гоночная дорожка, где каждый краулер стоит на своей полосе пропорционально P&L (ноль посередине,
// минус влево), и плавно едет при изменении счёта. Искры при прибыльном закрытии, череп при руге. Ниже таблица,
// лента событий, таймер раунда и победители прошлых раундов с раскрытыми правилами.
// Данные: GET /api/arena раз в 10 с плюс SSE /api/arena/stream (события сразу в ленту и анимацию, затем перечитать счёт).
// Время только из ответа сервера и эффектов: Date.now() в рендере ломает пререндер с cacheComponents.
// Только бумага: настоящих сделок, ставок и денежных призов нет.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Lock, Swords, Timer, Trophy, Wallet } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useWallet } from "@/components/wallet-provider";
import { patch, post } from "@/lib/client/api";
import { useApi } from "@/lib/client/use-api";
import { describeUserConfig } from "@/lib/user-strategy-config";
import { cn } from "@/lib/utils";
import type { ArenaData, ArenaFeedEvent, ArenaMe } from "@/lib/server/arena";
import type { MyStrategy } from "@/lib/server/user-strategies";

type Data = ArenaData & { me: ArenaMe | null; admin: boolean };
type Entry = ArenaData["entries"][number];
type Fx = { kind: "win" | "loss" | "rug" | "buy" | "join"; key: number };

const money = (n: number) => `${n > 0 ? "+" : n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;
const pctS = (n: number | null) => (n == null ? "" : `${n > 0 ? "+" : ""}${n.toFixed(1)}%`);
const tone = (n: number) => (n > 0 ? "text-lime" : n < 0 ? "text-danger" : "text-muted");
const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const ago = (now: number | null, at: number) => {
  if (now == null) return "";
  const s = Math.max(0, Math.round((now - at) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`;
};
const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const hm = (t: number) => new Date(t).toISOString().slice(11, 16);

// ---------- краулер ----------

// Спрут из логотипа, мантия и ноги в цвет заявки. Один и тот же блик (id статичный, дубли безвредны).
export function ArenaCrawler({ color, size = 40, walk = false, dim = false }: { color: string; size?: number; walk?: boolean; dim?: boolean }) {
  const legs = [
    "M23.5 29 L13 18.5 C8 22 5 26 6 30.5",
    "M24.5 33 L11.5 29 C7.5 33.5 5.5 38 7 42.5",
    "M27 35.5 L17 41 C13.5 45 12.5 49.5 14.5 53.5",
    "M30 36.5 L25.5 46 C23.5 50 23.5 54.5 26.5 57.5",
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className={cn(walk && "arena-bob", dim && "opacity-40")}>
      <defs>
        <radialGradient id="arena-crawler-hl" cx="38%" cy="28%" r="70%">
          <stop offset="0" stopColor="#fff" stopOpacity=".6" />
          <stop offset=".55" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity=".28" />
        </radialGradient>
      </defs>
      <g fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.8">
        {legs.map((d) => (
          <path key={d} d={d} />
        ))}
        <g transform="matrix(-1 0 0 1 64 0)">
          {legs.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
      </g>
      <path d="M20 27.5 C20 14.5 25.5 7.5 32 7.5 C38.5 7.5 44 14.5 44 27.5 C44 33.5 38.6 37.5 32 37.5 C25.4 37.5 20 33.5 20 27.5Z" fill={color} />
      <path d="M20 27.5 C20 14.5 25.5 7.5 32 7.5 C38.5 7.5 44 14.5 44 27.5 C44 33.5 38.6 37.5 32 37.5 C25.4 37.5 20 33.5 20 27.5Z" fill="url(#arena-crawler-hl)" />
      <g fill="#07080a">
        <circle cx="27.6" cy="26" r="3.6" />
        <circle cx="36.4" cy="26" r="3.6" />
        <circle cx="24.6" cy="20.6" r="1.5" />
        <circle cx="29.4" cy="19.2" r="1.7" />
        <circle cx="34.6" cy="19.2" r="1.7" />
        <circle cx="39.4" cy="20.6" r="1.5" />
      </g>
      <g fill="#fff" opacity=".9">
        <circle cx="28.6" cy="25" r="1.05" />
        <circle cx="37.4" cy="25" r="1.05" />
      </g>
    </svg>
  );
}

// Искры по кругу: смещения заранее, без случайности в рендере.
const SPARKS = Array.from({ length: 10 }, (_, i) => {
  const a = (i / 10) * Math.PI * 2;
  const r = 26 + (i % 3) * 6;
  return { dx: `${Math.round(Math.cos(a) * r)}px`, dy: `${Math.round(Math.sin(a) * r)}px`, c: ["#a3e635", "#facc15", "#ffb020", "#5eead4"][i % 4] };
});

function Effect({ fx }: { fx: Fx }) {
  if (fx.kind === "win")
    return (
      <span className="pointer-events-none absolute left-1/2 top-1/2">
        {SPARKS.map((s, i) => (
          <i key={i} className="arena-spark absolute -ml-1 -mt-1 block size-2 rounded-full" style={{ background: s.c, ["--dx" as string]: s.dx, ["--dy" as string]: s.dy }} />
        ))}
      </span>
    );
  if (fx.kind === "rug")
    return (
      <span className="arena-puff pointer-events-none absolute -top-2 left-1/2 text-2xl">
        💀
      </span>
    );
  if (fx.kind === "loss")
    return (
      <span className="arena-puff pointer-events-none absolute -top-1 left-1/2 text-lg">
        💨
      </span>
    );
  return <span className={cn("arena-ping pointer-events-none absolute inset-0 rounded-full border-2", fx.kind === "buy" ? "border-lime" : "border-honey")} />;
}

// ---------- дорожка ----------

const LANES_SHOWN = 12;

function Track({ entries, fx, lite }: { entries: Entry[]; fx: Map<number, Fx>; lite: boolean }) {
  const [all, setAll] = useState(false);
  // Масштаб от самого далёкого краулера (не меньше $20): лидер почти у края, остальные пропорционально.
  const scale = Math.max(20, ...entries.map((e) => Math.abs(e.pnl)));
  const shown = all ? entries : entries.slice(0, LANES_SHOWN);
  return (
    <Card className="mb-5 overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2 text-[11px] uppercase tracking-wider text-muted">
        <span className="text-danger">◀ losing</span>
        <span>$0</span>
        <span className="text-lime">winning ▶</span>
      </div>
      <div className="divide-y divide-line/60">
        {!entries.length && (
          <div className="relative h-20 bg-gradient-to-r from-danger/5 via-transparent to-lime/5">
            <div className="absolute inset-y-0 left-1/2 border-l border-dashed border-line" />
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <ArenaCrawler color="#6b7280" size={44} dim />
            </div>
            <p className="absolute inset-x-0 bottom-1.5 text-center text-xs text-muted">No crawlers on the track yet. Holders can enter below.</p>
          </div>
        )}
        {shown.map((e) => {
          const pos = 50 + Math.max(-1, Math.min(1, e.pnl / scale)) * 42;
          const f = fx.get(e.id);
          return (
            <div key={e.id} className="sm:grid sm:grid-cols-[170px_1fr]">
              <div className="flex min-w-0 items-center gap-2 px-3 pt-2 sm:py-2">
                <span className="num w-5 shrink-0 text-xs text-muted">{e.rank}</span>
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: e.color }} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold" title={e.name}>
                    {e.name}
                  </div>
                  <div className="num truncate text-[10px] text-muted">{e.owner}</div>
                </div>
              </div>
              <div className="relative h-12 bg-gradient-to-r from-danger/[0.07] via-transparent to-lime/[0.07] sm:h-14">
                <div className="absolute inset-y-0 left-1/2 border-l border-dashed border-line" />
                <div className="arena-run absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${pos}%` }}>
                  <div className="relative flex flex-col items-center">
                    <ArenaCrawler color={e.color} size={lite ? 30 : 40} walk={!lite} />
                    {f && (!lite || f.kind === "rug") && <Effect key={f.key} fx={f} />}
                  </div>
                </div>
                <span
                  className={cn("num absolute top-1/2 -translate-y-1/2 text-xs font-bold", tone(e.pnl), e.pnl >= 0 ? "left-2" : "right-2")}
                  title={`Closed ${money(e.realized)}, open ${money(e.unrealized)}`}
                >
                  {money(e.pnl)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {entries.length > LANES_SHOWN && (
        <button type="button" onClick={() => setAll(!all)} className="w-full border-t border-line py-2 text-xs text-honey hover:underline">
          {all ? "Show the top lanes only" : `Show all ${entries.length} lanes`}
        </button>
      )}
    </Card>
  );
}

// ---------- таблица и лента ----------

function Champion({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-honey/15 px-1 py-px text-[9px] font-bold text-honey" title="Arena champion: won a past round">
      🏆 CHAMPION{n > 1 ? ` x${n}` : ""}
    </span>
  );
}

function lastText(e: Entry) {
  const l = e.last;
  if (!l) return "-";
  if (l.kind === "open") return `bought $${l.symbol}`;
  return `${l.reason === "rug" ? "rugged on" : "closed"} $${l.symbol}${l.reason === "rug" ? "" : ` ${pctS(l.netPct)}`}`;
}

function Board({ entries, now }: { entries: Entry[]; now: number | null }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Leaderboard" sub="Closed trades plus open positions marked at the last price. Ties go to fewer trades." />
      {entries.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wider text-muted">
              <tr className="border-b border-line">
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Crawler</th>
                <th className="hidden px-3 py-2 md:table-cell">Owner</th>
                <th className="px-3 py-2 text-right">P&amp;L</th>
                <th className="px-3 py-2 text-right">Trades</th>
                <th className="hidden px-3 py-2 text-right sm:table-cell">Open</th>
                <th className="hidden px-3 py-2 lg:table-cell">Last trade</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-line/60 last:border-0">
                  <td className="num px-3 py-2 text-muted">{e.rank === 1 ? "🥇" : e.rank === 2 ? "🥈" : e.rank === 3 ? "🥉" : e.rank}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <ArenaCrawler color={e.color} size={22} />
                      <div className="min-w-0">
                        <div className="flex items-center font-semibold">
                          <span className="truncate">{e.name}</span>
                          <Champion n={e.champion} />
                        </div>
                        <div className="text-[11px] text-muted">{e.rules}</div>
                      </div>
                    </div>
                  </td>
                  <td className="num hidden px-3 py-2 text-xs text-muted md:table-cell">{e.owner}</td>
                  <td className={cn("num px-3 py-2 text-right font-bold", tone(e.pnl))}>
                    {money(e.pnl)}
                    {e.open > 0 && <div className="text-[10px] font-normal text-muted">open {money(e.unrealized)}</div>}
                  </td>
                  <td className="num px-3 py-2 text-right">{e.trades}</td>
                  <td className="num hidden px-3 py-2 text-right sm:table-cell">{e.open}</td>
                  <td className="hidden px-3 py-2 text-xs text-muted lg:table-cell">
                    {lastText(e)}
                    {e.last && <div className="text-[10px]">{ago(now, e.last.at)}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="p-4 text-sm text-muted">Nobody has entered this round yet.</p>
      )}
    </Card>
  );
}

const REASON_TEXT: Record<string, (n: string) => string> = {
  tp: (n) => `took profit ${n} on`,
  sl: (n) => `hit the stop ${n} on`,
  trail: (n) => `trailed out ${n} on`,
  time: (n) => `timed out ${n} on`,
  removed: (n) => `closed ${n} on`,
};
function eventLine(e: ArenaFeedEvent) {
  if (e.kind === "join") return { icon: "🐙", text: "entered the arena" };
  if (e.kind === "open") return { icon: "🟢", text: "bought" };
  if (e.reason === "rug") return { icon: "💀", text: "got rugged on" };
  const n = pctS(e.netPct);
  const icon = (e.pnl ?? 0) > 0 ? (e.reason === "tp" ? "💥" : "✅") : e.reason === "sl" ? "🛑" : "📉";
  return { icon, text: (REASON_TEXT[e.reason ?? "removed"] ?? REASON_TEXT.removed)(n) };
}

function Feed({ events, now }: { events: ArenaFeedEvent[]; now: number | null }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Live feed" sub="Every buy and exit of the crawlers in this round." />
      {events.length ? (
        <ul className="max-h-[420px] divide-y divide-line/60 overflow-y-auto">
          {events.map((e) => {
            const l = eventLine(e);
            return (
              <li key={e.id} className="flex items-start gap-2 px-4 py-2 text-sm">
                <span className="shrink-0">{l.icon}</span>
                <span className="min-w-0 flex-1">
                  <b style={{ color: e.color }}>{e.name}</b> {l.text}{" "}
                  {e.symbol && e.token && (
                    <Link href={`/scan/${e.token}`} className="font-semibold hover:underline">
                      ${e.symbol}
                    </Link>
                  )}
                </span>
                <span className="shrink-0 text-[10px] text-muted">{ago(now, e.at)}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="p-4 text-sm text-muted">Quiet so far. Crawlers buy when a Launch Radar verdict matches their rules.</p>
      )}
    </Card>
  );
}

// ---------- вход ----------

function EnterPanel({ data, onEntered }: { data: Data; onEntered: () => void }) {
  const { address, signedIn, connect, signIn } = useWallet();
  const toast = useToast();
  const me = signedIn ? data.me : null;
  const want = !!me && me.holder && !me.entry && data.round.entriesOpen;
  const mine = useApi<{ list: MyStrategy[] }>(want ? `/api/paper/mine?w=${address}` : null);
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = mine.data?.list ?? [];
  const chosen = pick ?? list[0]?.id ?? null;

  const enter = async () => {
    if (!chosen) return;
    setBusy(true);
    try {
      const r = await post<{ name: string }>("/api/arena", { strategy: chosen });
      toast(`${r.name} is on the track`);
      onEntered();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  let body: ReactNode;
  if (!signedIn)
    body = (
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => (address ? signIn() : connect()).catch(() => {})}>
          <Wallet className="size-4" /> {address ? "Sign in to enter" : "Connect wallet to enter"}
        </Button>
        <span className="text-xs text-muted">Watching is free for everyone.</span>
      </div>
    );
  else if (!me) body = <p className="text-sm text-muted">Checking your tier…</p>;
  else if (me.entry)
    body = (
      <div className="flex items-center gap-3">
        <ArenaCrawler color={me.entry.color} size={36} walk />
        <div>
          <div className="font-semibold">You are racing with {me.entry.name}</div>
          <p className="text-xs text-muted">Its rules are frozen for this round. Edits in the builder apply from your next entry.</p>
        </div>
      </div>
    );
  else if (!me.holder)
    body = (
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/pricing" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-honey px-4 text-sm font-semibold text-black hover:bg-[#ffc24d]">
          <Lock className="size-4" /> Unlock with Holder
        </Link>
        <span className="text-xs text-muted">Entering needs the Holder tier or higher. Watching is free.</span>
      </div>
    );
  else if (!data.round.entriesOpen)
    body = <p className="text-sm text-muted">Entries for this round closed at {hm(data.round.entryCloseAt)} UTC. The next round opens at 00:00 UTC.</p>;
  else if (mine.loading && !mine.data) body = <p className="text-sm text-muted">Loading your strategies…</p>;
  else if (!list.length)
    body = (
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/paper/builder" className="inline-flex h-9 items-center rounded-lg bg-honey px-4 text-sm font-semibold text-black hover:bg-[#ffc24d]">
          Build your first strategy
        </Link>
        <span className="text-xs text-muted">The arena races strategies from the Strategy builder.</span>
      </div>
    );
  else
    body = (
      <div>
        <div className="mb-2 text-xs text-muted">Enter with:</div>
        <div className="mb-3 flex flex-wrap gap-2">
          {list.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setPick(s.id)}
              className={cn("max-w-full rounded-lg border px-3 py-2 text-left transition-colors", chosen === s.id ? "border-honey/70 bg-honey/10" : "border-line hover:border-honey/40")}
            >
              <div className="text-sm font-semibold">{s.name}</div>
              <div className="text-[11px] text-muted">{describeUserConfig(s.config)}</div>
            </button>
          ))}
        </div>
        <Button onClick={enter} disabled={busy || !chosen}>
          <Swords className="size-4" /> Enter the arena
        </Button>
        <p className="mt-2 text-[11px] text-muted">
          Your rules freeze for the round: later edits in the builder do not change this entry. Others see the name and a short summary now, the full rules after the round ends. One entry per wallet, no
          withdrawals.
        </p>
      </div>
    );

  return (
    <Card className="p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Swords className="size-4 text-coral" /> Your crawler
      </h2>
      {body}
    </Card>
  );
}

function PrizeNoteForm({ value, onSaved }: { value: string | null; onSaved: () => void }) {
  const toast = useToast();
  const [v, setV] = useState(value ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mt-3 flex gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await patch("/api/arena", { note: v });
          toast("Prize note saved");
          onSaved();
        } catch (err) {
          toast((err as Error).message, "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      <Input value={v} onChange={(e) => setV(e.target.value)} placeholder="Admin: prize note for this round (text only)" maxLength={200} />
      <Button type="submit" size="sm" variant="outline" disabled={busy} className="h-9 shrink-0">
        Save
      </Button>
    </form>
  );
}

// ---------- прошлые раунды ----------

function Past({ past }: { past: Data["past"] }) {
  if (!past.length) return null;
  return (
    <div className="mb-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Trophy className="size-4 text-honey" /> Past winners
      </h2>
      <div className="grid gap-3 md:grid-cols-2">
        {past.map((r) => (
          <Card key={r.id} className="p-4">
            <div className="mb-2 flex items-center justify-between text-xs text-muted">
              <span className="num">{day(r.startAt)}</span>
              <span>
                {r.entries} crawler{r.entries === 1 ? "" : "s"}
              </span>
            </div>
            {r.winner ? (
              <div className="flex items-start gap-3">
                <ArenaCrawler color={r.winner.color} size={44} />
                <div className="min-w-0">
                  <div className="flex items-center font-semibold">
                    🏆 {r.winner.name}
                    <Champion n={r.winner.champion} />
                  </div>
                  <div className="num text-[11px] text-muted">
                    {r.winner.owner} · <span className={tone(r.winner.pnl)}>{money(r.winner.pnl)}</span> · {r.winner.trades} trades
                  </div>
                  <div className="mt-1 text-xs">{r.winner.rules}</div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted">No champion: it takes at least 2 crawlers and a finish in profit.</p>
            )}
            {r.top.filter((e) => e.id !== r.winner?.id).length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-line/60 pt-2 text-xs">
                {r.top
                  .filter((e) => e.id !== r.winner?.id)
                  .map((e) => (
                    <li key={e.id}>
                      <span className="text-muted">#{e.rank}</span> <b style={{ color: e.color }}>{e.name}</b> <span className={cn("num", tone(e.pnl))}>{money(e.pnl)}</span>
                      <div className="text-[11px] text-muted">{e.rules}</div>
                    </li>
                  ))}
              </ul>
            )}
            {r.prizeNote && <p className="mt-2 text-[11px] text-honey">{r.prizeNote}</p>}
          </Card>
        ))}
      </div>
    </div>
  );
}

// ---------- страница ----------

export function ArenaView() {
  const { address, signedIn } = useWallet();
  const { data, error, reload } = useApi<Data>(signedIn ? `/api/arena?w=${address}` : "/api/arena", 10_000);
  const [live, setLive] = useState<ArenaFeedEvent[]>([]);
  const [fx, setFx] = useState<Map<number, Fx>>(new Map());
  const [now, setNow] = useState<number | null>(null);
  const [lite, setLite] = useState(false);
  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  });

  // Часы по серверу: смещение берём из ответа, тикаем раз в секунду.
  const serverNow = data?.now;
  useEffect(() => {
    if (serverNow == null) return;
    const off = serverNow - Date.now();
    setNow(Date.now() + off);
    const t = setInterval(() => setNow(Date.now() + off), 1000);
    return () => clearInterval(t);
  }, [serverNow]);

  // Телефон и reduced motion: меньше краулеры, без покачивания и искр.
  useEffect(() => {
    const mq = [window.matchMedia("(prefers-reduced-motion: reduce)"), window.matchMedia("(max-width: 639px)")];
    const upd = () => setLite(mq.some((m) => m.matches));
    upd();
    mq.forEach((m) => m.addEventListener("change", upd));
    return () => mq.forEach((m) => m.removeEventListener("change", upd));
  }, []);

  // Новый раунд: живые события прошлого не тащим.
  const roundId = data?.round.id;
  useEffect(() => setLive([]), [roundId]);

  const flash = useCallback((entry: number, kind: Fx["kind"]) => {
    const key = Math.random();
    setFx((m) => new Map(m).set(entry, { kind, key }));
    setTimeout(
      () =>
        setFx((m) => {
          if (m.get(entry)?.key !== key) return m;
          const n = new Map(m);
          n.delete(entry);
          return n;
        }),
      1500,
    );
  }, []);

  // SSE: событие сразу в ленту и анимацию, счёт перечитываем чуть позже (серверный кэш 5 с).
  useEffect(() => {
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      es = new EventSource("/api/arena/stream");
    } catch {
      return;
    }
    es.onmessage = (m) => {
      let msg: { type: string; event?: ArenaFeedEvent };
      try {
        msg = JSON.parse(m.data);
      } catch {
        return;
      }
      const e = msg.type === "arena" ? msg.event : undefined;
      if (!e) return;
      setLive((xs) => [e, ...xs.filter((x) => x.id !== e.id)].slice(0, 40));
      flash(e.entry, e.kind === "join" ? "join" : e.kind === "open" ? "buy" : e.reason === "rug" ? "rug" : (e.pnl ?? 0) > 0 ? "win" : "loss");
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void reloadRef.current(), 5500);
    };
    return () => {
      if (timer) clearTimeout(timer);
      es?.close();
    };
  }, [flash]);

  const events = useMemo(() => {
    const byId = new Map<number, ArenaFeedEvent>();
    for (const e of [...live, ...(data?.events ?? [])]) if (!byId.has(e.id)) byId.set(e.id, e);
    return [...byId.values()].sort((a, b) => b.id - a.id).slice(0, 40);
  }, [live, data?.events]);

  const entries = data?.entries ?? [];
  const r = data?.round;

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Swords className="size-7 text-coral" /> Crawler Arena
          </span>
        }
        sub="Holders' crawlers race each other live on paper. Every crawler is a Strategy builder strategy, trading the same Launch Radar verdicts with $100 per trade and the same fees, slippage and rug rules. The further right, the more it made today."
        action={
          <Link href="/paper/builder" className="text-sm text-honey hover:underline">
            Strategy builder
          </Link>
        }
      />
      <p className="-mt-3 mb-5 text-xs text-coral">Paper money only. No real trades, no betting, no money prizes. Not financial advice.</p>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted">
            <Timer className="size-3.5" /> Round ends in
          </div>
          <div className="num mt-1 text-2xl font-bold">{r && now != null ? clock(r.endAt - now) : "…"}</div>
          <div className="text-[11px] text-muted">{r ? `Daily round ${day(r.startAt)}, 00:00 to 24:00 UTC` : ""}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-muted">Entries</div>
          <div className={cn("mt-1 text-2xl font-bold", r?.entriesOpen ? "text-lime" : "text-muted")}>{r ? (r.entriesOpen && now != null ? clock(r.entryCloseAt - now) : "Closed") : "…"}</div>
          <div className="text-[11px] text-muted">
            {r ? `${entries.length} of ${data?.rules.maxEntries} crawlers. ${r.entriesOpen ? "Entry closes" : "Closed"} at ${hm(r.entryCloseAt)} UTC` : ""}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-muted">Champion gets</div>
          <div className="mt-1 text-lg font-bold">🏆 Arena champion badge</div>
          <div className="text-[11px] text-muted">{data ? `+${data.rules.perk.ask} Ask questions a day for ${data.rules.perk.days} days` : ""}</div>
          {r?.prizeNote && <div className="mt-1 text-xs text-honey">{r.prizeNote}</div>}
        </Card>
      </div>

      {error && !data && <p className="mb-5 text-sm text-danger">{error}</p>}
      {data && !data.enabled && <p className="mb-5 text-sm text-coral">The paper engine is paused right now: crawlers do not trade until it is back.</p>}

      {data ? <Track entries={entries} fx={fx} lite={lite} /> : <div className="mb-5 h-48 animate-pulse rounded-xl bg-panel-2/40" />}

      {data && (
        <div className="mb-5">
          <EnterPanel data={data} onEntered={() => void reload()} />
          {data.admin && <PrizeNoteForm value={data.round.prizeNote} onSaved={() => void reload()} />}
        </div>
      )}

      <div className="mb-5 grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <Board entries={entries} now={now} />
        <Feed events={events} now={now} />
      </div>

      {data && <Past past={data.past} />}

      <p className="text-xs text-muted">
        How it works: a round runs from 00:00 to 24:00 UTC. Holders enter with one of their builder strategies until {data ? data.rules.entryWindowMin / 60 : 2}h after the start, one entry per wallet, up to{" "}
        {data?.rules.maxEntries ?? 100} crawlers. At entry the rules are copied and frozen, so edits later do not change the race. The score is the paper P&L of trades the entry opened in the round plus open
        positions at the last price; ties go to fewer trades. When the round ends the score is final and open positions are closed outside the score. The winner needs at least{" "}
        {data?.rules.minEntriesForChampion ?? 2} crawlers in the round and a profit, and gets the Arena champion badge and the perk above. Full rules of every finisher are revealed after the round so everyone can learn.
        All personal strategies and arena entries share one engine cap of open positions. Results are simulated and real trading would do worse.
      </p>
    </>
  );
}
