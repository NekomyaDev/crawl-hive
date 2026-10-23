"use client";
// Голоса сообщества на профиле токена. Итоги и комментарии видят все; голосовать и писать могут только держатели
// (Holder и выше) с подписанной сессией кошелька. Голоса справочные: на балл и вердикт они не влияют.
// Комментарии выводятся как обычный текст (React экранирует), сервер заранее вырезает ссылки и угловые скобки.
import Link from "next/link";
import { useState } from "react";
import { ThumbsDown, ThumbsUp, Wallet } from "lucide-react";
import { useWallet } from "@/components/wallet-provider";
import { useToast } from "@/components/ui/toast";
import { useViewerTier } from "@/lib/client/use-tier";
import { useApi } from "@/lib/client/use-api";
import { post } from "@/lib/client/api";
import { TIER_NAME } from "@/lib/tier-gate";
import { cn, short, timeAgo } from "@/lib/utils";

type Target = "analysis" | "token";
interface Totals { up: number; down: number }
interface Summary {
  votes: Record<Target, Totals>;
  comments: { id: number; wallet: string; text: string; at: number }[];
  mine: { votes: Record<Target, -1 | 0 | 1>; commentsLeft: number } | null;
  voting: boolean;
}

const MAX = 280;
const LABEL: Record<Target, string> = { analysis: "The analysis", token: "The token" };
const HINT: Record<Target, string> = { analysis: "Was the CrawlHive read right?", token: "Would you hold it?" };

export function TokenVotes({ mint }: { mint: string }) {
  const { address, signedIn, connect, signIn } = useWallet();
  const { at, loading: tierLoading } = useViewerTier();
  const toast = useToast();
  // Адрес в пути только чтобы перечитать после входа (свои голоса приходят по токену сессии).
  const { data, setData } = useApi<Summary>(`/api/token/${mint}${signedIn ? `?w=${address}` : ""}`);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const canVote = signedIn && at("holder") && !!data?.voting;

  const send = async (payload: { analysis?: number; token?: number; comment?: string }) => {
    setBusy(true);
    try {
      const r = await post<Summary>(`/api/token/${mint}/vote`, payload);
      setData(r);
      return true;
    } catch (e) {
      toast((e as Error).message, "error");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const vote = (t: Target, v: 1 | -1) => send({ [t]: data?.mine?.votes[t] === v ? 0 : v });
  const comment = async () => {
    if (!text.trim()) return;
    if (await send({ comment: text })) {
      setText("");
      toast("Comment posted");
    }
  };

  return (
    <section className="rounded-xl border border-line bg-panel p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Holder votes</h2>
        <span className="text-[11px] text-muted">Advisory only, never changes the score</span>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {(["analysis", "token"] as Target[]).map((t) => {
          const v = data?.votes[t] ?? { up: 0, down: 0 };
          const mine = data?.mine?.votes[t] ?? 0;
          return (
            <div key={t} className="rounded-lg bg-panel-2 px-3 py-2">
              <div className="text-xs font-semibold">{LABEL[t]}</div>
              <div className="text-[11px] text-muted">{HINT[t]}</div>
              <div className="mt-2 flex items-center gap-2">
                {([1, -1] as const).map((dir) => {
                  const Icon = dir === 1 ? ThumbsUp : ThumbsDown;
                  const n = dir === 1 ? v.up : v.down;
                  const on = mine === dir;
                  return (
                    <button
                      key={dir}
                      type="button"
                      disabled={!canVote || busy}
                      onClick={() => vote(t, dir)}
                      aria-label={`${dir === 1 ? "Thumbs up" : "Thumbs down"} on ${LABEL[t].toLowerCase()}`}
                      aria-pressed={on}
                      className={cn(
                        "num inline-flex h-9 min-w-16 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm",
                        on ? (dir === 1 ? "border-lime/60 bg-lime/10 text-lime" : "border-danger/60 bg-danger/10 text-danger") : "border-line",
                        canVote ? "hover:border-honey/60" : "cursor-default opacity-80",
                      )}
                    >
                      <Icon className="size-4" /> {n}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {canVote ? (
        <div className="mt-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX))}
            maxLength={MAX}
            rows={2}
            placeholder="Short comment for other holders (links are removed)"
            className="w-full resize-none rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm outline-none focus:border-honey/60"
          />
          <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted">
            <span>
              {text.length}/{MAX} · {data?.mine?.commentsLeft ?? 0} left today
            </span>
            <button
              type="button"
              onClick={comment}
              disabled={busy || !text.trim() || !data?.mine?.commentsLeft}
              className="inline-flex h-8 items-center rounded-lg bg-honey px-3 text-xs font-semibold text-black hover:bg-[#ffc24d] disabled:opacity-50"
            >
              Post
            </button>
          </div>
        </div>
      ) : (
        !tierLoading && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>
              <Link href="/pricing" className="text-honey hover:underline">
                Holders can vote
              </Link>{" "}
              ({TIER_NAME.holder} tier and up).
            </span>
            {!signedIn && (
              <button
                type="button"
                onClick={() => (address ? signIn() : connect()).catch(() => {})}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 hover:border-honey/60 hover:text-honey"
              >
                <Wallet className="size-3.5" /> {address ? "Sign in" : "Connect wallet"}
              </button>
            )}
          </div>
        )
      )}

      {!!data?.comments.length && (
        <ul className="mt-4 space-y-2 border-t border-line pt-3">
          {data.comments.map((c) => (
            <li key={c.id} className="text-sm">
              <div className="text-[11px] text-muted">
                <span className="num">{short(c.wallet)}</span> · {timeAgo(c.at)}
              </div>
              <p className="break-words whitespace-pre-wrap">{c.text}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
