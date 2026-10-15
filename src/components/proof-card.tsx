"use client";
// Onchain Proof на странице Track Record: корни Меркла, записанные в Solana, и проверка любой записи
// прямо в браузере. Лист и путь до корня пересчитываются здесь через WebCrypto, а memo с корнем читается
// из публичного RPC Solana, так что сайту верить не нужно.
import { useState } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useApi } from "@/lib/client/use-api";
import { api } from "@/lib/client/api";
import { cn, fmt, short, timeAgo } from "@/lib/utils";

interface Batch {
  from: number;
  to: number;
  root: string;
  count: number;
  sig: string | null;
  status: string;
  memo: string;
}
interface Summary {
  windowMinutes: number;
  notary: string | null;
  since: number | null;
  batches: number;
  records: number;
  onchain: number;
  latest: Batch[];
}
interface Match extends Batch {
  record: Record<string, unknown>;
  leaf: string;
  proof: { side: "L" | "R"; hash: string }[];
}
type Check = { leaf: boolean; root: boolean; chain: boolean | null; note?: string };

const PUBLIC_RPC = "https://api.mainnet-beta.solana.com";
const tx = (sig: string) => `https://solscan.io/tx/${sig}`;

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (h: string) => new Uint8Array(h.match(/../g)!.map((x) => parseInt(x, 16)));
const sha = async (...parts: Uint8Array[]) => {
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.length;
  }
  return hex(await crypto.subtle.digest("SHA-256", all));
};
const canon = (o: Record<string, unknown>) => JSON.stringify(o, Object.keys(o).sort());

async function verify(m: Match): Promise<Check> {
  const leaf = await sha(new Uint8Array([0]), new TextEncoder().encode(canon(m.record)));
  let h = leaf;
  for (const p of m.proof) h = p.side === "L" ? await sha(new Uint8Array([1]), unhex(p.hash), unhex(h)) : await sha(new Uint8Array([1]), unhex(h), unhex(p.hash));
  const out: Check = { leaf: leaf === m.leaf, root: h === m.root, chain: null };
  if (!m.sig) return { ...out, note: "Root is waiting to be written onchain." };
  try {
    const r = await fetch(PUBLIC_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [m.sig, { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" }] }),
    }).then((x) => x.json());
    const logs: string[] = r?.result?.meta?.logMessages ?? [];
    out.chain = logs.some((l) => l.includes(`:${h}`));
    if (!r?.result) out.note = "Transaction not found yet, try again in a minute.";
  } catch {
    out.note = "Could not reach the Solana RPC, open the transaction on Solscan instead.";
  }
  return out;
}

function Mark({ ok, label }: { ok: boolean | null; label: string }) {
  return (
    <span className={cn("flex items-center gap-1.5", ok === null ? "text-muted" : ok ? "text-lime" : "text-danger")}>
      {ok === null ? "…" : ok ? "✓" : "✗"} {label}
    </span>
  );
}

function Result({ m }: { m: Match }) {
  const [check, setCheck] = useState<Check | null>(null);
  const [busy, setBusy] = useState(false);
  const r = m.record;
  return (
    <div className="rounded-lg border border-line bg-panel-2/60 p-3 text-xs">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">
          {r.t === "verdict" ? `Verdict ${String(r.verdict)} on $${String(r.symbol)}` : `Crawler signal ${String(r.kind)}`}
          <span className="ml-2 font-normal text-muted">{new Date(Number(r.t === "verdict" ? r.at : r.ts)).toUTCString().slice(5, 22)} UTC</span>
        </span>
        <span className="text-muted">
          window {new Date(m.from).toISOString().slice(11, 16)}–{new Date(m.to).toISOString().slice(11, 16)} · {m.count} records
        </span>
      </div>
      <pre className="num mb-2 overflow-x-auto rounded bg-bg/60 p-2 text-[10px] text-fg/80">{canon(r)}</pre>
      <div className="num space-y-0.5 text-[10px] text-muted">
        <div className="truncate">leaf {m.leaf}</div>
        <div className="truncate">root {m.root}</div>
        <div>path {m.proof.length} steps</div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setCheck(await verify(m));
            setBusy(false);
          }}
        >
          {busy ? "Checking…" : "Verify in my browser"}
        </Button>
        {m.sig ? (
          <a href={tx(m.sig)} target="_blank" rel="noreferrer" className="text-honey hover:underline">
            Root on Solscan ↗
          </a>
        ) : (
          <span className="text-muted">Root pending onchain</span>
        )}
      </div>
      {check && (
        <div className="mt-2 flex flex-wrap gap-4">
          <Mark ok={check.leaf} label="record hashes to the leaf" />
          <Mark ok={check.root} label="path leads to the root" />
          <Mark ok={check.chain} label="root is in the Solana memo" />
          {check.note && <span className="text-muted">{check.note}</span>}
        </div>
      )}
    </div>
  );
}

