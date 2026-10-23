// Общий вердикт «CrawlHive x Larpcheck»: Larpcheck отсеивает ларпы (фейковый проект, фейковая команда,
// чужой брендинг), CrawlHive отвечает за всё ончейн (снайперы, бандлы, история дева, LP, probable dump, балл v2).
// Правила нарочно простые и объяснимые, без ML:
// - старт: публичный балл CrawlHive (v2 с жёсткими потолками v1);
// - Larpcheck видит ларп или скам (LARP, LIKELY LARP, SCAM или их балл ниже LARP_LOW): не выше LARP_CAP (DANGER);
// - их штамп монеты плохой (RIG, SCAM, BAD, UNFAIR, SKETCH): COIN_BAD очков;
// - Larpcheck уверенно видит настоящий проект (REAL / LIKELY REAL от REAL_MIN и честная монета): REAL_BONUS очков,
//   но только когда у CrawlHive нет жёстких флагов, вердикт не DANGER и не «слишком рано»: настоящая команда
//   не делает безопасным подстроенный запуск;
// - нет данных Larpcheck: общий балл = балл CrawlHive, coverage «crawlhive only».
// Новых запросов к Larpcheck модуль не делает: берёт вердикт, который скан уже получил.
// Отдельно от trust.ts (60/40, флаг TRUST_SCORE): там среднее двух баллов, здесь ончейн-балл с поправкой на ларп.
import "server-only";
import type { ScanResult } from "./scan";
import type { LarpVerdict } from "./larpcheck";
import { verdictOf, type VerdictV2 } from "./score-v2";

// Веса общего вердикта. Поменяли заметно - старые записи Track Record (sc/vc) считались по этим числам.
export const COMBINED = {
  larpCap: 30, // потолок при ларпе или скаме по Larpcheck: это DANGER (ниже 40)
  larpLow: 25, // их балл ниже этого считаем высоким риском даже без слова LARP
  coinBad: -10, // их штамп монеты нечестный
  realBonus: 5, // уверенно настоящий проект
  realMin: 70, // «уверенно»: их балл от 70
  earlyCap: 54, // моложе 30 минут: общий вердикт не лучше RISKY
} as const;

// Жёсткие флаги CrawlHive: при них бонус Larpcheck не применяется (те же, что держат публичный вердикт в scan.ts).
const HARD = ["LP can be pulled", "Young and linked", "Honeypot", "Mint open", "Freeze on"];
const COIN_BAD = /RIG|SKETCH|SCAM|BAD|UNFAIR/;

export interface CombinedScore {
  score: number; // 0-100, выше - безопаснее
  verdict: VerdictV2;
  parts: {
    crawlhive: { score: number; verdict: ScanResult["verdict"] };
    larpcheck: { verdict: string; score: number | null; coin?: string; url: string } | null;
  };
  reasons: string[]; // сначала то, что изменило балл, потом ончейн-причина
  coverage: "crawlhive + larpcheck" | "crawlhive only";
}

type ScanSide = Pick<ScanResult, "score" | "verdict" | "reason" | "factors" | "xray" | "core">;

// Хуже из двух вердиктов: поправка Larpcheck вниз не может сделать вердикт мягче ончейн-вердикта.
const RANK: Record<VerdictV2, number> = { CLEAN: 0, OK: 1, RISKY: 2, DANGER: 3 };
const worse = (a: VerdictV2, b: VerdictV2) => (RANK[a] >= RANK[b] ? a : b);

// Выключено, пока Larpcheck (Galt) не согласится на публичный показ и выдачу в платном API: COMBINED_SCORE=1 включает.
export const combinedEnabled = () => process.env.COMBINED_SCORE === "1";

export function combinedScore(scan: ScanSide, larp?: LarpVerdict | null): CombinedScore | null {
  if (!combinedEnabled()) return null;
  // Базовые активы и сканы без балла не судим.
  if (scan.core || scan.score == null) return null;
  const base = scan.score;
  const early = scan.verdict === "TOO_EARLY";
  const hard = scan.factors.find((f) => HARD.includes(f.label))?.label ?? (scan.xray?.findings.some((f) => f.severity === "high") ? "High risk contract power" : undefined);
  const reasons: string[] = [];
  let score = base;
  // Ончейн-вердикт в полосах v2; «слишком рано» не лучше RISKY.
  let verdict: VerdictV2 = early ? worse(verdictOf(Math.min(base, COMBINED.earlyCap)), "RISKY") : (scan.verdict as VerdictV2);
  if (early) {
    score = Math.min(score, COMBINED.earlyCap);
    reasons.push("Under 30 minutes old: early read only");
  }

  if (larp) {
    const larpFlag = /SCAM|LARP/.test(larp.verdict);
    const lowScore = larp.score != null && larp.score < COMBINED.larpLow;
    const coinBad = !!larp.coin && COIN_BAD.test(larp.coin.word);
    const real = /^(REAL|LIKELY REAL)$/.test(larp.verdict) && (larp.score ?? 0) >= COMBINED.realMin && !coinBad;
    if (larpFlag || lowScore) {
      if (score > COMBINED.larpCap) score = COMBINED.larpCap;
      const tag = `${larp.verdict}${larp.score != null ? ` ${larp.score}` : ""}`;
      reasons.push(/SCAM/.test(larp.verdict) ? `Larpcheck flags it as a scam (${tag})` : larpFlag ? `Larpcheck flags it as a larp (${tag})` : `Larpcheck rates the project high risk (${tag})`);
    } else if (coinBad) {
      score = Math.max(0, score + COMBINED.coinBad);
      reasons.push(`${COMBINED.coinBad} Larpcheck rates the coin itself ${larp.coin!.word}`);
    } else if (real) {
      if (hard) reasons.push(`Larpcheck says ${larp.verdict}, but no bonus: ${hard} on-chain`);
      else if (early) reasons.push(`Larpcheck says ${larp.verdict}, no bonus while it is this young`);
      else if (scan.verdict === "DANGER") reasons.push(`Larpcheck says ${larp.verdict}, no bonus: a real team can still run a rigged launch`);
      else {
        score = Math.min(100, score + COMBINED.realBonus);
        reasons.push(`+${COMBINED.realBonus} Larpcheck says ${larp.verdict} (${larp.score})`);
      }
    } else reasons.push(`Larpcheck says ${larp.verdict}${larp.score != null ? ` ${larp.score}` : ""}: no change`);
    // Балл пошёл вниз - вердикт по полосам v2, но не мягче ончейн; вверх - по полосам v2.
    if (score < base) verdict = worse(verdictOf(score), verdict);
    else if (score > base) verdict = verdictOf(score);
  }
  reasons.push(`CrawlHive on-chain: ${scan.reason}`);
  return {
    score,
    verdict,
    parts: {
      crawlhive: { score: base, verdict: scan.verdict },
      larpcheck: larp ? { verdict: larp.verdict, score: larp.score, ...(larp.coin ? { coin: larp.coin.word } : {}), url: larp.url } : null,
    },
    reasons,
    coverage: larp ? "crawlhive + larpcheck" : "crawlhive only",
  };
}

// Не роняем скан из-за общего вердикта: ошибка тут - просто нет блока.
export function safeCombinedScore(scan: ScanSide, larp?: LarpVerdict | null): CombinedScore | null {
  try {
    return combinedScore(scan, larp);
  } catch (e) {
    console.warn("[combined-score]", (e as Error).message);
    return null;
  }
}
