"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bug, LayoutGrid, Store, Trophy, Landmark, Wallet, LogOut, Plus } from "lucide-react";
import { cn, fmt, short } from "@/lib/utils";
import { Logo } from "./logo";
import { useWallet } from "./wallet-provider";
import { Button } from "./ui/button";

const LINKS = [
  { href: "/", label: "Swarm", icon: LayoutGrid },
  { href: "/spawn", label: "Spawn", icon: Plus },
  { href: "/my", label: "My Crawlers", icon: Bug },
  { href: "/market", label: "Marketplace", icon: Store },
  { href: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { href: "/governance", label: "Governance", icon: Landmark },
];

function WalletButton({ compact = false }: { compact?: boolean }) {
  const { address, info, mode, connect, disconnect } = useWallet();
  if (!address)
    return (
      <Button onClick={connect} size="sm" className="w-full">
        <Wallet className="size-4" /> Connect
      </Button>
    );
  return (
    <div className={cn("flex items-center gap-2", !compact && "rounded-lg border border-line bg-panel-2 p-2.5")}>
      <div className="min-w-0 flex-1">
        <div className="num truncate text-xs">{short(address)}</div>
        <div className="num text-xs text-honey">{info ? fmt(info.balance) : "…"} $CRAWL</div>
        {!compact && <div className="text-[10px] text-muted">{mode === "phantom" ? "Phantom" : "Demo wallet"}</div>}
      </div>
      <button onClick={disconnect} className="text-muted hover:text-fg" title="Disconnect">
        <LogOut className="size-4" />
      </button>
    </div>
  );
}

// usePathname — данные запроса, поэтому в layout Nav стоит в Suspense,
// а в fallback рендерится та же оболочка без подсветки активного пункта.
export function Nav() {
  return <NavShell path={usePathname()} />;
}

export function NavShell({ path }: { path: string }) {
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <>
      {/* десктоп: боковая панель */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-line bg-panel/60 p-3 lg:flex">
        <Link href="/" className="mb-6 flex items-center gap-2 px-2 pt-1">
          <Logo />
          <span className="text-lg font-bold tracking-tight">
            Crawl<span className="text-honey">Hive</span>
          </span>
        </Link>
        <nav className="flex flex-col gap-0.5">
          {LINKS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                active(href) ? "bg-honey/10 text-honey" : "text-muted hover:bg-panel-2 hover:text-fg",
              )}
            >
              <Icon className="size-4" />
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
            <Logo size={24} />
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
