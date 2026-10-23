"use client";
import { TOKEN } from "@/lib/token";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Bug, LayoutGrid, Store, Trophy, Landmark, Wallet, LogOut, Plus, Radio, ShieldCheck, Radar, Target, Bot, Rocket, Sparkles, History, Puzzle, Brain, Gem, Eye, MessageSquare, Skull } from "lucide-react";
import { cn, fmt, short } from "@/lib/utils";
import { Logo } from "./logo";
import { APP_URL, COMMUNITY_URL, TelegramIcon } from "./telegram-cta";
import { useWallet } from "./wallet-provider";
import { useApi } from "@/lib/client/use-api";
import { Button } from "./ui/button";
import { LangSwitcher, useT } from "./lang-provider";
import type { DictKey } from "@/lib/i18n";

const LINKS = [
  { href: "/", label: "nav.swarm" as DictKey, icon: LayoutGrid, color: "text-honey" },
  { href: "/spawn", label: "nav.spawn" as DictKey, icon: Plus, color: "text-coral" },
  { href: "/my", label: "nav.my" as DictKey, icon: Bug, color: "text-lime" },
  { href: "/signals", label: "nav.signals" as DictKey, icon: Radio, color: "text-teal" },
  { href: "/launch", label: "nav.launch" as DictKey, icon: Rocket, color: "text-coral" },
  { href: "/radar", label: "nav.radar" as DictKey, icon: Radar, color: "text-lime" },
  { href: "/narratives", label: "nav.narratives" as DictKey, icon: Sparkles, color: "text-violet" },
  { href: "/track", label: "nav.track" as DictKey, icon: Target, color: "text-honey" },
  { href: "/rugs", label: "nav.rugs" as DictKey, icon: Skull, color: "text-danger", badge: "NEW" },
  { href: "/paper", label: "nav.paper" as DictKey, icon: Bot, color: "text-lime", badge: "PAPER" },
  { href: "/hunt", label: "nav.hunt" as DictKey, icon: Trophy, color: "text-honey", badge: "NEW" },
  { href: "/replay", label: "nav.replay" as DictKey, icon: History, color: "text-pink" },
  { href: "/extension", label: "nav.extension" as DictKey, icon: Puzzle, color: "text-lime" },
  { href: "/brain", label: "nav.brain" as DictKey, icon: Brain, color: "text-pink" },
  { href: "/ask", label: "nav.ask" as DictKey, icon: MessageSquare, color: "text-pink", badge: "AI" },
  { href: "/watchlist", label: "nav.watchlist" as DictKey, icon: Eye, color: "text-lime" },
  { href: "/pricing", label: "nav.pricing" as DictKey, icon: Gem, color: "text-sky" },
  { href: "/agents", label: "nav.agents" as DictKey, icon: Bot, color: "text-teal" },
  { href: "/market", label: "nav.market" as DictKey, icon: Store, color: "text-pink" },
  { href: "/leaderboard", label: "nav.leaderboard" as DictKey, icon: Trophy, color: "text-sky" },
  { href: "/governance", label: "nav.governance" as DictKey, icon: Landmark, color: "text-violet" },
];

// Бейдж тарифа (Holder, Pro, Whale): видно, что бонусы включены. Ведёт на страницу тарифов.
const BADGE: Record<string, string> = { holder: "bg-lime", pro: "bg-pink", whale: "bg-sky" };
function HolderBadge() {
  const { data } = useApi<{ tier?: string }>("/api/holder", 300_000);
  const t = data?.tier;
  if (!t || t === "free") return null;
  return (
    <Link href="/pricing" className={cn("rounded px-1 py-px text-[9px] font-black tracking-wide text-black", BADGE[t])} title={`${TOKEN.symbol} tier: ${t} perks are on`}>
      {t.toUpperCase()}
    </Link>
  );
}

