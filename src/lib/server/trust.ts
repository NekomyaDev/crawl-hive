// Общий trust score — третий вердикт рядом с нашим ончейн-сканом и Larpcheck: 60% наш балл, 40% их балл о проекте.
// Жёсткие потолки: если хоть одна сторона видит скам (наш DANGER, их SCAM или LARP), общий балл не выше 25;
// наш RISKY или их LIKELY LARP — не выше 49. Включается флагом TRUST_SCORE=1 (ждёт согласия Larpcheck).
import "server-only";

export interface TrustScore {
  score: number;
  verdict: "TRUSTED" | "MIXED" | "CAUTION" | "AVOID";
  why: string;
}

export const trustEnabled = () => process.env.TRUST_SCORE === "1";

export function trustScore(ours: { score: number | null; verdict: string }, larp?: { verdict: string; score: number | null } | null): TrustScore | null {
  if (!larp || ours.score == null || larp.score == null || ours.verdict === "TOO_EARLY") return null;
  let score = Math.round(ours.score * 0.6 + larp.score * 0.4);
  const scam = ours.verdict === "DANGER" || /^(SCAM|LARP)$/.test(larp.verdict);
  const risky = ours.verdict === "RISKY" || larp.verdict === "LIKELY LARP";
  if (scam) score = Math.min(score, 25);
  else if (risky) score = Math.min(score, 49);
  const verdict = score >= 75 ? "TRUSTED" : score >= 50 ? "MIXED" : score >= 26 ? "CAUTION" : "AVOID";
  // Кто потянул балл вниз: сторона с более слабой оценкой или та, что сработала потолком.
  const oursLow = ours.verdict === "DANGER" || ours.verdict === "RISKY";
  const larpLow = /SCAM|LARP/.test(larp.verdict);
  const why =
    oursLow && larpLow
      ? "Both checks flag risk: on-chain and the project behind it."
      : oursLow
        ? `On-chain risk pulls it down (CrawlHive ${ours.verdict.replace("_", " ")}).`
        : larpLow
          ? `The project check pulls it down (Larpcheck ${larp.verdict}).`
          : score >= 75
            ? "Both checks agree: clean on-chain and a real project."
            : ours.score < larp.score
              ? "On-chain is the weaker side of this one."
              : "The project check is the weaker side of this one.";
  return { score, verdict, why };
}
