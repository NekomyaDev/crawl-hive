// Клиент xAI (Grok) через Responses API. Используется для поиска по X (инструмент x_search)
// и для разбора текстов по индивидуальным инструкциям краулера.
// Документация: https://docs.x.ai/developers/tools/x-search
import "server-only";

const ENDPOINT = "https://api.x.ai/v1/responses";

export function grokEnabled() {
  return !!process.env.XAI_API_KEY?.trim();
}

const model = () => process.env.XAI_MODEL?.trim() || "grok-4.7";

// Дневной бюджет вызовов: защита от счёта на сотни долларов, если краулеров станет много.
const g = globalThis as unknown as { __crawlhiveGrok?: { day: string; calls: number } };
function takeBudget() {
  const day = new Date().toISOString().slice(0, 10);
  const limit = Number(process.env.XAI_DAILY_CALLS ?? 300);
  const b = (g.__crawlhiveGrok ??= { day, calls: 0 });
  if (b.day !== day) Object.assign(b, { day, calls: 0 });
  if (b.calls >= limit) throw new Error(`Daily Grok budget reached (${limit} calls), crawler will retry tomorrow`);
  b.calls++;
}

export function grokUsage() {
  return { ...(g.__crawlhiveGrok ?? { day: "", calls: 0 }), limit: Number(process.env.XAI_DAILY_CALLS ?? 300) };
}

export interface XSearchOptions {
  allowedHandles?: string[]; // без @, до 20
  fromDate?: string; // YYYY-MM-DD
  imageUnderstanding?: boolean;
}

interface GrokResult {
  text: string;
  citations: string[];
}

// Достаём итоговый текст и ссылки из ответа: формат совместим с OpenAI Responses API,
// но разбираем осторожно, чтобы пережить мелкие расхождения.
function parse(json: Record<string, unknown>): GrokResult {
  const citations = new Set<string>();
  let text = typeof json.output_text === "string" ? json.output_text : "";
  const output = Array.isArray(json.output) ? (json.output as Record<string, unknown>[]) : [];
  for (const item of output) {
    if (item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const part of item.content as Record<string, unknown>[]) {
      if (typeof part.text === "string" && !json.output_text) text += part.text;
      for (const a of (part.annotations as Record<string, unknown>[] | undefined) ?? [])
        if (typeof a.url === "string") citations.add(a.url);
    }
  }
  for (const c of (json.citations as unknown[] | undefined) ?? []) {
    if (typeof c === "string") citations.add(c);
    else if (c && typeof (c as { url?: unknown }).url === "string") citations.add((c as { url: string }).url);
  }
  return { text, citations: [...citations] };
}

export async function grok(opts: { system: string; user: string; xSearch?: XSearchOptions; timeoutMs?: number }): Promise<GrokResult> {
  const key = process.env.XAI_API_KEY?.trim();
  if (!key) throw new Error("XAI_API_KEY is not set");
  takeBudget();
  const tools = opts.xSearch
    ? [
        {
          type: "x_search",
          ...(opts.xSearch.allowedHandles?.length ? { allowed_x_handles: opts.xSearch.allowedHandles.slice(0, 20) } : {}),
          ...(opts.xSearch.fromDate ? { from_date: opts.xSearch.fromDate } : {}),
          ...(opts.xSearch.imageUnderstanding ? { enable_image_understanding: true } : {}),
        },
      ]
    : undefined;
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: model(),
      input: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      ...(tools ? { tools, max_turns: 3 } : {}),
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Grok API ${res.status}: ${body.slice(0, 200)}`);
  }
  return parse((await res.json()) as Record<string, unknown>);
}

// Модель просят ответить JSON-ом, но иногда она оборачивает его в текст или ```json.
export function extractJson<T>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.search(/[{[]/);
  if (start < 0) return null;
  for (let end = raw.length; end > start; end--) {
    const ch = raw[end - 1];
    if (ch !== "}" && ch !== "]") continue;
    try {
      return JSON.parse(raw.slice(start, end)) as T;
    } catch {}
  }
  return null;
}
