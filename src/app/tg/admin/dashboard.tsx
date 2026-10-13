"use client";
// Дашборд владельца в Telegram: пользователи, трафик, сканы, краулеры, деньги, расходы на AI, агенты, поддержка.
// Данные отдаёт /api/tg/admin только админам (проверка подписи Telegram + id/username).
import { useCallback, useEffect, useState } from "react";
import { cn, fmt, timeAgo } from "@/lib/utils";

interface Stats {
  at: number;
  users: { telegram: number; telegram24h: number; new24h: number; app24h: number; tgScans: number; walletsLinked: number; owners: number; recent: { name: string; username: string | null; last: number; scans: number }[] };
  traffic: { visitorsToday: number | null; requestsToday: number | null; blocked: number };
  scans: { verdicts24h: Record<string, number>; total: number; radar24h: number };
  crawlers: { total: number; live: number; active: number; bySource: Record<string, number>; failing: { id: string; name: string; streak?: number; error?: string }[]; signals24h: number; scored: number; hits: number };
  money: { payments: number; sol: number; eth: number; treasury: { sol?: number; eth?: number; solUsd?: number; ethUsd?: number };
    buybacks?: { count: number; sol: number; burned: number; burnedPct: number; rewardsSol: number; rewardDays: number };
  };
  ai: { grok: { calls: number; limit: number }; jev: { calls: number; cost: number; limit: number; pub?: number } };
  agents: { bots: number; botsLive: number; oauthApps: number; dutyCrawlers: number };
  telegram: { watchers: number; watched: number; alertSubs: number; groups: number };
  support: { open: number; latest: { from: number; name: string; username?: string; text: string; at: number; answered?: boolean }[] };
}

const tgApp = () => (typeof window !== "undefined" ? (window as unknown as { Telegram?: { WebApp?: { initData: string; ready(): void; expand(): void; setHeaderColor(c: string): void } } }).Telegram?.WebApp : undefined);

