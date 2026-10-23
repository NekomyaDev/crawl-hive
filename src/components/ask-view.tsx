"use client";
// Ask CrawlHive: чат с ИИ, который отвечает только по данным CrawlHive (api/ask, ask.ts). Ответ приходит потоком SSE.
// AskChat общий для сайта и мини-аппа Telegram: заголовки доступа и открытие ссылок передаются снаружи.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2, MessageSquare, Send } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { useWallet } from "@/components/wallet-provider";
import { sessionHeaders } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { useT } from "@/components/lang-provider";
import type { DictKey, TFn } from "@/lib/i18n";

interface Turn { role: "user" | "assistant"; text: string }
interface Status { enabled?: boolean; disabled?: boolean; tier?: string; limit?: number; remaining?: number; maxChars?: number }

const MAX_CHARS = 1000;
const HISTORY = 8;
// Подсказки: с местом для адреса вставляются в поле с выделенным местом, остальные отправляются сразу.
// Текст подсказки на языке интерфейса; место для адреса тоже переведено, поэтому ищем его по переводу.
const chips = (t: TFn) => {
  const paste = t("ask.paste");
  return [
    { label: t("ask.chip1", { paste }), text: t("ask.chip1", { paste }) },
    { label: t("ask.chip2label"), text: t("ask.chip2", { paste }) },
    { label: t("ask.chip3"), text: t("ask.chip3") },
    { label: t("ask.chip4"), text: t("ask.chip4") },
  ];
};

const TOOLS = ["scan_token", "wallet_profile", "dev_profile", "track_record", "narratives", "recent_launches", "paper_trading_summary"];

