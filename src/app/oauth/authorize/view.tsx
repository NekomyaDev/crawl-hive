"use client";
// Подтверждение подключения агента (ChatGPT Dots, Meta Muse, Claude…) к краулерам по OAuth.
// Владелец выбирает, каким Grok Bot будет агент: существующим или новым над выбранными краулерами.
// Агент получает только чтение выбранных краулеров и бесплатный скан; отключить его можно в My Crawlers.
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { BotOcto } from "@/components/bot-octo";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { CrawlerPicker, type PublicBot } from "@/components/grok-bots";
import { useWallet } from "@/components/wallet-provider";
import { api, post } from "@/lib/client/api";
import { useApi } from "@/lib/client/use-api";
import type { PublicCrawler } from "@/lib/types";
import { cn } from "@/lib/utils";

const NEW = "__new";

export function AuthorizeView() {
  const q = useSearchParams();
  const { address, signedIn, connect, signIn } = useWallet();
  const clientId = q.get("client_id") ?? "";
  const redirectUri = q.get("redirect_uri") ?? "";
  const state = q.get("state") ?? "";
  const [app, setApp] = useState<{ name: string; redirectHost: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<string>(NEW);
  const [name, setName] = useState("");
  const [ids, setIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const ready = !!address && signedIn;
  const { data: crawlers } = useApi<PublicCrawler[]>(ready ? `/api/crawlers?mine=1&w=${address}` : null);
  const { data: bots } = useApi<PublicBot[]>(ready ? `/api/bots?w=${address}` : null);

  useEffect(() => {
    if (q.get("response_type") !== "code") return setError("This link is not a valid connection request. Start again from your agent.");
    api<{ name: string; redirectHost: string }>(`/api/oauth/client?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}`)
      .then((a) => {
        setApp(a);
        setName((n) => n || a.name.slice(0, 32));
      })
      .catch((e) => setError((e as Error).message));
  }, [q, clientId, redirectUri]);

  // Есть боты — по умолчанию предлагаем первого, иначе создать нового над всеми краулерами.
  useEffect(() => {
    if (bots?.length && pick === NEW && !ids.length) setPick(bots[0].id);
  }, [bots]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (crawlers && !ids.length) setIds(crawlers.map((c) => c.id));
  }, [crawlers]); // eslint-disable-line react-hooks/exhaustive-deps

  const deny = () => {
    const u = new URL(redirectUri);
    u.searchParams.set("error", "access_denied");
    if (state) u.searchParams.set("state", state);
    window.location.href = u.toString();
  };

  const allow = async () => {
    setBusy(true);
    try {
      let botId = pick;
      if (pick === NEW) botId = (await post<{ bot: PublicBot }>("/api/bots", { name, crawlerIds: ids })).bot.id;
      const { redirect } = await post<{ redirect: string }>("/api/oauth/approve", {
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: q.get("code_challenge"),
        code_challenge_method: q.get("code_challenge_method"),
        state,
        bot_id: botId,
      });
      window.location.href = redirect;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg py-10">
      <Card className="p-6">
        <div className="flex items-center gap-3">
          <BotOcto size={44} color="#ffb020" live />
          <div>
            <div className="text-lg font-semibold">{app ? `Connect ${app.name} to CrawlHive` : "Connect an AI agent"}</div>
            <div className="text-sm text-muted">It will work as a Grok Bot over the crawlers you pick.</div>
          </div>
        </div>

        {error ? (
          <p className="mt-5 rounded-lg border border-danger/40 bg-danger/[0.06] p-3 text-sm text-danger">{error}</p>
        ) : !app ? (
          <p className="mt-5 text-sm text-muted">Checking the app…</p>
        ) : !address ? (
          <div className="mt-5">
            <p className="mb-3 text-sm text-muted">Connect the wallet that owns your crawlers.</p>
            <Button onClick={() => connect()}>Connect wallet</Button>
          </div>
        ) : !signedIn ? (
          <div className="mt-5">
            <p className="mb-3 text-sm text-muted">Sign in with your wallet. It is a free signature, not a transaction.</p>
            <Button onClick={() => signIn()}>Sign in</Button>
          </div>
        ) : crawlers && !crawlers.length ? (
          <p className="mt-5 text-sm text-muted">
            You have no crawlers yet. <a href="/spawn" className="text-honey hover:underline">Spawn one</a> first, then connect your agent.
          </p>
        ) : (
          <>
            <div className="mt-5 space-y-2">
              {(bots ?? []).map((b) => (
                <label key={b.id} className={cn("flex cursor-pointer items-center gap-3 rounded-lg border p-3", pick === b.id ? "border-honey/60 bg-honey/[0.06]" : "border-line")}>
                  <input type="radio" checked={pick === b.id} onChange={() => setPick(b.id)} className="accent-[#ffb020]" />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{b.name}</span>
                    <span className="ml-2 text-xs text-muted">
                      over {b.crawlerIds.length} crawler{b.crawlerIds.length === 1 ? "" : "s"}
                    </span>
                  </span>
                </label>
              ))}
              <label className={cn("block cursor-pointer rounded-lg border p-3", pick === NEW ? "border-honey/60 bg-honey/[0.06]" : "border-line")}>
                <span className="flex items-center gap-3">
                  <input type="radio" checked={pick === NEW} onChange={() => setPick(NEW)} className="accent-[#ffb020]" />
                  <span className="font-medium">New bot</span>
                </span>
                {pick === NEW && (
                  <div className="mt-3 space-y-3">
                    <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} placeholder="Bot name" />
                    <CrawlerPicker crawlers={crawlers ?? []} value={ids} onChange={(f) => setIds(f)} />
                  </div>
                )}
              </label>
            </div>

            <ul className="mt-5 space-y-1.5 text-sm text-muted">
              <li className="flex gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-lime" />Reads signals and status of the picked crawlers, runs free token scans.</li>
              <li className="flex gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-lime" />Cannot change crawlers, spend credits or move funds.</li>
              <li className="flex gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-lime" />Disconnect any time in My Crawlers → Grok Bots.</li>
            </ul>

            <div className="mt-6 flex gap-2">
              <Button onClick={allow} disabled={busy || (pick === NEW && (!name.trim() || !ids.length))}>
                {busy ? "Connecting…" : `Allow ${app.name}`}
              </Button>
              <Button variant="ghost" onClick={deny} disabled={busy}>
                Cancel
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted">You will return to {app.redirectHost}.</p>
          </>
        )}
      </Card>
    </div>
  );
}
