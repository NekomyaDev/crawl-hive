import type { Metadata } from "next";
import Script from "next/script";
import { AdminDashboard } from "./dashboard";

export const metadata: Metadata = { title: "CrawlHive admin", robots: { index: false } };

export default function Page() {
  return (
    <>
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" />
      <AdminDashboard />
    </>
  );
}
