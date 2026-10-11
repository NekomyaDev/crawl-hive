"use client";
import Link from "next/link";
// Spawner: выбор тира (сколько сжечь), источника, целей и частоты. Справа живое превью.
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Flame, Plus, X as Close } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Chips, Input, Label, Segmented } from "@/components/ui/field";
import { NarrativeBadge, SourceBadge, TierBadge } from "@/components/ui/badge";
import { useWallet } from "@/components/wallet-provider";
import { useToast } from "@/components/ui/toast";
import { post } from "@/lib/client/api";
import { useConfig } from "@/lib/client/use-config";
import { SpecEditor } from "@/components/crawler/spec-editor";
import { defaultSpec, normalizeSpec } from "@/lib/spec";
import { TEMPLATES } from "@/lib/templates";
import { spawnWithBurn, type BurnStep } from "@/lib/client/burn";
import { TIERS, TIER_ORDER, TIER_PRICE_SOL, CREDITS } from "@/lib/economy";
import { computeReputation } from "@/lib/reputation";
import { CHAINS, NARRATIVES, SOURCES, type Chain, type Narrative, type PublicCrawler, type Source, type Tier, type CrawlerSpec } from "@/lib/types";
import { NARRATIVE_LABEL, SOURCE_META, cn, fmt } from "@/lib/utils";

const SUGGESTED: Record<Source, string[]> = {
  x: ["@pumpdotfun", "@DexScreener", "@JupiterExchange", "solana ai agent"],
  telegram: [],
  onchain: [],
  docs: ["https://github.com/trending", "https://solana.com/news"],
};

const PLACEHOLDER: Record<Source, string> = {
  x: "@handle or a search query",
  telegram: "public channel: t.me/name or @name",
  onchain: "token address to watch (optional)",
  docs: "https://page-to-watch",
};

const SOURCE_HINT: Record<Source, string> = {
  x: "Searches X through Grok: posts from your accounts and queries, read through your instructions.",
  telegram: "Reads public Telegram channels (t.me preview) and picks out calls with tickers or contracts.",
  onchain: "Scans DexScreener for new and boosted tokens that pass your filters; targets are a watchlist for volume spikes.",
  docs: "Watches pages for changes and tells you what's new: launches, airdrops, roadmap updates.",
};

const TARGETS_HINT: Record<Source, string> = {
  x: "X crawlers run at most every 120 / 60 / 30 / 15 min by tier: each run is a paid Grok search.",
  telegram: "Only public channels with a web preview work.",
  onchain: "Optional. Leave empty to scan the feeds only.",
  docs: "Any public page: docs, blog, GitHub repo, changelog.",
};

