// Второе мнение от Larpcheck (larpcheck.app): их вердикт по проекту за токеном рядом с нашим ончейн-сканом.
// Только чтение (бесплатно по ключу аккаунта, LARPCHECK_KEY), только готовые проверки: новых не запускаем.
// По их условиям вердикт показываем только со ссылкой на их проверку (url). Без ключа модуль молчит.
import "server-only";

export interface LarpVerdict {
  verdict: string; // REAL, LIKELY REAL, PARTLY REAL, UNCLEAR, LIKELY LARP, LARP, SCAM
  score: number | null; // 0-100, 100 = real
  headline: string | null;
  coin?: { word: string; score: number | null }; // их штамп «насколько честна монета для покупателя»
  url: string; // их проверка: ссылка обязательна
  at: number;
}

const API = "https://larpcheck.app/api/v1";
const CACHE_MS = 10 * 60_000;
const g = globalThis as unknown as { __crawlhiveLarp?: Map<string, { at: number; v: LarpVerdict | null }> };
const cache = () => (g.__crawlhiveLarp ??= new Map());

export const larpEnabled = () => !!process.env.LARPCHECK_KEY?.trim();

export async function larpVerdict(address: string): Promise<LarpVerdict | null> {
  const key = process.env.LARPCHECK_KEY?.trim();
  if (!key) return null;
  const id = address.startsWith("0x") ? address.toLowerCase() : address;
  const hit = cache().get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.v;
  const res = await fetch(`${API}/coins/${id}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000) }).catch(() => null);
  let v: LarpVerdict | null = null;
  if (res?.ok) {
    const j = (await res.json().catch(() => null)) as {
      latest?: { verdict?: string | null; score?: number | null; headline?: string | null; url?: string; created?: string; status?: string; stamps?: { id: string; word: string; score?: number }[] } | null;
    } | null;
    const l = j?.latest;
    if (l?.verdict && l.url && l.status === "done") {
      const coin = l.stamps?.find((s) => s.id === "coin");
      v = { verdict: l.verdict, score: l.score ?? null, headline: l.headline ?? null, ...(coin ? { coin: { word: coin.word, score: coin.score ?? null } } : {}), url: l.url, at: l.created ? Date.parse(l.created) : Date.now() };
    }
  } else if (res && res.status !== 404) console.warn("[larpcheck]", res.status);
  if (cache().size > 5000) cache().clear();
  cache().set(id, { at: Date.now(), v });
  return v;
}
