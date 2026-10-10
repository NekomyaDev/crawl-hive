"use client";
// Governance: холдеры голосуют за приоритеты краулинга, награды и параметры сети.
// Вес голоса = баланс credits в момент голосования.
import { useState } from "react";
import { Check, Plus, X as Close } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Label, Segmented, Textarea } from "@/components/ui/field";
import { useWallet } from "@/components/wallet-provider";
import { useToast } from "@/components/ui/toast";
import { useApi } from "@/lib/client/use-api";
import { post } from "@/lib/client/api";
import { PROPOSAL_MIN_BALANCE, CREDITS } from "@/lib/economy";
import type { Proposal } from "@/lib/types";
import { cn, fmt, short, timeLeft } from "@/lib/utils";

type P = Proposal & { myVote: string | null };

const KIND_LABEL: Record<Proposal["kind"], string> = {
  priority: "Crawl priority",
  rewards: "Rewards",
  params: "Network params",
};

export default function Governance() {
  const { address, info, connect, mode } = useWallet();
  const toast = useToast();
  // Ключ зависит от кошелька, чтобы сервер вернул мой голос.
  const { data, reload } = useApi<P[]>(`/api/governance?w=${address}`, 6000);
  const [creating, setCreating] = useState(false);

  const vote = async (p: P, optionId: string) => {
    if (!address) return connect();
    try {
      await post(`/api/governance/${p.id}`, { optionId });
      toast(`Voted with ${fmt(info?.balance ?? 0)} ${CREDITS}`);
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <>
      <PageHeader
        title="Swarm Governance"
        sub={`Holders steer the swarm: which narratives get boosted, how rewards split, how reputation is weighted. One credit = one vote; you can change your vote until it closes.`}
        action={
          <Button variant="outline" onClick={() => (address ? setCreating((x) => !x) : connect())}>
            <Plus className="size-4" /> New proposal
          </Button>
        }
      />

      {address && (
        <div className="mb-5 text-sm text-muted">
          Your voting power: <span className="num font-semibold text-honey">{fmt(info?.balance ?? 0)}</span> {CREDITS}
          {mode === "demo" && " (demo)"}
        </div>
      )}

      {creating && <CreateProposal onDone={() => (setCreating(false), reload())} />}

      <div className="grid gap-4 lg:grid-cols-2">
        {(data ?? []).map((p) => {
          const total = p.options.reduce((s, o) => s + o.votes, 0) || 1;
          const lead = [...p.options].sort((a, b) => b.votes - a.votes)[0];
          const ended = p.endsAt < Date.now();
          return (
            <Card key={p.id} className="flex flex-col p-5">
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="num text-muted">{p.id}</span>
                <Badge>{KIND_LABEL[p.kind]}</Badge>
                <span className={cn("num ml-auto", ended ? "text-muted" : "text-honey")}>{timeLeft(p.endsAt)}</span>
              </div>
              <h3 className="mt-2 font-semibold leading-snug">{p.title}</h3>
              <p className="mt-1 text-sm text-muted">{p.description}</p>
              <div className="mt-4 space-y-2">
                {p.options.map((o) => {
                  const pct = (o.votes / total) * 100;
                  const mine = p.myVote === o.id;
                  return (
                    <button
                      key={o.id}
                      disabled={ended}
                      onClick={() => vote(p, o.id)}
                      className={cn(
                        "relative w-full overflow-hidden rounded-lg border px-3 py-2 text-left transition-colors",
                        mine ? "border-honey/70" : "border-line hover:border-honey/40",
                      )}
                    >
                      <div
                        className={cn("absolute inset-y-0 left-0", o.id === lead.id ? "bg-honey/15" : "bg-panel-2")}
                        style={{ width: `${pct}%` }}
                      />
                      <div className="relative flex items-center justify-between gap-2 text-sm">
                        <span className="flex items-center gap-1.5">
                          {mine && <Check className="size-3.5 text-honey" />}
                          {o.label}
                        </span>
                        <span className="num text-xs text-muted">
                          {fmt(o.votes)} · {pct.toFixed(1)}%
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 text-[11px] text-muted">
                by <span className="num">{short(p.author)}</span> · {fmt(total)} {CREDITS} voted
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}

function CreateProposal({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<Proposal["kind"]>("priority");
  const [options, setOptions] = useState(["", ""]);
  const [days, setDays] = useState(3);

  const submit = async () => {
    try {
      await post("/api/governance", { title, description, kind, options, days });
      toast("Proposal is live");
      onDone();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <Card className="mb-5 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold">New proposal</h3>
        <span className="text-[11px] text-muted">needs {fmt(PROPOSAL_MIN_BALANCE)} {CREDITS} balance</span>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <Label>Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Boost Telegram crawlers for 7 days" maxLength={90} />
        </div>
        <div className="md:col-span-2">
          <Label>Why</Label>
          <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={600} />
        </div>
        <div>
          <Label>Type</Label>
          <Segmented options={["priority", "rewards", "params"] as const} value={kind} onChange={setKind} render={(k) => KIND_LABEL[k]} />
        </div>
        <div>
          <Label>Voting period, days</Label>
          <Input type="number" min={1} max={14} value={days} onChange={(e) => setDays(Number(e.target.value))} />
        </div>
        <div className="md:col-span-2">
          <Label hint="2–6">Options</Label>
          <div className="space-y-2">
            {options.map((o, i) => (
              <div key={i} className="flex gap-2">
                <Input value={o} onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Option ${i + 1}`} />
                {options.length > 2 && (
                  <Button variant="ghost" onClick={() => setOptions(options.filter((_, j) => j !== i))}>
                    <Close className="size-4" />
                  </Button>
                )}
              </div>
            ))}
            {options.length < 6 && (
              <Button variant="ghost" size="sm" onClick={() => setOptions([...options, ""])}>
                <Plus className="size-3" /> Add option
              </Button>
            )}
          </div>
        </div>
      </div>
      <Button className="mt-4" onClick={submit}>
        Publish proposal
      </Button>
    </Card>
  );
}
