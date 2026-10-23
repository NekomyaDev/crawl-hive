"use client";
// Gem Hunter: ежедневная игра держателей $CRAWLHIVE. Правила простыми словами, таблица дня (сегодня и вчера),
// за всё время, победители дней со ссылкой на транзакцию приза, свои итоги и последние сканы. Данные в api/hunt.
// Админу (флаг admin из api/hunt) у дней без транзакции приза - поле для подписи, запись через POST /api/hunt.
import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Card, CardHeader, Stat } from "@/components/ui/card";
import { VerdictPill } from "@/components/verdict";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/components/wallet-provider";
import { useApi } from "@/lib/client/use-api";
import { post } from "@/lib/client/api";
import { TOKEN } from "@/lib/token";
import { cn, fmt, short, timeAgo, timeLeft } from "@/lib/utils";
import type { HuntBoardRow, HuntData, HuntMe, HuntView, HuntWinner } from "@/lib/server/gem-hunter";

type Data = HuntData & { me: HuntMe | null; admin?: boolean };
type Live = Extract<HuntData, { enabled: true }>;
type Day = Live["today"];

const pts = (n: number) => `${n > 0 ? "+" : ""}${n}`;
const tone = (n: number) => (n > 0 ? "text-lime" : n < 0 ? "text-danger" : "text-muted");
const mult = (m: number | null) => (m == null ? "-" : `x${m >= 10 ? Math.round(m) : m.toFixed(1)}`);
const txHref = (tx: string) => (tx.startsWith("0x") ? `https://robin.etherscan.io/tx/${tx}` : `https://solscan.io/tx/${tx}`);

const OUTCOME: Record<string, { label: string; cls: string }> = {
  open: { label: "tracking", cls: "text-sky" },
  gem: { label: "gem", cls: "text-lime" },
  rug: { label: "rug", cls: "font-semibold text-danger" },
  dump: { label: "down 50%+", cls: "text-coral" },
  flat: { label: "no points", cls: "text-muted" },
  void: { label: "void: bad price", cls: "text-muted" },
};

function Rules({ r }: { r: Live["rules"] | Data["rules"] }) {
  return (
    <Card className="mb-5">
      <CardHeader title="How it works" sub="Plain rules, same for everyone." />
      <div className="grid gap-5 px-4 py-4 text-sm md:grid-cols-2">
        <ul className="list-disc space-y-1.5 pl-4 text-muted">
          <li>
            <span className="text-fg">Who plays:</span> any wallet on the Holder plan or higher (hold ${TOKEN.symbol} worth the Holder threshold, see{" "}
            <Link href="/pricing" className="text-honey hover:underline">
              pricing
            </Link>
            ). Sign in with that wallet on the site, or link it to Telegram and scan in the bot or the mini app.
          </li>
          <li>
            <span className="text-fg">What counts:</span> a scan where our public verdict is CLEAN or OK and the market cap is ${fmt(r.minMcap)} or more at scan time. ${TOKEN.symbol} itself does not count.
          </li>
          <li>
            <span className="text-fg">First finder wins the coin:</span> each coin can be counted once per game day, for the first holder who scans it. Up to {r.dailyCap} counted scans per player per day.
          </li>
          <li>
            <span className="text-fg">Game day:</span> 00:00 to 24:00 UTC, by the time of the scan.
          </li>
        </ul>
        <div>
          <p className="mb-2 text-muted">
            Each counted coin is followed for {r.windowHours} hours with the same price checks as Track Record (every {r.sampleMin} minutes, all pools of the coin, so migrations are followed). Points come from the best confirmed price versus the
            scan price. Confirmed means the price held that level on two checks in a row, so a single wick does not count.
          </p>
          <table className="num w-full max-w-sm text-xs">
            <tbody className="divide-y divide-line/60">
              {r.tiers
                .slice()
                .reverse()
                .map((t, i, all) => (
                  <tr key={t.mult}>
                    <td className="py-1 text-muted">
                      peak x{t.mult}
                      {i === all.length - 1 ? " or more" : ""}
                    </td>
                    <td className="py-1 text-right font-semibold text-lime">{pts(t.points)}</td>
                  </tr>
                ))}
              <tr>
                <td className="py-1 text-muted">rug (liquidity pulled, as Track Record defines it)</td>
                <td className="py-1 text-right font-semibold text-danger">{pts(r.rugPoints)}</td>
              </tr>
              <tr>
                <td className="py-1 text-muted">no peak points and down {Math.abs(r.dumpPct)}% or more at {r.windowHours}h</td>
                <td className="py-1 text-right font-semibold text-coral">{pts(r.dumpPoints)}</td>
              </tr>
              <tr>
                <td className="py-1 text-muted">anything else</td>
                <td className="py-1 text-right text-muted">0</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted">
            A rug costs points even if the coin pumped first. A peak above x{r.maxSaneMult} is almost always a bad price at scan time, so that scan is void. Most points of the day wins; ties go to more scoring finds, then to whoever started first. A day is final {r.windowHours}h after it
            ends, when its last scans settle.
          </p>
        </div>
      </div>
    </Card>
  );
}

