// «Почему подключать кошелёк безопасно»: на главной, рядом с казной. Каждый пункт — то, что реально делает код
// (auth.ts — подпись сообщения, solana.ts — одна транзакция с переводом и memo), чтобы доверие было проверяемым.
import { Ban, Eye, FileSignature, ShieldCheck, Wallet } from "lucide-react";

const TREASURY = "DgCogtUuki6MZzypK1dKHYWfHLMUnKkNUBQwo6rWTGUJ";
const CODE = "https://github.com/h100envy/crawl-hive/blob/main/src/lib/server";

const STEPS = [
  {
    icon: Eye,
    tone: "text-sky",
    title: "Connect = your public address",
    text: "Phantom, MetaMask or Rabby shares only the address anyone can already see in a block explorer. No balances move, nothing is signed.",
  },
  {
    icon: FileSignature,
    tone: "text-violet",
    title: "Sign in = a text message",
    text: "You sign a plain message with a one-time code. It proves the wallet is yours. Not a transaction, costs nothing, expires in 5 minutes.",
    link: { href: `${CODE}/auth.ts`, label: "auth.ts" },
  },
  {
    icon: Wallet,
    tone: "text-honey",
    title: "Pay = one transfer you approve",
    text: "Only when you spawn or renew a crawler: one transfer of the price shown, in SOL on Solana or in ETH on Robinhood Chain, tagged with the payment id. Your wallet shows the exact amount before you confirm.",
    link: { href: `${CODE}/solana.ts`, label: "solana.ts · robinhood.ts" },
  },
  {
    icon: ShieldCheck,
    tone: "text-lime",
    title: "Checked on-chain, in the open",
    text: "The server accepts a payment only after reading it on-chain. Every payment lands in the public treasury, so anyone can audit it.",
    link: { href: `https://solscan.io/account/${TREASURY}`, label: "treasury on Solscan" },
  },
];

const NEVER = ["your seed phrase or private key", "token approvals or delegation", "access to your other tokens or NFTs", "a signature you can't read"];

export function WalletSafety({ className = "" }: { className?: string }) {
  return (
    <section id="wallet-safety" className={`scroll-mt-6 overflow-hidden rounded-2xl border border-line bg-panel/70 ${className}`}>
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-line px-5 py-4">
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium tracking-wider text-lime uppercase">
            <ShieldCheck className="size-3.5" /> Wallet safety
          </div>
          <h2 className="text-xl font-bold tracking-tight">Why connecting your wallet is safe</h2>
        </div>
        <p className="max-w-sm text-xs text-muted">Instant Crawl needs no wallet at all. You connect only to run your own crawlers, and here is everything that happens.</p>
      </div>

      <ol className="grid gap-px bg-line sm:grid-cols-2 xl:grid-cols-4">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex flex-col gap-2 bg-panel p-5">
            <div className="flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-lg bg-panel-2">
                <s.icon className={`size-4 ${s.tone}`} />
              </span>
              <span className="num text-xs text-muted">{i + 1}</span>
            </div>
            <h3 className="text-sm font-semibold">{s.title}</h3>
            <p className="text-xs leading-relaxed text-muted">{s.text}</p>
            {s.link && (
              <a href={s.link.href} target="_blank" rel="noreferrer" className="num mt-auto text-[11px] text-honey hover:underline">
                verify: {s.link.label} ↗
              </a>
            )}
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-5 py-3 text-xs">
        <span className="flex items-center gap-1.5 font-semibold text-danger">
          <Ban className="size-3.5" /> CrawlHive never asks for
        </span>
        {NEVER.map((n) => (
          <span key={n} className="text-muted">
            ✕ {n}
          </span>
        ))}
        <a href="https://github.com/h100envy/crawl-hive" target="_blank" rel="noreferrer" className="ml-auto text-honey hover:underline">
          the code is open source ↗
        </a>
      </div>
    </section>
  );
}