function WalletButton({ compact = false }: { compact?: boolean }) {
  const { address, info, mode, signedIn, connect, signIn, disconnect } = useWallet();
  const { t } = useT();
  if (!address)
    return (
      <div className="flex w-full flex-col gap-1.5">
        <Button onClick={() => connect()} size="sm" className="w-full">
          <Wallet className="size-4" /> {t("wallet.connect")}
        </Button>
        {/* Подсказка у кнопки: что на самом деле происходит при подключении. */}
        {!compact && (
          <Link href="/#wallet-safety" className="flex items-center justify-center gap-1 text-[11px] text-muted hover:text-lime">
            <ShieldCheck className="size-3" /> {t("wallet.safeLong")}
          </Link>
        )}
      </div>
    );
  return (
    <div className={cn("flex items-center gap-2", !compact && "rounded-lg border border-line bg-panel-2 p-2.5")}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="num truncate text-xs">{short(address)}</span>
          {signedIn && <HolderBadge />}
        </div>
        {signedIn ? (
          <div className="num text-xs text-honey">{info ? fmt(info.balance) : "…"} {t("wallet.credits")}</div>
        ) : (
          <button onClick={() => signIn().catch(() => {})} className="text-xs font-medium text-honey hover:underline">
            {t("wallet.signInContinue")}
          </button>
        )}
        {!compact && <div className="text-[10px] text-muted">{mode === "phantom" ? "Phantom · Solana" : mode === "evm" ? "EVM wallet · Robinhood Chain" : "Demo wallet"}</div>}
      </div>
      <button onClick={disconnect} className="text-muted hover:text-fg" title={t("wallet.disconnect")}>
        <LogOut className="size-4" />
      </button>
    </div>
  );
}

// Путь — данные запроса: с cacheComponents его можно читать только внутри Suspense.
// Поэтому сама навигация рендерится один раз и без него, а активный пункт подсвечивает
// невидимый PathSync, который сообщает путь через эффект. Так HTML с сервера и первый
// клиентский рендер совпадают, и нет второй копии навигации в fallback.
function PathSync({ onPath }: { onPath: (p: string) => void }) {
  const path = usePathname();
  useEffect(() => onPath(path), [path, onPath]);
  return null;
}

export function Nav() {
  const [path, setPath] = useState("");
  return (
    <>
      <Suspense fallback={null}>
        <PathSync onPath={setPath} />
      </Suspense>
      <NavShell path={path} />
    </>
  );
}

export function NavShell({ path }: { path: string }) {
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const { t } = useT();
  return (
    <>
      {/* десктоп: боковая панель */}
      <aside data-chrome className="sticky top-0 hidden no-scrollbar h-screen w-52 shrink-0 flex-col overflow-y-auto border-r border-line bg-panel/60 p-3 lg:flex">
        <Link href="/" className="mb-4 flex items-center gap-2 px-2 pt-1">
          <Logo size={34} />
          <span className="text-lg font-bold tracking-tight">
            Crawl<span className="text-honey">Hive</span>
          </span>
        </Link>
        <nav className="flex flex-col gap-0.5">
          {LINKS.map(({ href, label, icon: Icon, color, badge }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
                active(href) ? "bg-gradient-to-r from-honey/15 to-transparent text-fg" : "text-muted hover:bg-panel-2 hover:text-fg",
              )}
            >
              {active(href) && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-gradient-to-b from-honey to-pink" />}
              <Icon className={cn("size-4", color)} />
              {t(label)}
              {badge && <span className="ml-auto rounded bg-lime/15 px-1 py-px text-[9px] font-bold text-lime">{badge}</span>}
            </Link>
          ))}
        </nav>
      </aside>

      {/* мобильный: верхняя полоса + горизонтальные вкладки */}
      <header data-chrome className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur lg:hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
          <Link href="/" className="flex items-center gap-2">
            <Logo size={30} />
            <span className="font-bold">
              Crawl<span className="text-honey">Hive</span>
            </span>
          </Link>
          <Link href="/#treasury" className="ml-auto rounded-md border border-honey/50 bg-honey/10 px-2 py-1 text-[11px] font-bold text-honey">
            ${TOKEN.symbol}
          </Link>
          <LangSwitcher compact />
          <div className="w-40">
            <WalletButton compact />
          </div>
        </div>
        <nav className="no-scrollbar flex gap-1 overflow-x-auto px-3 pb-2">
          {LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "shrink-0 rounded-lg px-3 py-1.5 text-xs",
                active(href) ? "bg-honey/10 text-honey" : "text-muted",
              )}
            >
              {t(label)}
            </Link>
          ))}
        </nav>
      </header>
    </>
  );
}