function Board({ rows, me, allTime }: { rows: HuntBoardRow[]; me?: string; allTime?: boolean }) {
  if (!rows.length) return <p className="px-4 py-8 text-center text-sm text-muted">No counted scans yet. Scan a coin to get on the board.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="num w-full min-w-[560px] text-xs">
        <thead className="text-left text-muted">
          <tr className="border-b border-line">
            <th className="px-4 py-2 font-medium">#</th>
            <th className="px-2 py-2 font-medium">Hunter</th>
            <th className="px-2 py-2 text-right font-medium">Points</th>
            <th className="px-2 py-2 text-right font-medium">Scans</th>
            <th className="px-2 py-2 text-right font-medium">Tracking</th>
            <th className="px-2 py-2 text-right font-medium">Scoring</th>
            <th className="px-2 py-2 text-right font-medium">Rugs</th>
            <th className="px-2 py-2 text-right font-medium">Best peak</th>
            {allTime && <th className="px-4 py-2 text-right font-medium">Days won</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-line/60">
          {rows.map((r, i) => (
            <tr key={r.wallet} className={cn(r.wallet === me && "bg-honey/[0.06]")}>
              <td className="px-4 py-2 text-muted">{i + 1}</td>
              <td className="px-2 py-2 font-semibold text-fg">
                {short(r.wallet)}
                {r.wallet === me && <span className="ml-1.5 text-[10px] text-honey">you</span>}
              </td>
              <td className={cn("px-2 py-2 text-right font-semibold", tone(r.points))}>{pts(r.points)}</td>
              <td className="px-2 py-2 text-right">{r.hunts}</td>
              <td className="px-2 py-2 text-right text-sky">{r.open || "-"}</td>
              <td className="px-2 py-2 text-right text-lime">{r.hits || "-"}</td>
              <td className={cn("px-2 py-2 text-right", r.rugs ? "text-danger" : "text-muted")}>{r.rugs || "-"}</td>
              <td className="px-2 py-2 text-right">{mult(r.bestMult)}</td>
              {allTime && <td className="px-4 py-2 text-right text-honey">{r.wins || "-"}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HuntList({ hunts, empty, showWallet = true }: { hunts: HuntView[]; empty: string; showWallet?: boolean }) {
  if (!hunts.length) return <p className="px-4 py-6 text-center text-sm text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line/60">
      {hunts.map((h) => {
        const o = OUTCOME[h.settled ? h.outcome : "open"] ?? OUTCOME.open;
        return (
          <li key={h.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <Link href={`/scan/${h.coin}`} className="font-semibold hover:text-honey">
                ${h.symbol}
              </Link>
              <span className="num text-[11px] text-muted">
                {h.chain} · mcap ${fmt(h.fdv0)} · {timeAgo(h.at)}
                {showWallet && ` · ${short(h.wallet)}`}
                {h.src === "telegram" && " · via Telegram"}
              </span>
            </span>
            <span className="num flex shrink-0 items-center gap-3 text-xs">
              <VerdictPill verdict={h.verdict} score={h.score} />
              <span className="text-muted">peak {mult(h.peakMult)}</span>
              <span className={o.cls}>{h.settled ? o.label : timeLeft(h.settlesAt)}</span>
              <span className={cn("w-8 text-right font-semibold", h.settled ? tone(h.points) : "text-muted")}>{h.settled ? pts(h.points) : "-"}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Prize({ w }: { w: HuntWinner | null }) {
  if (!w) return <span className="text-muted">not decided yet</span>;
  if (!w.wallet) return <span className="text-muted">no winner (nobody finished above zero)</span>;
  return (
    <span>
      <span className="font-semibold text-honey">{short(w.wallet)}</span> <span className={tone(w.points)}>{pts(w.points)} pts</span>
      <span className="text-muted"> · </span>
      {w.tx ? (
        <a href={txHref(w.tx)} target="_blank" rel="noreferrer" className="text-lime hover:underline">
          prize tx {short(w.tx)}
        </a>
      ) : (
        <span className="text-muted">prize pending</span>
      )}
    </span>
  );
}

// Подпись Solana: 64 байта в base58, на деле 86-88 знаков; берём с запасом 80-90.
const SOL_SIG = /^[1-9A-HJ-NP-Za-km-z]{80,90}$/;

// Только для админа: вписать подпись транзакции приза за прошедший день. Сервер проверяет право и формат сам.
function PrizeTxForm({ day, onSaved }: { day: string; onSaved: () => void }) {
  const [tx, setTx] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const v = tx.trim();
  const save = async () => {
    if (!SOL_SIG.test(v)) return setErr("Not a Solana signature (base58, 80 to 90 characters)");
    setBusy(true);
    setErr(null);
    try {
      await post("/api/hunt", { day, tx: v });
      setTx("");
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <input
        value={tx}
        onChange={(e) => {
          setTx(e.target.value);
          setErr(null);
        }}
        placeholder="Prize tx signature"
        spellCheck={false}
        className="num min-w-0 flex-1 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs outline-none focus:border-honey/60"
      />
      <Button size="sm" onClick={save} disabled={busy || !v}>
        {busy ? "Saving…" : "Save"}
      </Button>
      {err && <span className="w-full text-xs text-danger">{err}</span>}
    </div>
  );
}

function DayCard({ d, me, label }: { d: Day; me?: string; label: string }) {
  const final = Date.now() >= d.finalAt;
  const sub =
    Date.now() < d.end
      ? `${d.day} UTC · ${timeLeft(d.end)} to scan · ${d.scans} counted scans from ${d.players} hunters`
      : `${d.day} UTC · ${d.scans} counted scans from ${d.players} hunters · ${final || !d.open ? "final" : `${d.open} still tracking, final ${timeLeft(d.finalAt).replace(" left", "")} from now`}`;
  return (
    <Card className="mb-5">
      <CardHeader title={label} sub={sub} action={d.winner ? <span className="text-xs">Winner: <Prize w={d.winner} /></span> : undefined} />
      <Board rows={d.board} me={me} />
    </Card>
  );
}

export function HuntView() {
  const { address, signedIn, connect, signIn } = useWallet();
  const [tab, setTab] = useState<"today" | "yesterday" | "all">("today");
  // Адрес в пути только чтобы перезапросить данные после входа: сервер берёт кошелёк из сессии.
  const { data, reload } = useApi<Data>(`/api/hunt${signedIn ? `?me=${address}` : ""}`, 60_000);
  const live = data?.enabled ? (data as Live & { me: HuntMe | null }) : null;
  const me = data?.me ?? null;
  const today = live?.today;

  return (
    <>
      <PageHeader
        title="Gem Hunter"
        sub={`A daily game for $${TOKEN.symbol} holders. Scan coins with CrawlHive. Every CLEAN or OK verdict on a coin above $${fmt(data?.rules.minMcap ?? 25_000)} market cap counts for the first holder who finds it that day. 24 hours later the coin is scored by how far it ran and whether it rugged. Most points of the UTC day wins.`}
      />
      <p className="-mt-3 mb-5 text-xs text-coral">A game about finding coins with the scanner, not a signal to buy anything. Points say nothing about future prices. Not financial advice.</p>

      {data && !data.enabled && <p className="mb-5 rounded-lg border border-line bg-panel px-4 py-3 text-sm text-muted">Gem Hunter is offline right now. Scans are not being counted.</p>}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Today" value={today ? `${today.scans} scans` : "-"} hint={today ? `${today.players} hunters · ${timeLeft(today.end)}` : "loading"} tone="sky" />
        <Stat label="Today's leader" value={today?.board[0] ? short(today.board[0].wallet) : "-"} hint={today?.board[0] ? `${pts(today.board[0].points)} points settled so far` : "nobody yet"} tone="lime" />
        <Stat label="Yesterday's winner" value={live?.yesterday.winner?.wallet ? short(live.yesterday.winner.wallet) : "-"} hint={live?.yesterday.winner ? <Prize w={live.yesterday.winner} /> : live?.yesterday.scans ? "final once its last scans settle" : "no game yesterday"} tone="honey" />
        <Stat
          label="You"
          value={!signedIn ? "-" : me ? (me.eligible ? `${pts(me.today?.points ?? 0)} today` : "not a holder") : "…"}
          hint={!signedIn ? "sign in to play" : me?.eligible ? `${me.today?.hunts ?? 0} of ${data?.rules.dailyCap ?? 20} scans used today${me.allTime ? ` · ${pts(me.allTime.points)} all time` : ""}` : me ? `Holder plan or higher plays (you are ${me.tier})` : "loading"}
          tone="violet"
        />
      </div>

      {!signedIn && (
        <Card className="mb-5 flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <p className="text-sm text-muted">Sign in with the wallet that holds ${TOKEN.symbol}. Your scans on the site count automatically after that. In Telegram, link that wallet to the bot once.</p>
          <Button onClick={() => (address ? signIn() : connect())}>{address ? "Sign in" : "Connect wallet"}</Button>
        </Card>
      )}
      {signedIn && me && !me.eligible && (
        <Card className="mb-5 flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <p className="text-sm text-muted">This wallet is on the {me.tier} plan. Gem Hunter is for Holder and up.</p>
          <Link href="/pricing" className="text-sm text-honey hover:underline">
            See plans
          </Link>
        </Card>
      )}

      <Rules r={data?.rules ?? { minMcap: 25_000, dailyCap: 20, windowHours: 24, tiers: [], rugPoints: -3, dumpPoints: -1, dumpPct: -50, maxSaneMult: 50, sampleMin: 10 }} />

      <div className="mb-3 flex gap-2 text-sm">
        {(
          [
            ["today", "Today"],
            ["yesterday", "Yesterday"],
            ["all", "All time"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={cn("rounded-lg border px-3 py-1.5", tab === k ? "border-honey/60 text-honey" : "border-line text-muted hover:text-fg")}>
            {l}
          </button>
        ))}
      </div>

      {!live ? (
        <Card className="mb-5">
          <p className="px-4 py-10 text-center text-sm text-muted">{data ? "No data while Gem Hunter is offline." : "Loading…"}</p>
        </Card>
      ) : tab === "all" ? (
        <Card className="mb-5">
          <CardHeader title="All-time leaderboard" sub="Settled points across every game day." />
          <Board rows={live.allTime} me={me?.wallet} allTime />
        </Card>
      ) : (
        <DayCard d={tab === "today" ? live.today : live.yesterday} me={me?.wallet} label={tab === "today" ? "Today's leaderboard" : "Yesterday's leaderboard"} />
      )}

      {live && tab !== "all" && (
        <Card className="mb-5">
          <CardHeader title={tab === "today" ? "Today's finds" : "Yesterday's finds"} sub="Latest counted scans. Points show up when a coin settles 24h after its scan." />
          <HuntList hunts={(tab === "today" ? live.today : live.yesterday).hunts} empty="No counted scans on this day." />
        </Card>
      )}

      {me?.hunts.length ? (
        <Card className="mb-5">
          <CardHeader title="Your scans" sub="Your last 30 counted scans." />
          <HuntList hunts={me.hunts} empty="" showWallet={false} />
        </Card>
      ) : null}

      <Card className="mb-5">
        <CardHeader title="Daily winners" sub="Prize sent manually by the team from the treasury, tx shown here when paid." />
        {!live?.winners.length ? (
          <p className="px-4 py-6 text-center text-sm text-muted">No finished days yet.</p>
        ) : (
          <ul className="divide-y divide-line/60">
            {live.winners.map((w) => (
              <li key={w.day} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 text-sm">
                <span className="num text-muted">{w.day}</span>
                <span className="num text-xs">
                  <Prize w={w} />
                </span>
                {data?.admin && w.wallet && !w.tx && <PrizeTxForm day={w.day} onSaved={reload} />}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="text-xs text-muted">
        The server never holds treasury keys and pays nothing by itself: the team sends each prize by hand and adds the transaction here. Prices come from DexScreener, the same checks that score our verdicts on{" "}
        <Link href="/track" className="text-honey hover:underline">
          Track Record
        </Link>
        .
      </p>
    </>
  );
}