export function ProofCard() {
  const { data } = useApi<Summary>("/api/proof", 60000);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Match[] | null>(null);
  const [err, setErr] = useState("");

  const search = async () => {
    setErr("");
    setFound(null);
    try {
      const r = await api<{ matches: Match[] }>(`/api/proof?q=${encodeURIComponent(q.trim())}`);
      setFound(r.matches);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <Card className="mb-5">
      <CardHeader
        title="⛓ Onchain proof"
        sub={`Every ${data?.windowMinutes ?? 15} minutes all new verdicts and crawler signals are hashed into a Merkle tree, and its root is written to Solana. Nothing here can be edited or deleted after the price moves: the root would stop matching.`}
      />
      <div className="grid gap-5 p-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>
              <span className="num font-semibold text-honey">{data ? fmt(data.records) : "—"}</span> <span className="text-muted">records committed</span>
            </span>
            <span>
              <span className="num font-semibold">{data ? fmt(data.onchain) : "—"}</span> <span className="text-muted">roots onchain</span>
            </span>
            {data?.notary && (
              <span className="text-muted">
                signed by{" "}
                <a href={`https://solscan.io/account/${data.notary}`} target="_blank" rel="noreferrer" className="num text-fg hover:text-honey">
                  {short(data.notary)}
                </a>
              </span>
            )}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (q.trim()) search();
            }}
          >
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Token address or signal id" className="num" />
            <Button type="submit" disabled={!q.trim()}>
              Find proof
            </Button>
          </form>
          {err && <p className="text-xs text-danger">{err}</p>}
          {found && !found.length && <p className="text-xs text-muted">No committed record for this yet. New records are committed at the end of each {data?.windowMinutes ?? 15}-minute window.</p>}
          {found?.map((m) => <Result key={m.leaf} m={m} />)}
          <p className="text-[11px] text-muted">
            Leaf = sha256(0x00 ‖ record JSON with sorted keys), node = sha256(0x01 ‖ left ‖ right), memo = crawlhive:proof:v1:&lt;from&gt;:&lt;count&gt;:&lt;root&gt;. Private crawler signals are committed as a salted hash, so
            their tokens stay hidden. The proof shows records were not changed later; it cannot show a record was never left out before its window closed.
          </p>
        </div>
        <div>
          <div className="mb-2 text-[11px] tracking-wider text-muted uppercase">Latest roots</div>
          {data?.latest.length ? (
            <ul className="divide-y divide-line/60 text-xs">
              {data.latest.map((b) => (
                <li key={b.from} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="min-w-0">
                    <span className="num">{new Date(b.from).toISOString().slice(5, 16).replace("T", " ")}</span>
                    <span className="num ml-2 text-muted">{b.root.slice(0, 10)}… · {b.count}</span>
                  </span>
                  {b.sig ? (
                    <a href={tx(b.sig)} target="_blank" rel="noreferrer" className={cn("shrink-0 hover:underline", b.status === "onchain" ? "text-lime" : "text-honey")}>
                      {b.status === "onchain" ? "onchain ↗" : "sending ↗"}
                    </a>
                  ) : (
                    <span className="shrink-0 text-muted">pending</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted">The first root is written at the end of the current {data?.windowMinutes ?? 15}-minute window{data?.since ? ` (since ${timeAgo(data.since)})` : ""}.</p>
          )}
        </div>
      </div>
    </Card>
  );
}
