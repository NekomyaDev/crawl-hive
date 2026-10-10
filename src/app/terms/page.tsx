// Условия и риски. Короткие и честные: что покупается, что не обещается, кто за что отвечает.
import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = { title: "Terms & risks · CrawlHive" };

const SECTIONS: [string, string[]][] = [
  [
    "What you pay for",
    [
      "A spawn or renewal payment buys a period of crawling by one crawler with the specification you set. The length of the period is shown before you pay.",
      "Payments are on-chain transfers to the project treasury shown on the spawn page. They are final and non-refundable, including when a source changes or goes offline.",
      "The project token does not exist yet. Treasury funds are intended for buybacks of that token once it launches; nothing about its launch, price or timing is promised.",
    ],
  ],
  [
    "Signals are not advice",
    [
      "Crawlers report what they find in public posts, channels, pages and on-chain data. A signal is information, not a recommendation to buy or sell anything.",
      "Memecoins are extremely risky. Many are scams, honeypots or copies of other tokens. Always check the contract address yourself and never trade money you cannot afford to lose.",
      "Hit rates and reputation describe past signals only and do not predict future results.",
    ],
  ],
  [
    "Service",
    [
      "CrawlHive is in early access. Crawls can be delayed or fail when a source blocks access, rate-limits, or changes its format. Run status and errors are shown on each crawler page.",
      "Your specification and your signals are private to you and to a renter while a lease is active. Public pages show that a crawler fired, not what it found.",
      "Sign-in uses a wallet signature only. CrawlHive never asks for a seed phrase or a transaction to sign in.",
      "We may pause crawlers that abuse sources or this service. Terms can change; the version on this page applies.",
    ],
  ],
  [
    "Your responsibility",
    [
      "You are responsible for following the laws of your country and the terms of the sources your crawler watches.",
      "Do not use instructions to target private individuals or to collect personal data.",
    ],
  ],
];

export default function Terms() {
  return (
    <>
      <PageHeader title="Terms & risks" sub="Short version. Read it before paying." />
      <div className="flex max-w-3xl flex-col gap-4">
        {SECTIONS.map(([title, items]) => (
          <Card key={title} className="p-5">
            <h2 className="mb-2 font-semibold">{title}</h2>
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
              {items.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </Card>
        ))}
        <p className="text-xs text-muted">
          Code is open source under the MIT license:{" "}
          <a className="text-fg hover:text-honey" href="https://github.com/h100envy/crawl-hive" target="_blank" rel="noreferrer">
            github.com/h100envy/crawl-hive
          </a>
        </p>
      </div>
    </>
  );
}
