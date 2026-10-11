"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Bug, LayoutGrid, Store, Trophy, Landmark, Wallet, LogOut, Plus, Radio, ShieldCheck } from "lucide-react";
import { cn, fmt, short } from "@/lib/utils";
import { Logo } from "./logo";
import { useWallet } from "./wallet-provider";
import { Button } from "./ui/button";

const LINKS = [
  { href: "/", label: "Swarm", icon: LayoutGrid, color: "text-honey" },
  { href: "/spawn", label: "Spawn", icon: Plus, color: "text-coral" },
  { href: "/my", label: "My Crawlers", icon: Bug, color: "text-lime" },
  { href: "/signals", label: "My Signals", icon: Radio, color: "text-teal" },
  { href: "/market", label: "Marketplace", icon: Store, color: "text-pink" },
  { href: "/leaderboard", label: "Leaderboard", icon: Trophy, color: "text-sky" },
  { href: "/governance", label: "Governance", icon: Landmark, color: "text-violet" },
];

function WalletButton({ compact = false }: { compact?: boolean }) {
  const { address, info, mode, signedIn, connect, signIn, disconnect } = useWallet();
  if (!address)
    return (
      <div className="flex w-full flex-col gap-1.5">
        <Button onClick={() => connect()} size="sm" className="w-full">
          <Wallet className="size-4" /> Connect
        </Button>
        {/* Подсказка у кнопки: что на самом деле происходит при подключении. */}
        {!compact && (
          <Link href="/#wallet-safety" className="flex items-center justify-center gap-1 text-[11px] text-muted hover:text-lime">
            <ShieldCheck className="size-3" /> Is it safe? Read-only until you pay
          </Link>
        )}
      </div>
    );
  return (
    <div className={cn("flex items-center gap-2", !compact && "rounded-lg border border-line bg-panel-2 p-2.5")}>
      <div className="min-w-0 flex-1">
        <div className="num truncate text-xs">{short(address)}</div>
        {signedIn ? (
          <div className="num text-xs text-honey">{info ? fmt(info.balance) : "…"} credits</div>
        ) : (
          <button onClick={() => signIn().catch(() => {})} className="text-xs font-medium text-honey hover:underline">
            Sign in to continue
          </button>
        )}
        {!compact && <div className="text-[10px] text-muted">{mode === "phantom" ? "Phantom · Solana" : mode === "evm" ? "EVM wallet · Robinhood Chain" : "Demo wallet"}</div>}
      </div>
      <button onClick={disconnect} className="text-muted hover:text-fg" title="Disconnect">
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
  return (
    <>
      {/* десктоп: боковая панель */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-line bg-panel/60 p-3 lg:flex">
        <Link href="/" className="mb-6 flex items-center gap-2 px-2 pt-1">
          <Logo size={34} />
          <span className="text-lg font-bold tracking-tight">
            Crawl<span className="text-honey">Hive</span>
          </span>
        </Link>
        <nav className="flex flex-col gap-0.5">
          {LINKS.map(({ href, label, icon: Icon, color }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                active(href) ? "bg-gradient-to-r from-honey/15 to-transparent text-fg" : "text-muted hover:bg-panel-2 hover:text-fg",
              )}
            >
              {active(href) && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-gradient-to-b from-honey to-pink" />}
              <Icon className={cn("size-4", color)} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto">
          <WalletButton />
        </div>
      </aside>

      {/* мобильный: верхняя полоса + горизонтальные вкладки */}
      <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur lg:hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
          <Link href="/" className="flex items-center gap-2">
            <Logo size={30} />
            <span className="font-bold">
              Crawl<span className="text-honey">Hive</span>
            </span>
          </Link>
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
              {label}
            </Link>
          ))}
        </nav>
      </header>
    </>
  );
}
