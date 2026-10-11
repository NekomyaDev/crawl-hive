"use client";
// Grok Bots на странице My Crawlers: необязательное подключение своего ИИ-агента (Grok Bot, Claude, Cursor)
// к краулерам через MCP. Бота ставят над одним, двумя или всеми краулерами; ключ показывается один раз.
import { useState } from "react";
import { Check, Copy, Trash2 } from "lucide-react";
import { BotOcto } from "@/components/bot-octo";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { del, patch, post } from "@/lib/client/api";
import type { PublicCrawler } from "@/lib/types";
import { SOURCE_META, cn } from "@/lib/utils";

export interface PublicBot {
  id: string;
  name: string;
  keyTail: string;
  crawlerIds: string[];
  createdAt: number;
  lastSeenAt?: number;
  calls: number;
  live: boolean;
}

const MCP_URL = "https://crawlhive.xyz/mcp";

const ROUTINE = `Every hour: call CrawlHive whats_new.
If changed is false, stop.
Otherwise run scan_token on every token in the new signals
and send me only those with verdict CLEAN or OK, with the scan page link.`;

function CopyBox({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <div>
      <div className="mb-1 text-[11px] text-muted">{label}</div>
      <div className="flex items-start gap-2 rounded-lg border border-line bg-panel-2 p-2">
        <pre className={cn("min-w-0 flex-1 whitespace-pre-wrap break-all text-xs", mono && "num")}>{value}</pre>
        <button
          onClick={() => {
            navigator.clipboard?.writeText(value).then(() => {
              setDone(true);
              setTimeout(() => setDone(false), 1500);
            });
          }}
          className="shrink-0 text-muted hover:text-honey"
          aria-label={`Copy ${label}`}
        >
          {done ? <Check className="size-4 text-lime" /> : <Copy className="size-4" />}
        </button>
      </div>
    </div>
  );
}

// Выбор краулеров, над которыми стоит бот: чипы с цветом источника и кнопка «все».
// onChange получает функцию от текущего выбора: два быстрых клика подряд не затирают друг друга.
function CrawlerPicker({ crawlers, value, onChange }: { crawlers: PublicCrawler[]; value: string[]; onChange: (f: (v: string[]) => string[]) => void }) {
  const allOn = crawlers.length > 0 && crawlers.every((c) => value.includes(c.id));
  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        type="button"
        onClick={() => onChange(() => (allOn ? [] : crawlers.map((c) => c.id)))}
        className={cn("rounded-lg border px-2.5 py-1 text-xs", allOn ? "border-honey/60 bg-honey/10 text-honey" : "border-line text-muted hover:text-fg")}
      >
        All crawlers
      </button>
      {crawlers.map((c) => {
        const on = value.includes(c.id);
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onChange((v) => (v.includes(c.id) ? v.filter((x) => x !== c.id) : [...v, c.id]))}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors",
              on ? "border-honey/60 bg-honey/10 text-fg" : "border-line text-muted hover:text-fg",
            )}
          >
            {on ? <BotOcto size={14} color={SOURCE_META[c.source].color} /> : <span className="size-2 rounded-full" style={{ background: SOURCE_META[c.source].color }} />}
            {c.name}
          </button>
        );
      })}
    </div>
  );
}