// Верхняя панель на десктопе: кошелёк и главные ссылки (Telegram, X-бот, токен) в одну строку справа,
// чтобы их не приходилось искать в длинном меню слева.
const TOP_BTN = "inline-flex h-12 items-center gap-2 rounded-xl border px-5 text-base font-semibold whitespace-nowrap transition-colors";
function TopWallet() {
  const { address, info, signedIn, connect, signIn, disconnect } = useWallet();
  const { t } = useT();
  if (!address)
    return (
      <div className="flex items-center gap-2">
        <Link href="/#wallet-safety" className="hidden items-center gap-1 text-xs text-muted hover:text-lime xl:flex" title={t("wallet.safeTitle")}>
          <ShieldCheck className="size-3" /> {t("wallet.safe")}
        </Link>
        <Button onClick={() => connect()} className="h-12 rounded-xl px-6 text-base font-bold">
          <Wallet className="size-5" /> {t("wallet.connectWallet")}
        </Button>
      </div>
    );
  return (
    <div className="flex h-12 items-center gap-2.5 rounded-xl border border-line bg-panel-2 px-4">
      <span className="num text-sm">{short(address)}</span>
      {signedIn ? (
        <>
          <HolderBadge />
          <span className="num text-sm text-honey">{info ? fmt(info.balance) : "…"} {t("wallet.credits")}</span>
        </>
      ) : (
        <button onClick={() => signIn().catch(() => {})} className="text-xs font-medium text-honey hover:underline">
          {t("wallet.signIn")}
        </button>
      )}
      <button onClick={disconnect} className="text-muted hover:text-fg" title={t("wallet.disconnect")}>
        <LogOut className="size-4" />
      </button>
    </div>
  );
}

export function TopBar() {
  const { t } = useT();
  return (
    <div data-chrome className="mb-6 hidden flex-wrap items-center justify-end gap-3 lg:flex">
      <Link href="/#treasury" className={cn(TOP_BTN, "border-honey/50 bg-honey/10 text-honey hover:bg-honey/20")}>
        <span className="text-lg leading-none">🔥</span>${TOKEN.symbol}
        <span className="rounded bg-honey px-1.5 py-px text-[9px] font-bold tracking-wide text-black">LIVE</span>
      </Link>
      <a href={APP_URL} target="_blank" rel="noreferrer" className={cn(TOP_BTN, "border-[#229ED9]/50 bg-[#229ED9]/15 text-white hover:bg-[#229ED9]/25")}>
        <TelegramIcon className="size-5 text-[#5bc4f5]" /> {t("top.tgApp")}
      </a>
      <a href={COMMUNITY_URL} target="_blank" rel="noreferrer" className={cn(TOP_BTN, "border-[#229ED9]/50 bg-[#229ED9]/15 text-white hover:bg-[#229ED9]/25")}>
        <TelegramIcon className="size-5 text-[#5bc4f5]" /> {t("top.community")}
      </a>
      <a href="https://x.com/crawlhivebot" target="_blank" rel="noreferrer" className={cn(TOP_BTN, "border-white/25 bg-white/[0.06] text-white hover:bg-white/[0.12]")}>
        <span className="text-base leading-none font-black">𝕏</span> {t("top.xbot")}
        <span className="rounded bg-white px-1.5 py-px text-[9px] font-bold tracking-wide text-black">NEW</span>
      </a>
      <LangSwitcher />
      <TopWallet />
    </div>
  );
}
