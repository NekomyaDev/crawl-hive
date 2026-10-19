// Второе мнение от Larpcheck (larpcheck.app): их вердикт по проекту за токеном рядом с нашим ончейн-сканом.
// Только чтение (бесплатно по ключу аккаунта, LARPCHECK_KEY), только готовые проверки: новых не запускаем.
// По их условиям вердикт показываем только со ссылкой на их проверку (url). Без ключа модуль молчит.
import "server-only";

export interface LarpVerdict {
  verdict: string; // REAL, LIKELY REAL, PARTLY REAL, UNCLEAR, LIKELY LARP, LARP, SCAM
  score: number | null; // 0-100, 100 = real
  headline: string | null;
  coin?: { word: string; score: number | null; line?: string }; // их штамп «насколько честна монета для покупателя»
  story?: { word: string; score: number | null; line?: string }; // штамп «тот ли проект, за кого себя выдаёт»
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
      latest?: { id?: string; verdict?: string | null; score?: number | null; headline?: string | null; url?: string; created?: string; status?: string; stamps?: { id: string; word: string; score?: number }[] } | null;
    } | null;
    const l = j?.latest;
    if (l?.verdict && l.url && l.status === "done") {
      // Строки фактов за штампами есть только в самой проверке (бесплатное чтение): из них объясняем расхождение вердиктов.
      const full = l.id
        ? ((await (await fetch(`${API}/checks/${l.id}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000) }).catch(() => null))?.json().catch(() => null)) as {
            verdict?: { stamps?: { id: string; word: string; score?: number; line?: string }[] } | null;
          } | null)
        : null;
      const stamps = full?.verdict?.stamps?.length ? full.verdict.stamps : (l.stamps ?? []);
      const st = (id: string) => {
        const x = stamps.find((s) => s.id === id) as { word: string; score?: number; line?: string } | undefined;
        return x ? { word: x.word, score: x.score ?? null, ...(x.line ? { line: x.line } : {}) } : undefined;
      };
      const coin = st("coin");
      const story = st("story");
      v = { verdict: l.verdict, score: l.score ?? null, headline: l.headline ?? null, ...(coin ? { coin } : {}), ...(story ? { story } : {}), url: l.url, at: l.created ? Date.parse(l.created) : Date.now() };
    }
  } else if (res && res.status !== 404) console.warn("[larpcheck]", res.status);
  if (cache().size > 5000) cache().clear();
  cache().set(id, { at: Date.now(), v });
  return v;
}
