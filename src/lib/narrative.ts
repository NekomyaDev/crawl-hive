// «Launch this narrative»: из сигнала Narrative Hunter собираем ссылку на Clean Launch с готовыми полями.
// Текст сигнала имеет вид «Title (heat): why. N coins with this ticker…» — разбираем его обратно.
import type { Signal } from "@/lib/types";

const NARR_RE = /^(.+?) \((early|rising|hot)\): ([\s\S]*)$/;

export function narrativeOf(s: Pick<Signal, "kind" | "text" | "ticker" | "urls">) {
  if (s.kind !== "narrative" || !s.ticker) return null;
  const m = NARR_RE.exec(s.text ?? "");
  if (!m) return null;
  const why = m[3]
    .replace(/\s*(No coin|\d+ coins?) with this ticker launched in the last 24h\.\s*$/, "")
    .trim();
  return { title: m[1].trim(), heat: m[2], why, ticker: s.ticker, post: s.urls?.[0] };
}

// Имя монеты на pump.fun — до 32 символов, режем по слову.
function fitName(t: string) {
  if (t.length <= 32) return t;
  const cut = t.slice(0, 32);
  return (cut.lastIndexOf(" ") > 10 ? cut.slice(0, cut.lastIndexOf(" ")) : cut).trim();
}

export function launchHref(s: Pick<Signal, "kind" | "text" | "ticker" | "urls">, base = "") {
  const n = narrativeOf(s);
  return n ? launchHrefFor(n, base) : null;
}

// Тот же адрес из готовых полей нарратива (Narrative Radar хранит их по отдельности).
export function launchHrefFor(n: { title: string; ticker: string; why: string; post?: string }, base = "") {
  const q = new URLSearchParams({ name: fitName(n.title), symbol: n.ticker.slice(0, 10), description: n.why.slice(0, 500) });
  if (n.post) q.set("from", n.post);
  return `${base}/launch?${q}`;
}
