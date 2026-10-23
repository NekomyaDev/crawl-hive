import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Nav, TopBar } from "@/components/nav";
import { WalletProvider } from "@/components/wallet-provider";
import { ToastProvider } from "@/components/ui/toast";
import { Mascot } from "@/components/mascot";
import { TelegramFab } from "@/components/telegram-cta";
import { RefCapture } from "@/components/ref-capture";
import { LangProvider, T } from "@/components/lang-provider";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  // Абсолютные ссылки на превью (og:image) для X и Telegram.
  metadataBase: new URL(process.env.PUBLIC_URL?.trim() || "https://crawlhive.xyz"),
  title: "CrawlHive: the crawler swarm",
  description: "Free memecoin safety scans on Solana, BNB Chain, Robinhood Chain and Base: bundles, snipers, linked operators, a bubble map of who really holds it, LP locks and dev history. Spawn a crawler, join the swarm.",
  // Без явных og-тегов Telegram и X держат старое превью ссылки; текст короче, под карточку.
  openGraph: {
    type: "website",
    siteName: "CrawlHive",
    title: "CrawlHive: free memecoin safety scanner",
    description: "Drop any CA: bundles, snipers, dev history, LP and a bubble map of who holds it. Solana, BNB, Base, Robinhood. Bots on X and Telegram.",
  },
  twitter: {
    card: "summary_large_image",
    site: "@crawlhivexyz",
    title: "CrawlHive: free memecoin safety scanner",
    description: "Drop any CA: bundles, snipers, dev history, LP and a bubble map of who holds it. Solana, BNB, Base, Robinhood.",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="hive-bg min-h-full font-sans">
        <LangProvider>
        <WalletProvider>
          <ToastProvider>
            <div className="flex min-h-screen flex-col lg:flex-row">
              <Nav />
              <main className="flex min-w-0 flex-1 flex-col px-4 py-5 lg:px-8 lg:py-7">
                <TopBar />
                <div className="flex-1">{children}</div>
                <footer data-chrome className="mt-10 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-4 text-[11px] text-muted">
                  <span>
                    <T k="footer.disclaimer" />
                  </span>
                  <Link href="/terms" className="hover:text-fg">
                    <T k="footer.terms" />
                  </Link>
                  <a href="https://github.com/h100envy/crawl-hive" target="_blank" rel="noreferrer" className="hover:text-fg">
                    <T k="footer.source" />
                  </a>
                  <a href="https://t.me/crawlhive" target="_blank" rel="noreferrer" className="hover:text-fg">
                    <T k="footer.tg" />
                  </a>
                  <a href="https://x.com/crawlhivexyz" target="_blank" rel="noreferrer" className="hover:text-fg">
                    X
                  </a>
                  <a href="https://x.com/crawlhivebot" target="_blank" rel="noreferrer" className="hover:text-fg">
                    <T k="footer.xbot" />
                  </a>
                </footer>
              </main>
            </div>
            <Mascot />
            <TelegramFab />
            <RefCapture />
          </ToastProvider>
        </WalletProvider>
        </LangProvider>
      </body>
    </html>
  );
}
