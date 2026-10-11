// Общее для страницы скана, картинки для X и кнопки «поделиться»: подписи вердиктов, цвета и текст поста.
export type Verdict = "CLEAN" | "OK" | "RISKY" | "DANGER" | "TOO_EARLY";

export const VERDICT_LABEL: Record<Verdict, string> = { CLEAN: "CLEAN", OK: "OK", RISKY: "RISKY", DANGER: "DANGER", TOO_EARLY: "TOO EARLY" };
export const VERDICT_COLOR: Record<Verdict, string> = { CLEAN: "#b6f23a", OK: "#5eead4", RISKY: "#ffb020", DANGER: "#f87171", TOO_EARLY: "#8a9099" };

export const scanPath = (id: string) => `/scan/${id}`;

// Текст поста в X: тикер, оценка, вердикт и главная причина. Ссылку X добавит сам из параметра url.
export function shareText(r: { symbol: string; score: number | null; verdict: Verdict; reason: string }) {
  const head = r.score === null ? `$${r.symbol}: too early to judge` : `$${r.symbol} scored ${r.score}/100 (${VERDICT_LABEL[r.verdict]})`;
  return `${head} on CrawlHive Instant Crawl\n\n${r.reason}`;
}

export const xIntent = (text: string, url: string) =>
  `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
