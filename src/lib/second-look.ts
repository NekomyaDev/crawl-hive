// «Второй взгляд»: как показать теневую оценку рядом с публичным вердиктом (сайт и Telegram-бот).
// С 22.10 публичный вердикт считается по v2, а «второй взгляд» показывает теневую v3 (score-v3.ts).
// Без server-only: нужно и серверу, и клиентскому компоненту скана.
export interface SecondLookData {
  score: number;
  verdict: "CLEAN" | "OK" | "RISKY" | "DANGER";
  reasons: string[];
}

// v3 из скана в общий вид «второго взгляда».
export const lookV3 = (v?: { scoreV3: number; verdictV3: SecondLookData["verdict"]; reasonsV3: string[] }): SecondLookData | undefined =>
  v && { score: v.scoreV3, verdict: v.verdictV3, reasons: v.reasonsV3 };

// Главная причина из списка «+N текст»: потолок по жёсткому флагу, иначе самый большой минус. Очки срезаем.
export function topReason(reasons: string[]): string | null {
  const cap = reasons.find((x) => x.startsWith("capped"));
  if (cap) return cap.replace(/^capped at \d+: /, "");
  const neg = reasons
    .map((x) => ({ pts: parseInt(x, 10), text: x.replace(/^[+-]?\d+ /, "") }))
    .filter((x) => x.pts < 0)
    .sort((a, b) => a.pts - b.pts)[0];
  return neg ? neg.text.replace(/^v1 score (\d+)$/, "crawler score $1") : null;
}
export const secondLookWhy = (v: SecondLookData) => topReason(v.reasons);

// TOO_EARLY считаем как OK: публичный вердикт тогда «рано судить», а не «опасно».
const RANK: Record<string, number> = { CLEAN: 0, OK: 1, TOO_EARLY: 1, RISKY: 2, DANGER: 3 };
export const verdictWorse = (a: string, b: string) => (RANK[a] ?? 0) > (RANK[b] ?? 0);
export const secondLookWorse = (pub: string, v: SecondLookData) => verdictWorse(v.verdict, pub);
