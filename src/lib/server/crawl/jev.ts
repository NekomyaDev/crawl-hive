// Jev (TypeSafe) через OpenRouter: модель, которая не пишет текст, а выбирает ответ из заданных вариантов
// и возвращает вероятность. 70–500 мс, платится только вход. Нужен там, где решение маленькое и типовое:
// стоит ли находка краулера внимания, смотреть / следить / обходить. Дорогой Grok остаётся для неуверенных случаев.
// Документация: https://openrouter.ai/docs/guides/community/jev-tutorial
// Без ключа OPENROUTER_API_KEY слой выключен, краулеры работают как раньше.
import "server-only";

const ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
const model = () => process.env.JEV_MODEL?.trim() || "typesafe/jev-1.13";

export function jevEnabled() {
  return !!process.env.OPENROUTER_API_KEY?.trim() && process.env.JEV_OFF !== "1";
}

export type JevQuestion =
  | { type: "noul"; instructions: string; criteria?: { true: string; false: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

export type JevAnswer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; confidence?: number; probabilities?: Record<string, number> }
  | { type: "score"; score: number; confidence?: number; probabilities?: Record<string, number> };

export interface JevResult {
  answers: Record<string, JevAnswer>;
  ms: number;
  cost: number;
}

// Дневной бюджет: решения стоят сотые доли цента, но защита от петли не помешает.
const g = globalThis as unknown as { __crawlhiveJev?: { day: string; calls: number; cost: number } };
function takeBudget() {
  const day = new Date().toISOString().slice(0, 10);
  const limit = Number(process.env.JEV_DAILY_CALLS ?? 3000);
  const b = (g.__crawlhiveJev ??= { day, calls: 0, cost: 0 });
  if (b.day !== day) Object.assign(b, { day, calls: 0, cost: 0 });
  if (b.calls >= limit) throw new Error(`Daily Jev budget reached (${limit} calls)`);
  b.calls++;
  return b;
}

export function jevUsage() {
  return { ...(g.__crawlhiveJev ?? { day: "", calls: 0, cost: 0 }), limit: Number(process.env.JEV_DAILY_CALLS ?? 3000) };
}

export async function jev(state: Record<string, unknown>, questions: Record<string, JevQuestion>, timeoutMs = 8_000): Promise<JevResult> {
  const b = takeBudget();
  const t0 = Date.now();
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: model(), state, questions }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Jev ${res.status}: ${body.slice(0, 200)}`);
  const json = JSON.parse(body) as { answers?: Record<string, JevAnswer>; usage?: { input_tokens?: number; cost?: number } };
  if (!json.answers) throw new Error("Jev returned no answers");
  const ms = Date.now() - t0;
  const cost = Number(json.usage?.cost) || 0;
  b.cost += cost;
  console.log(`[jev] in=${json.usage?.input_tokens ?? "?"} ms=${ms} cost=$${cost.toFixed(6)} day=$${b.cost.toFixed(4)}`);
  return { answers: json.answers, ms, cost };
}

// Сразу несколько решений, не больше `limit` одновременно. Упавшее решение — undefined, остальные не страдают.
export async function jevMany<T>(items: T[], fn: (x: T) => Promise<JevResult>, limit = 4): Promise<(JevResult | undefined)[]> {
  const out: (JevResult | undefined)[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        try {
          out[i] = await fn(items[i]);
        } catch (e) {
          console.warn("[jev] decision failed:", (e as Error).message);
        }
      }
    }),
  );
  return out;
}

export const noulOf = (a: JevAnswer | undefined) => (a?.type === "noul" ? a.noul : undefined);