function Card({ title, value, sub, tone = "text-fg" }: { title: string; value: React.ReactNode; sub?: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-panel p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted">{title}</div>
      <div className={cn("num mt-1 text-2xl font-bold", tone)}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="space-y-2">
    <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted">{title}</h2>
    {children}
  </section>
);

export function AdminDashboard() {
  const [s, setS] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const init = tgApp()?.initData ?? "";
    if (!init) return setErr("Open this dashboard from @crawlhivebot: send /admin.");
    const r = await fetch("/api/tg/admin", { headers: { "x-tg-init": init }, cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setErr(j.error ?? `HTTP ${r.status}`);
    setErr(null);
    setS(j);
  }, []);

  useEffect(() => {
    let tries = 0;
    const t = setInterval(() => {
      const app = tgApp();
      if (app || ++tries > 30) {
        clearInterval(t);
        app?.ready();
        app?.expand();
        try {
          app?.setHeaderColor("#07080a");
        } catch {}
        load();
      }
    }, 100);
    const r = setInterval(load, 30_000);
    return () => {
      clearInterval(t);
      clearInterval(r);
    };
  }, [load]);

  if (err) return <div data-tg-app className="grid min-h-screen place-items-center p-6 text-center text-sm text-muted">{err}</div>;
  if (!s) return <div data-tg-app className="grid min-h-screen place-items-center text-muted">Loading…</div>;
  const v = s.scans.verdicts24h;
  const hit = s.crawlers.scored ? Math.round((s.crawlers.hits / s.crawlers.scored) * 100) : 0;
  const solUsd = s.money.treasury.sol != null && s.money.treasury.solUsd ? s.money.treasury.sol * s.money.treasury.solUsd : null;
  return (
    <div data-tg-app className="mx-auto max-w-lg space-y-5 p-3 pb-10">
      <header className="flex items-center justify-between pt-1">
        <div className="font-bold">
          📊 Crawl<span className="text-honey">Hive</span> admin
        </div>
        <button onClick={load} className="text-xs text-honey">
          Refresh · {timeAgo(s.at)}
        </button>
      </header>

      <Section title="Users">
        <div className="grid grid-cols-2 gap-2">
          <Card title="Telegram users" value={fmt(s.users.telegram)} sub={`${s.users.telegram24h} active 24h · ${s.users.new24h} new`} tone="text-sky" />
          <Card title="Site visitors today" value={s.traffic.visitorsToday ?? "—"} sub={`${s.traffic.requestsToday ?? "—"} page views · ${s.traffic.blocked} blocked`} tone="text-lime" />
          <Card title="App opens 24h" value={s.users.app24h} sub={`${s.users.tgScans} scans in Telegram`} />
          <Card title="Wallets" value={s.users.owners} sub={`crawler owners · ${s.users.walletsLinked} linked to Telegram`} />
        </div>
        <div className="rounded-2xl border border-line bg-panel">
          {s.users.recent.map((u, i) => (
            <div key={i} className="flex items-center justify-between border-b border-line/60 px-3 py-2 text-sm last:border-0">
              <span className="truncate">
                {u.name || "—"} {u.username && <span className="text-muted">@{u.username}</span>}
              </span>
              <span className="num shrink-0 text-[11px] text-muted">
                {u.scans} scans · {timeAgo(u.last)}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Scanner">
        <div className="grid grid-cols-2 gap-2">
          <Card title="Verdicts 24h" value={(v.scan ?? 0) + (v.crawler ?? 0) + (v.radar ?? 0) + (v.agent ?? 0)} sub={`scans ${v.scan ?? 0} · crawlers ${v.crawler ?? 0} · radar ${v.radar ?? 0} · agents ${v.agent ?? 0}`} tone="text-honey" />
          <Card title="Track Record" value={fmt(s.scans.total)} sub={`verdicts tracked · radar ${s.scans.radar24h} today`} />
        </div>
      </Section>

      <Section title="Crawlers">
        <div className="grid grid-cols-2 gap-2">
          <Card title="Live crawlers" value={s.crawlers.live} sub={`${s.crawlers.active} active · ${Object.entries(s.crawlers.bySource).map(([k, n]) => `${k} ${n}`).join(" · ")}`} tone="text-lime" />
          <Card title="Signals 24h" value={s.crawlers.signals24h} sub={`hit rate ${hit}% of ${s.crawlers.scored}`} />
        </div>
        {s.crawlers.failing.length > 0 && (
          <div className="rounded-2xl border border-danger/40 bg-danger/[0.05] p-3 text-sm">
            {s.crawlers.failing.map((c) => (
              <div key={c.id}>
                ⚠️ {c.name}: {c.error ?? "failing"} ({c.streak}×)
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Money">
        <div className="grid grid-cols-2 gap-2">
          <Card title="Payments" value={s.money.payments} sub={`${s.money.sol.toFixed(3)} SOL · ${s.money.eth.toFixed(4)} ETH`} tone="text-honey" />
          <Card title="Treasury" value={s.money.treasury.sol != null ? `${s.money.treasury.sol.toFixed(3)} SOL` : "—"} sub={`${solUsd != null ? `$${Math.round(solUsd)}` : ""}${s.money.treasury.eth != null ? ` · ${s.money.treasury.eth.toFixed(4)} ETH` : ""}`} />
          {s.money.buybacks && (
            <>
              <Card title="Buybacks" value={s.money.buybacks.count} sub={`${s.money.buybacks.sol.toFixed(3)} SOL spent`} tone="text-honey" />
              <Card
                title="Burned"
                value={Math.round(s.money.buybacks.burned).toLocaleString("en-US")}
                sub={`${s.money.buybacks.burnedPct.toFixed(3)}% of supply · rewards ${s.money.buybacks.rewardsSol.toFixed(3)} SOL`}
              />
            </>
          )}
        </div>
      </Section>

      <Section title="AI spend today">
        <div className="grid grid-cols-2 gap-2">
          <Card title="Grok calls" value={`${s.ai.grok.calls}/${s.ai.grok.limit}`} sub="X checks, crawlers, duty" tone="text-violet" />
          <Card title="Jev" value={`$${s.ai.jev.cost.toFixed(4)}`} sub={`${s.ai.jev.calls} decisions${s.ai.jev.pub != null ? ` · ${s.ai.jev.pub} public` : ""}`} tone="text-pink" />
        </div>
      </Section>

      <Section title="Agents and Telegram">
        <div className="grid grid-cols-2 gap-2">
          <Card title="Grok Bots" value={s.agents.bots} sub={`${s.agents.botsLive} live · ${s.agents.oauthApps} apps · ${s.agents.dutyCrawlers} on duty`} />
          <Card title="Watchlists" value={s.telegram.watchers} sub={`${s.telegram.watched} tokens · ${s.telegram.alertSubs} alert subs · ${s.telegram.groups} groups`} />
        </div>
      </Section>

      <Section title={`Support · ${s.support.open} open`}>
        <div className="rounded-2xl border border-line bg-panel">
          {s.support.latest.map((m, i) => (
            <div key={i} className="border-b border-line/60 px-3 py-2.5 text-sm last:border-0">
              <div className="flex items-center justify-between text-[11px] text-muted">
                <span>
                  {m.name} {m.username && `@${m.username}`} · <span className="num">{m.from}</span>
                </span>
                <span className={m.answered ? "text-lime" : "text-honey"}>{m.answered ? "answered" : timeAgo(m.at)}</span>
              </div>
              <div className="mt-0.5 whitespace-pre-wrap break-words">{m.text}</div>
              {!m.answered && <div className="num mt-1 text-[11px] text-muted">/reply {m.from} …</div>}
            </div>
          ))}
          {!s.support.latest.length && <p className="p-4 text-center text-sm text-muted">No messages yet.</p>}
        </div>
      </Section>
    </div>
  );
}
