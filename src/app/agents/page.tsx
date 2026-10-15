"use client";
// Для агентов: все способы подключить CrawlHive (x402, A2A, MCP, OpenAPI) и живая проверка оплаты x402 через Phantom.
import { PageHeader } from "@/components/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { TryX402 } from "@/components/grok-bots";

const ROWS: [string, string, string][] = [
  ["x402", "/api/x402/scan?q=…", "Pay per scan in USDC on Solana: $0.01, or $0.05 with the X check. No account, no key."],
  ["A2A", "/.well-known/agent-card.json", "Agent card; talk to the agent with JSON-RPC SendMessage at /a2a. Free scans, proofs, track record."],
  ["MCP", "/mcp", "MCP server, listed in the official MCP Registry as xyz.crawlhive/crawlhive."],
  ["OpenAPI", "/openapi.json", "Every endpoint with prices for x402 catalogs."],
  ["Proof", "/api/proof?q=…", "Merkle proof that a verdict was committed to Solana before the price moved."],
  ["LLMs", "/llms.txt", "Short description of the site for language models."],
];

export default function AgentsPage() {
  return (
    <>
      <PageHeader title="For agents" sub="CrawlHive speaks every way an AI agent finds and pays for a service: x402, A2A, MCP and OpenAPI." />
      <Card className="mb-5">
        <CardHeader title="Endpoints" />
        <ul className="divide-y divide-line/60">
          {ROWS.map(([k, path, note]) => (
            <li key={k} className="grid gap-1 px-4 py-2.5 text-sm sm:grid-cols-[90px_280px_1fr] sm:gap-3">
              <span className="font-semibold text-honey">{k}</span>
              <a href={path.replace("…", "%24BONK")} className="num truncate text-fg hover:text-honey">
                {path}
              </a>
              <span className="text-muted">{note}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Pay per call with x402" sub="The same USDC payment an agent makes. Phantom only signs; the facilitator pays the network fee and settles only if the scan succeeds." />
        <div className="p-4 pt-1">
          <TryX402 price="0.01" />
        </div>
      </Card>
    </>
  );
}