// Ссылки в ответе кликабельные; точку или скобку в конце предложения в ссылку не берём.
function Linked({ text, open }: { text: string; open?: (url: string) => void }) {
  const parts: ReactNode[] = [];
  const re = /https?:\/\/[^\s<>"')]+[^\s<>"').,;:!?]/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const url = m[0];
    parts.push(
      <a
        key={m.index}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={open ? (e) => (e.preventDefault(), open(url)) : undefined}
        className="break-all text-honey hover:underline"
      >
        {url.replace(/^https?:\/\/(www\.)?/, "")}
      </a>,
    );
    last = m.index + url.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

export function AskChat({ headers, openLink, compact = false, refreshKey, prefillFromUrl = false }: { headers?: () => Record<string, string>; openLink?: (url: string) => void; compact?: boolean; refreshKey?: unknown; prefillFromUrl?: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [tool, setTool] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const { t, lang } = useT();
  const PASTE = t("ask.paste");
  const hdrs = useCallback(() => ({ "Content-Type": "application/json", ...(headers ? headers() : sessionHeaders()) }), [headers]);

  // Остаток вопросов зависит от кошелька: перечитываем при входе и выходе.
  useEffect(() => {
    let off = false;
    fetch("/api/ask", { headers: hdrs(), cache: "no-store" })
      .then((r) => r.json())
      .then((d: Status) => !off && setStatus(d))
      .catch(() => !off && setStatus({ disabled: true }));
    return () => {
      off = true;
    };
  }, [hdrs, refreshKey]);

  // /ask?q=... (ссылка из расширения): вопрос только подставляем в поле, отправляет человек сам.
  useEffect(() => {
    if (!prefillFromUrl) return;
    const v = new URLSearchParams(window.location.search).get("q")?.trim();
    if (v) setQ(v.slice(0, MAX_CHARS));
  }, [prefillFromUrl]);

  // Фигурные скобки обязательны: в новом Chrome scrollIntoView возвращает Promise, а эффект не должен ничего возвращать.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns, tool]);

  const ask = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    if (question.includes(PASTE)) {
      setQ(question);
      pickPaste(question);
      return;
    }
    const history = turns.slice(-HISTORY);
    setTurns([...turns, { role: "user", text: question }, { role: "assistant", text: "" }]);
    setQ("");
    setErr(null);
    setBusy(true);
    const append = (t: string) =>
      setTurns((ts) => {
        const copy = ts.slice();
        copy[copy.length - 1] = { role: "assistant", text: copy[copy.length - 1].text + t };
        return copy;
      });
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: hdrs(), body: JSON.stringify({ question, history, lang }) });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        if (d.disabled) setStatus({ disabled: true });
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const line = buf.slice(0, i).replace(/^data: /, "");
          buf = buf.slice(i + 2);
          if (!line) continue;
          const e = JSON.parse(line);
          if (e.type === "text") {
            setTool(null);
            append(e.text);
          } else if (e.type === "tool") setTool(e.name);
          else if (e.type === "done") setStatus((s) => (s ? { ...s, remaining: e.remaining } : s));
          else if (e.type === "error") {
            setStatus((s) => (s ? { ...s, remaining: e.remaining } : s));
            throw new Error(e.message);
          }
        }
      }
    } catch (e) {
      setErr((e as Error).message);
      // Пустой ответ ассистента убираем, вопрос оставляем: его можно отправить снова.
      setTurns((ts) => (ts.at(-1)?.role === "assistant" && !ts.at(-1)!.text ? ts.slice(0, -1) : ts));
    } finally {
      setBusy(false);
      setTool(null);
    }
  };

  const pickPaste = (text: string) => {
    requestAnimationFrame(() => {
      const el = input.current;
      if (!el) return;
      el.focus();
      const at = text.indexOf(PASTE);
      if (at >= 0) el.setSelectionRange(at, at + PASTE.length);
    });
  };

  if (!status) return <Card className="h-64 animate-pulse" />;
  if (status.disabled || !status.enabled)
    return (
      <Card className="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <MessageSquare className="size-8 text-pink" />
        <div className="font-semibold">{t("ask.soon")}</div>
        <p className="max-w-md text-sm text-muted">{t("ask.soonDesc")}</p>
      </Card>
    );

  const out = status.remaining === 0;
  return (
    <Card className={cn("flex flex-col", compact ? "min-h-[60vh]" : "min-h-[520px]")}>
      <div className={cn("flex-1 space-y-4 overflow-y-auto", compact ? "p-3" : "p-4")}>
        {!turns.length && (
          <div className="py-6 text-center">
            <MessageSquare className="mx-auto size-7 text-pink" />
            <div className="mt-2 font-semibold">{t("ask.emptyTitle")}</div>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted">{t("ask.emptyDesc")}</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {chips(t).map((c) => (
                <button
                  key={c.label}
                  onClick={() => ask(c.text)}
                  disabled={busy || out}
                  className="rounded-full border border-line bg-panel-2 px-3 py-1.5 text-xs text-fg/90 transition-colors hover:border-pink/60 hover:text-pink disabled:opacity-40"
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-xl rounded-br-sm bg-honey/15 px-3 py-2 text-sm">{t.text}</div>
            </div>
          ) : (
            <div key={i} className="flex">
              <div className="max-w-[90%] whitespace-pre-wrap break-words rounded-xl rounded-bl-sm border border-line bg-panel-2 px-3 py-2 text-sm leading-relaxed">
                {t.text ? <Linked text={t.text} open={openLink} /> : <span className="text-muted">...</span>}
              </div>
            </div>
          ),
        )}
        {busy && (
          <div className="flex items-center gap-2 text-xs text-muted">
            <Loader2 className="size-3.5 animate-spin text-pink" />
            {tool ? `${TOOLS.includes(tool) ? t(`ask.tool.${tool}` as DictKey) : t("ask.working")}...` : t("ask.thinking")}
          </div>
        )}
        {err && <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</div>}
        <div ref={end} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
        className="border-t border-line p-3"
      >
        <div className="flex items-end gap-2">
          <textarea
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value.slice(0, status.maxChars ?? MAX_CHARS))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask(q);
              }
            }}
            rows={compact ? 1 : 2}
            placeholder={out ? t("ask.noLeft") : t("ask.placeholder")}
            disabled={out}
            className="min-h-10 flex-1 resize-none rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-pink/60"
          />
          <Button type="submit" disabled={busy || out || !q.trim()} className="h-10" aria-label={t("ask.send")}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
          <span>{t("ask.footer")}</span>
          <span className="num">
            {t("ask.left", { n: status.remaining ?? 0, limit: status.limit ?? 0 })}
            {status.tier ? ` · ${status.tier}` : ""}
          </span>
        </div>
      </form>
    </Card>
  );
}

export function AskView() {
  const { address, signedIn } = useWallet();
  const { t } = useT();
  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            Ask <span className="text-pink">CrawlHive</span>
            <span className="rounded bg-pink/15 px-1.5 py-0.5 text-[11px] font-bold text-pink">AI</span>
          </span>
        }
        sub={t("ask.sub")}
      />
      <AskChat refreshKey={`${address}:${signedIn}`} prefillFromUrl />
    </>
  );
}