export default function SpawnPage() {
  const router = useRouter();
  const toast = useToast();
  const { address, info, connect, refresh, mode } = useWallet();

  const [tier, setTier] = useState<Tier>("worker");
  const [name, setName] = useState("");
  const [source, setSource] = useState<Source>("x");
  const [chain, setChain] = useState<Chain>("solana");
  const [narratives, setNarratives] = useState<Narrative[]>(["ai"]);
  const [targets, setTargets] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [freq, setFreq] = useState(15);
  const [busy, setBusy] = useState(false);
  const [spec, setSpec] = useState<CrawlerSpec>(() => defaultSpec("x"));
  const [step, setStep] = useState<BurnStep | null>(null);
  const [dripping, setDripping] = useState(false);
  const [template, setTemplate] = useState<string | undefined>();
  const cfg = useConfig();

  // ?template=<id> с маркетплейса: подставляем настройки готового краулера, дальше их можно менять.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("template");
    const tpl = TEMPLATES.find((x) => x.id === id);
    if (!tpl) return;
    setTemplate(tpl.id);
    setTier(tpl.tier);
    setName(tpl.name.slice(0, 24));
    setSource(tpl.source);
    setChain(tpl.chain);
    setNarratives(tpl.narratives);
    setTargets(tpl.targets);
    setFreq(tpl.frequencyMin);
    setSpec(normalizeSpec(tpl.spec, tpl.source));
  }, []);
  const payment = cfg?.payment ?? "simulated";
  // Кошелёк EVM платит в ETH на Robinhood Chain, Phantom — в SOL.
  const eth = mode === "evm" && !!cfg?.eth;
  const onchain = payment !== "simulated" || eth;
  const paying = eth || payment === "sol"; // перевод (SOL или ETH), а не сжигание
  // Кошелёк Robinhood Chain: по умолчанию и краулер смотрит туда же (если не выбран шаблон).
  useEffect(() => {
    if (eth && !template) setChain((c) => (c === "solana" ? "robinhood" : c));
  }, [eth, template]);
  // Фаза 1 — платим SOL, фаза 2 — сжигаем токен проекта; в симуляции — внутренние credits.
  const priceOf = (k: Tier) => (eth && cfg?.eth ? cfg.eth.prices[k] : (cfg?.prices[k] ?? (payment === "sol" ? TIER_PRICE_SOL[k] : TIERS[k].burn)));
  // Тикер токена проекта приходит из конфига (TOKEN_SYMBOL), пока токена нет — режим token выключен.
  const tokenName = cfg?.symbol ?? "token";
  const unit = eth ? "ETH" : payment === "sol" ? "SOL" : payment === "token" ? tokenName : CREDITS;
  const fmtPrice = (n: number) => (paying ? `${n}` : fmt(n));

  const t = TIERS[tier];
  const effFreq = Math.max(freq, t.minFrequency);
  const itemsPerHour = Math.round((targets.length * 40 * 60) / (effFreq * 60) * 60) || 0;
  // On-chain сжигаем реальные токены из кошелька, иначе — внутренний баланс.
  const balance = eth
    ? (info?.onchain?.eth ?? 0)
    : payment === "sol" ? (info?.onchain?.sol ?? 0) : payment === "token" ? (info?.onchain?.tokens ?? 0) : (info?.balance ?? 0);
  const price = priceOf(tier);
  // Демо-кошелёк платить не может; кошелёк EVM — только если оплата в ETH включена.
  const needPhantom = onchain && !!address && (mode === "demo" || (mode === "evm" && !cfg?.eth));
  const enough = balance >= price + (eth ? 0.00005 : payment === "sol" ? 0.00002 : 0);
  // Стартовая репутация: точность ещё нейтральная, uptime 100%, данных ноль, плюс вклад сожжённого.
  const startRep = computeReputation({
    burned: t.burn,
    stats: { items: 0, signals: 0, hits: 0, uptimeSec: 0, totalSec: 0, rewards: 0 },
  });

  const problems = useMemo(() => {
    const p: string[] = [];
    if (name.trim().length < 2) p.push("Name your crawler");
    if (!narratives.length) p.push("Pick at least one narrative");
    if (!targets.length && source !== "onchain") p.push("Add at least one target");
    if (targets.length > t.maxTargets) p.push(`${t.label} allows ${t.maxTargets} targets`);
    return p;
  }, [name, narratives, targets, t, source]);

  const addTarget = (v: string) => {
    const x = v.trim();
    if (!x || targets.includes(x)) return;
    if (targets.length >= t.maxTargets) {
      toast(`${t.label} tier is capped at ${t.maxTargets} targets`, "error");
      return;
    }
    setTargets([...targets, x]);
    setDraft("");
  };

  const spawn = async () => {
    if (!address) return connect();
    if (needPhantom) return toast("This wallet can't pay here. Disconnect it and connect Phantom.", "error");
    const payload = { name, source, chain, narratives, targets, frequencyMin: effFreq, tier, spec, template };
    setBusy(true);
    try {
      const c = onchain ? await spawnWithBurn(payload, setStep) : await post<PublicCrawler>("/api/crawlers", payload);
      toast(
        paying
          ? `Paid ${price} ${unit} on-chain. ${c.name} joined the swarm.`
          : `🔥 Burned ${fmt(price)} ${unit}${onchain ? " on-chain" : ""}. ${c.name} joined the swarm.`,
      );
      await refresh();
      router.push(`/crawler/${c.id}`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
      setStep(null);
    }
  };

  // Devnet: получить тестовые SOL или токены проекта на комиссию.
  const drip = async () => {
    setDripping(true);
    try {
      const r = await post<{ signature: string; tokens: number; sol: number }>("/api/faucet");
      toast(r.tokens ? `Got ${fmt(r.tokens)} test ${tokenName}${r.sol ? ` and ${r.sol} SOL for fees` : ""}` : `Got ${r.sol} devnet SOL`);
      await refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setDripping(false);
    }
  };

  const STEP_LABEL: Record<BurnStep, string> = {
    prepare: "Preparing transaction…",
    sign: eth ? "Confirm in your wallet…" : "Confirm in Phantom…",
    confirm: paying ? "Verifying payment on-chain…" : "Verifying burn on-chain…",
  };

  return (
    <>
      <PageHeader
        title="Spawn a crawler"
        sub={
          paying
            ? `Pay ${cfg?.eth ? "SOL, or ETH on Robinhood Chain," : "SOL"} to hatch a crawler. Pre-launch phase: the payment goes to the project treasury and will fund buybacks of the project token once it launches. Higher tiers get more targets, faster crawl cycles and a reward boost.`
            : `Burn ${unit} to hatch a crawler. The burn is permanent; higher tiers get more targets, faster crawl cycles and a reward boost.`
        }
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-5">
          {/* 1. Тир */}
          <Card>
            <CardHeader title="1 · Tier" sub={`What you ${paying ? "pay" : "burn"} decides what the crawler can do`} />
            <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
              {TIER_ORDER.map((k) => {
                const v = TIERS[k];
                return (
                  <button
                    key={k}
                    onClick={() => {
                      setTier(k);
                      setTargets((x) => x.slice(0, v.maxTargets));
                    }}
                    className={cn(
                      "rounded-xl border p-3 text-left transition-colors",
                      tier === k ? "border-honey bg-honey/5" : "border-line hover:border-honey/40",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{v.label}</span>
                      {k === "queen" && <span className="text-[10px] text-honey">♛</span>}
                    </div>
                    <div className="num mt-2 text-lg text-honey">{fmtPrice(priceOf(k))}</div>
                    <div className="text-[11px] text-muted">{paying ? unit : `${unit} burned`}</div>
                    <ul className="mt-2 space-y-0.5 text-[11px] text-muted">
                      <li>{v.maxTargets} targets</li>
                      <li>every {v.minFrequency} min</li>
                      <li>{v.rewardBoost}× rewards</li>
                    </ul>
                  </button>
                );
              })}
            </div>
          </Card>

          {/* 2. Источник и темы */}
          <Card>
            <CardHeader title="2 · What it crawls" />
            <div className="grid gap-5 p-4 md:grid-cols-2">
              <div>
                <Label>Name</Label>
                <Input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="Night Mantis" />
              </div>
              <div>
                <Label>Chain focus</Label>
                <Segmented options={CHAINS} value={chain} onChange={setChain} />
              </div>
              <div className="md:col-span-2">
                <Label hint={SOURCE_HINT[source]}>Source</Label>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  {SOURCES.map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        setSource(s);
                        setTargets([]);
                        setSpec(defaultSpec(s));
                        setTemplate(undefined);
                      }}
                      className={cn(
                        "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                        source === s ? "border-honey/70 bg-honey/5" : "border-line text-muted hover:text-fg",
                      )}
                    >
                      <span className="size-2 rounded-full" style={{ background: SOURCE_META[s].color }} />
                      {SOURCE_META[s].label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="md:col-span-2">
                <Label hint="up to 3">Narratives</Label>
                <Chips
                  options={NARRATIVES}
                  value={narratives}
                  onChange={(v) => setNarratives(v.slice(-3))}
                  render={(n) => `#${NARRATIVE_LABEL[n]}`}
                />
              </div>
            </div>
          </Card>

          {/* 3. Цели и частота */}
          <Card>
            <CardHeader title="3 · Targets & frequency" sub={`${targets.length}/${t.maxTargets} targets on ${t.label}`} />
            <div className="flex flex-col gap-4 p-4">
              <div>
                <Label hint={TARGETS_HINT[source]}>Targets</Label>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    addTarget(draft);
                  }}
                >
                  <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={PLACEHOLDER[source]} />
                  <Button type="submit" variant="outline" disabled={!draft.trim()}>
                    <Plus className="size-4" /> Add
                  </Button>
                </form>
                {targets.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {targets.map((x) => (
                      <span key={x} className="num inline-flex items-center gap-1 rounded-md bg-panel-2 px-2 py-1 text-xs">
                        {x}
                        <button onClick={() => setTargets(targets.filter((y) => y !== x))} className="text-muted hover:text-danger">
                          <Close className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                  Suggested:
                  {SUGGESTED[source]
                    .filter((x) => !targets.includes(x))
                    .map((x) => (
                      <button key={x} onClick={() => addTarget(x)} className="num rounded border border-dashed border-line px-1.5 py-0.5 hover:text-honey">
                        + {x}
                      </button>
                    ))}
                </div>
              </div>
              <div>
                <Label hint={`${t.label}: every ${t.minFrequency} min at most`}>Crawl every {effFreq} min</Label>
                <input
                  type="range"
                  min={1}
                  max={120}
                  value={freq}
                  onChange={(e) => setFreq(Number(e.target.value))}
                  className="w-full accent-[var(--honey)]"
                />
                {freq < t.minFrequency && (
                  <p className="mt-1 text-[11px] text-honey">Capped at {t.minFrequency} min for {t.label}. Upgrade the tier to crawl faster.</p>
                )}
              </div>
            </div>
          </Card>

          {/* 4. Спецификация */}
          <Card>
            <CardHeader
              title="4 · Specification"
              sub="How your crawler decides what is worth a signal. Signals are private: only you (or a renter) see them."
            />
            <div className="p-4">
              <SpecEditor key={source} source={source} spec={spec} onChange={setSpec} />
            </div>
          </Card>
        </div>

        {/* Превью и кнопка сжечь */}
        <div className="xl:sticky xl:top-6 xl:self-start">
          <Card>
            <CardHeader title="Preview" />
            <div className="p-4">
              <div className="flex items-center gap-3">
                <div
                  className="grid size-12 place-items-center rounded-full"
                  style={{ background: `${SOURCE_META[source].color}22`, boxShadow: `0 0 24px ${SOURCE_META[source].color}55` }}
                >
                  <span className="size-4 rounded-full" style={{ background: SOURCE_META[source].color }} />
                </div>
                <div>
                  <div className="font-semibold">{name.trim() || "Unnamed crawler"}</div>
                  <div className="num text-[11px] text-muted">CRWL-????</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                <SourceBadge source={source} />
                <TierBadge tier={tier} />
                {narratives.map((n) => (
                  <NarrativeBadge key={n} n={n} />
                ))}
              </div>
              <dl className="mt-4 space-y-1.5 text-sm">
                <Row k="Targets" v={`${targets.length} / ${t.maxTargets}`} />
                <Row k="Cycle" v={`every ${effFreq} min`} />
                <Row k="Est. items / hour" v={fmt(itemsPerHour)} />
                <Row k="Reward boost" v={`${t.rewardBoost}×`} />
                <Row k="Starting rep" v={`${startRep}`} />
              </dl>

              <div className="mt-4 rounded-lg border border-honey/30 bg-honey/5 p-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm">{paying ? "You pay" : "You burn"}</span>
                  <span className="num text-xl font-bold text-honey">
                    {fmtPrice(price)} <span className="text-xs">{unit}</span>
                  </span>
                </div>
                {address && (
                  <div className={cn("num mt-1 text-right text-[11px]", enough ? "text-muted" : "text-danger")}>
                    {onchain ? "in wallet" : "balance"} {eth ? balance.toFixed(5) : payment === "sol" ? balance.toFixed(3) : fmt(balance)} {paying && unit}
                    {payment === "token" && info?.onchain && <span> · {info.onchain.sol.toFixed(3)} SOL</span>}
                  </div>
                )}
                {cfg?.faucet && address && mode === "phantom" && (
                  <button onClick={drip} disabled={dripping} className="mt-1 w-full text-right text-[11px] text-honey hover:underline disabled:opacity-50">
                    {dripping ? "Sending…" : `Get test ${payment === "sol" ? "SOL" : tokenName} (devnet)`}
                  </button>
                )}
              </div>

              {problems.length > 0 && address && (
                <ul className="mt-3 space-y-0.5 text-[11px] text-muted">
                  {problems.map((p) => (
                    <li key={p}>· {p}</li>
                  ))}
                </ul>
              )}

              <Button
                size="lg"
                className="mt-4 w-full"
                onClick={spawn}
                disabled={busy || (!!address && (problems.length > 0 || !enough || needPhantom))}
              >
                <Flame className="size-4" />
                {!address
                  ? "Connect wallet to spawn"
                  : needPhantom
                    ? "Phantom required"
                    : step
                      ? STEP_LABEL[step]
                      : busy
                        ? "Burning…"
                        : paying
                          ? `Pay ${price} ${unit} & spawn`
                          : `Burn ${fmt(price)} & spawn`}
              </Button>
              {cfg && (
                <p className="mt-2 text-center text-[11px] text-muted">
                  {eth && cfg.eth && (
                    <>
                      Real ETH payment on <span className="text-fg">Robinhood Chain</span> to the project treasury{" "}
                      <a className="num hover:text-honey" href={`${cfg.eth.explorer}/address/${cfg.eth.recipient}`} target="_blank" rel="noreferrer">
                        {cfg.eth.recipient.slice(0, 6)}…{cfg.eth.recipient.slice(-4)}
                      </a>
                      . It goes to the same buyback fund as SOL. Your wallet switches to Robinhood Chain for you. Buys {cfg.termDays} days of crawling; renew any time. Payments are final, signals are not financial advice:{" "}
                      <Link href="/terms" className="underline hover:text-fg">
                        terms
                      </Link>
                      .
                    </>
                  )}
                  {!eth && payment === "sol" && (
                    <>
                      Real SOL payment on <span className="text-fg">{cfg.cluster}</span>
                      {cfg.solBurned ? (
                        <>, sent to the Solana incinerator: burned for good.</>
                      ) : (
                        <>
                          {" "}
                          to the {cfg.buyback ? "project treasury" : "treasury"}{" "}
                          <a
                            className="num hover:text-honey"
                            href={`https://explorer.solana.com/address/${cfg.solRecipient}${cfg.cluster === "mainnet-beta" ? "" : `?cluster=${cfg.cluster}`}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {cfg.solRecipient?.slice(0, 4)}…{cfg.solRecipient?.slice(-4)}
                          </a>
                          {cfg.buyback ? <>. It will fund buybacks of the project token once the token launches.</> : "."}
                        </>
                      )}{" "}
                      Phantom must be on the same network. Buys {cfg.termDays} days of crawling; renew any time. Payments are final, signals are not financial advice:{" "}
                      <Link href="/terms" className="underline hover:text-fg">
                        terms
                      </Link>
                      .
                    </>
                  )}
                  {payment === "token" && (
                    <>
                      Real SPL burn of {tokenName} on <span className="text-fg">{cfg.cluster}</span>
                      {cfg.mint && (
                        <>
                          {" "}
                          (
                          <a className="num hover:text-honey" href={`https://explorer.solana.com/address/${cfg.mint}${cfg.cluster === "mainnet-beta" ? "" : `?cluster=${cfg.cluster}`}`} target="_blank" rel="noreferrer">
                            mint {cfg.mint.slice(0, 4)}…{cfg.mint.slice(-4)}
                          </a>
                          )
                        </>
                      )}
                      . Phantom must be on the same network.
                    </>
                  )}
                  {payment === "simulated" && "Simulated burn: on-chain payment is off on this server, nothing leaves a real wallet."}
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted">{k}</dt>
      <dd className="num">{v}</dd>
    </div>
  );
}