const ago = (t?: number) => {
  if (!t) return "never connected";
  const m = Math.round((Date.now() - t) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

export function GrokBots({ crawlers, bots, reload }: { crawlers: PublicCrawler[]; bots: PublicBot[]; reload: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("My Grok Bot");
  const [pick, setPick] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ name: string; key: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editPick, setEditPick] = useState<string[]>([]);

  const create = async () => {
    setBusy(true);
    try {
      const r = await post<{ bot: PublicBot; key: string }>("/api/bots", { name, crawlerIds: pick });
      setCreated({ name: r.bot.name, key: r.key });
      setOpen(false);
      setPick([]);
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (id: string) => {
    try {
      await patch(`/api/bots/${id}`, { crawlerIds: editPick });
      setEditing(null);
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const revoke = async (b: PublicBot) => {
    try {
      await del(`/api/bots/${b.id}`);
      reload();
      toast(`${b.name} disconnected, its key no longer works`);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const byId = new Map(crawlers.map((c) => [c.id, c]));

  return (
    <Card className="mt-8 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-gradient-to-r from-honey/[0.07] to-transparent px-4 py-4">
        <div className="flex items-start gap-3">
          <BotOcto size={44} color="#ffb020" live />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">Grok Bots</h2>
              <span className="rounded-md border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted">optional</span>
            </div>
            <p className="mt-0.5 max-w-xl text-sm text-muted">
              Put your Grok Bot on duty over one crawler, two, or the whole family. Your crawlers watch 24/7 for cents; the bot wakes up only when there is
              something new, so it stops burning credits on empty runs. Works with any MCP agent: Grok Bot, Claude, Cursor.
            </p>
          </div>
        </div>
        {crawlers.length > 0 && !open && (
          <Button size="sm" onClick={() => setOpen(true)}>
            Connect a bot
          </Button>
        )}
      </div>

      <div className="space-y-4 p-4">
        {!crawlers.length && <p className="text-sm text-muted">Spawn a crawler first, then put a Grok Bot on duty over it.</p>}

        {open && (
          <div className="space-y-3 rounded-xl border border-honey/30 bg-panel-2/50 p-3">
            <div>
              <div className="mb-1 text-xs font-medium">Bot name</div>
              <Input value={name} maxLength={32} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <div className="mb-1 text-xs font-medium">On duty over</div>
              <CrawlerPicker crawlers={crawlers} value={pick} onChange={setPick} />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={create} disabled={busy || !pick.length || !name.trim()}>
                {busy ? "Creating…" : "Create bot key"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {created && (
          <div className="space-y-3 rounded-xl border border-lime/40 bg-lime/[0.04] p-3">
            <div className="text-sm font-semibold">
              {created.name} is ready. Copy the key now: it is shown only once.
            </div>
            <CopyBox label="MCP server URL" value={MCP_URL} />
            <CopyBox label="Header (Authorization)" value={`Bearer ${created.key}`} />
            <CopyBox label="Routine for your bot (paste into Grok Bot)" value={ROUTINE} mono={false} />
            <p className="text-xs text-muted">
              In Grok Bot add a custom MCP server with this URL and header. Clients that only take a URL can use <span className="num">{MCP_URL}?key=…</span>.
              The bot sees only the crawlers you picked and can never move funds.
            </p>
            <Button size="sm" variant="outline" onClick={() => setCreated(null)}>
              Done, I saved it
            </Button>
          </div>
        )}

        {bots.map((b) => (
          <div key={b.id} className="rounded-xl border border-line p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <BotOcto size={30} color={b.live ? "#a3e635" : "#8a9099"} live={b.live} />
                <div>
                  <div className="font-semibold">{b.name}</div>
                  <div className="num text-[11px] text-muted">
                    {b.id} · key …{b.keyTail} · {b.live ? <span className="text-lime">on duty</span> : ago(b.lastSeenAt)} · {b.calls} call{b.calls === 1 ? "" : "s"}
                  </div>
                </div>
              </div>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditing(editing === b.id ? null : b.id);
                    setEditPick(b.crawlerIds);
                  }}
                >
                  {editing === b.id ? "Close" : "Change crawlers"}
                </Button>
                <Button size="sm" variant="danger" onClick={() => revoke(b)} aria-label={`Disconnect ${b.name}`}>
                  <Trash2 className="size-3" />
                </Button>
              </div>
            </div>
            {editing === b.id ? (
              <div className="mt-3 space-y-2">
                <CrawlerPicker crawlers={crawlers} value={editPick} onChange={setEditPick} />
                <Button size="sm" onClick={() => saveEdit(b.id)} disabled={!editPick.length}>
                  Save
                </Button>
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {b.crawlerIds.map((id) => {
                  const c = byId.get(id);
                  return (
                    <span key={id} className="flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[11px]">
                      <BotOcto size={13} color={c ? SOURCE_META[c.source].color : "#8a9099"} />
                      {c?.name ?? id}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
