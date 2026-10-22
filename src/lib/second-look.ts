// «Второй взгляд»: как показать теневую оценку v2 рядом с публичным вердиктом (сайт и Telegram-бот).
// Без server-only: нужно и серверу, и клиентскому компоненту скана.
export interface SecondLookData {
  scoreV2: number;
  verdictV2: "CLEAN" | "OK" | "RISKY" | "DANGER";
  reasonsV2: string[];
}

// Главная причина: потолок по жёсткому флагу, иначе самый большой минус. Очки в начале строки срезаем.
export function secondLookWhy(v: SecondLookData): string | null {
  const cap = v.reasonsV2.find((x) => x.startsWith("capped"));
  if (cap) return cap.replace(/^capped at \d+: /, "");
  const neg = v.reasonsV2
    .map((x) => ({ pts: parseInt(x, 10), text: x.replace(/^[+-]?\d+ /, "") }))
    .filter((x) => x.pts < 0)
    .sort((a, b) => a.pts - b.pts)[0];
  return neg ? neg.text.replace(/^v1 score (\d+)$/, "crawler score $1") : null;
}

// TOO_EARLY считаем как OK: публичный вердикт тогда «рано судить», а не «опасно».
const RANK: Record<string, number> = { CLEAN: 0, OK: 1, TOO_EARLY: 1, RISKY: 2, DANGER: 3 };
export const secondLookWorse = (pub: string, v: SecondLookData) => (RANK[v.verdictV2] ?? 0) > (RANK[pub] ?? 0);
