import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/nav";
import { WalletProvider } from "@/components/wallet-provider";
import { ToastProvider } from "@/components/ui/toast";
import { Mascot } from "@/components/mascot";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "CrawlHive — the crawler swarm",
  description: "Spawn a crawler, join the swarm. Reputation, marketplace, leaderboard and governance for memecoin data.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="hive-bg min-h-full font-sans">
        <WalletProvider>
          <ToastProvider>
            <div className="flex min-h-screen flex-col lg:flex-row">
              <Nav />
              <main className="min-w-0 flex-1 px-4 py-5 lg:px-8 lg:py-7">{children}</main>
            </div>
            <Mascot />
          </ToastProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
