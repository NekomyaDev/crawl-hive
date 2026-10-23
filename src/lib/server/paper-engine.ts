// Paper Engine: настоящая бумажная торговля вперёд по сигналам Launch Radar. В отличие от paper.ts (задним числом
// из Track Record, выход ровно через сутки) здесь каждая стратегия открывает виртуальную позицию в момент вердикта,
// раз в минуту (быстрые стратегии раз в 10 с) получает цену и закрывается по своим правилам: стоп, тейк, трейлинг, лимит времени, руг.
// Комиссии и проскальзывание учитываются. Стратегии — просто данные в STRATEGIES: новый вариант = новая строка.
// Хранение в SQLite (brain.db из memory-db.ts): после рестарта открытые позиции продолжают вестись.
// PAPER_ENGINE=0 выключает и вход, и замеры.
import "server-only";
import { bestPairs, type PairInfo } from "./crawl/dexscreener";
import { kvGet, kvSet, memDb } from "./memory-db";
import type { ScanResult, Verdict } from "./scan";
import type { VerdictV2 } from "./score-v2";

// ---------- стратегии ----------

export interface EntryRule {
  verdicts?: Verdict[]; // пусто — любой вердикт (кроме TOO_EARLY, если его не указать явно)
  chains?: string[];
  noPumpFun?: boolean; // не брать монеты pump.fun (адрес на «pump»): по истории там 43% ругов
  minScore?: number;
  maxScore?: number;
  verdictsV2?: VerdictV2[]; // теневой вердикт v2 (score-v2.ts); без v2 у скана фильтр не проходит
  minScoreV2?: number;
  verdictsV3?: VerdictV2[]; // теневой вердикт v3 (score-v3.ts); без v3 у скана фильтр не проходит
  minScoreV3?: number;
  minAgeMin?: number;
  maxAgeMin?: number;
  minLiqUsd?: number;
  maxLiqUsd?: number;
  minFdv?: number;
  maxFdv?: number;
  maxTop1Pct?: number;
  maxTop10Pct?: number;
  maxSnipersPct?: number; // сколько держат покупатели первых блоков сейчас
  noBundles?: boolean; // нет кластеров кошельков с общим спонсором (кластер от BUNDLE_PCT% эмиссии)
  maxFreshPct?: number; // доля кошельков моложе 3 дней
  maxDevHoldsPct?: number;
  lpSafe?: boolean; // LP сожжена, залочена или токен ещё на кривой pump.fun
  noMintFreeze?: boolean;
  minBuySellRatio?: number; // покупки/продажи за час
  minVolume1h?: number;
  minSocials?: number;
  excludeFlags?: string[]; // метки факторов скана, при которых не входим ("Bundled", "Snipers hold a lot"...)
  // Подтверждённый вход: не покупаем на скане, а ждём delayMin минут и входим по цене того момента,
  // если пул не вытащили и цена не ушла слишком далеко. Без delayMin вход мгновенный, как раньше.
  delayMin?: number;
  confirm?: EntryConfirm;
}

export interface EntryConfirm {
  minLiqKeepPct?: number; // ликвидность сейчас не ниже этой доли (%) от ликвидности на скане
  maxDropPct?: number; // цена не ниже цены скана больше чем на столько %
  maxRisePct?: number; // не догоняем: выросла больше чем на столько %, пропуск
}

export interface ExitRule {
  tpPct?: number; // тейк: цена выросла на столько % от входа
  slPct?: number; // стоп: упала на столько % (положительное число)
  trailPct?: number; // трейлинг: откат на столько % от пика
  trailArmPct?: number; // трейлинг включается, когда пик выше входа на столько % (по умолчанию 0: сразу)
  // Частичная фиксация: на +atPct продаём sellPct% позиции (на x2 половина возвращает вложенное), остаток едет дальше
  // по трейлингу. breakeven: после фиксации стоп переезжает на цену входа, чтобы остаток не ушёл в минус.
  partial?: { atPct: number; sellPct: number; breakeven?: boolean };
  maxHoldMin: number;
}

export interface StrategyConfig {
  id: string; // стабильный: сделки привязаны к нему. Поменяли правила заметно — заведите новый id
  label: string;
  note: string;
  entry: EntryRule;
  exits: ExitRule;
  sizeUsd: number;
  enabled: boolean;
  // Быстрое исполнение, как в живой торговле с высоким допуском проскальзывания и приоритетной комиссией:
  // позиции замеряются каждые FAST_MS вместо минуты (стоп срабатывает ближе к уровню), но каждая сторона
  // сделки дороже на extraSlipPct процентов.
  fast?: { extraSlipPct: number };
}

const H = 60;
const CONFIRM: EntryConfirm = { minLiqKeepPct: 80, maxDropPct: 15, maxRisePct: 60 };
export const STRATEGIES: StrategyConfig[] = [
  { id: "s1", label: "CLEAN hold 24h", note: "Baseline like the old page: CLEAN, no stops, sold after 24h", entry: { verdicts: ["CLEAN"] }, exits: { maxHoldMin: 24 * H }, sizeUsd: 100, enabled: false },
  { id: "s2", label: "CLEAN TP50 SL30", note: "CLEAN, take +50%, stop -30%, max 6h", entry: { verdicts: ["CLEAN"] }, exits: { tpPct: 50, slPct: 30, maxHoldMin: 6 * H }, sizeUsd: 100, enabled: true },
  { id: "s3", label: "CLEAN runner", note: "CLEAN, take +100%, stop -40%, 30% trail once up 30%, max 12h", entry: { verdicts: ["CLEAN"] }, exits: { tpPct: 100, slPct: 40, trailPct: 30, trailArmPct: 30, maxHoldMin: 12 * H }, sizeUsd: 100, enabled: false },
  { id: "s4", label: "CLEAN+OK scalp", note: "CLEAN or OK, take +30%, stop -20%, max 2h", entry: { verdicts: ["CLEAN", "OK"] }, exits: { tpPct: 30, slPct: 20, maxHoldMin: 2 * H }, sizeUsd: 100, enabled: false },
  { id: "s5", label: "CLEAN low snipers", note: "CLEAN, snipers hold under 5%, no bundles, top 10 under 40%, TP50 SL30 6h", entry: { verdicts: ["CLEAN"], maxSnipersPct: 5, noBundles: true, maxTop10Pct: 40 }, exits: { tpPct: 50, slPct: 30, maxHoldMin: 6 * H }, sizeUsd: 100, enabled: true },
  { id: "s6", label: "Every coin TP50 SL30", note: "Control: every radar coin with a verdict, same exits as S2", entry: { verdicts: ["CLEAN", "OK", "RISKY", "DANGER"] }, exits: { tpPct: 50, slPct: 30, maxHoldMin: 6 * H }, sizeUsd: 100, enabled: true },
  { id: "s7", label: "DANGER only", note: "Inverse control: only DANGER calls, same exits as S2. Should lose the most", entry: { verdicts: ["DANGER"] }, exits: { tpPct: 50, slPct: 30, maxHoldMin: 6 * H }, sizeUsd: 100, enabled: true },
  { id: "s8", label: "CLEAN 80+ trail", note: "CLEAN with score 80+, 25% trail from the peak, stop -35%, max 12h", entry: { verdicts: ["CLEAN"], minScore: 80 }, exits: { slPct: 35, trailPct: 25, maxHoldMin: 12 * H }, sizeUsd: 100, enabled: false },
  { id: "s9", label: "Fresh momentum", note: "CLEAN or OK under 3h old, more buys than sells, TP40 SL25 3h", entry: { verdicts: ["CLEAN", "OK"], maxAgeMin: 3 * H, minBuySellRatio: 1.2 }, exits: { tpPct: 40, slPct: 25, maxHoldMin: 3 * H }, sizeUsd: 100, enabled: false },
  // Из бэктеста 22.10 (3723 записи, проверка на свежих 30%): широкий тейк и короткий стоп стабильно лучше TP30/50.
  { id: "s10", label: "Clean mid-liq", note: "Backtest #1: CLEAN 90+, not pump.fun, liquidity $20k-50k, TP100 SL30, 24h", entry: { verdicts: ["CLEAN"], minScore: 90, noPumpFun: true, minLiqUsd: 20_000, maxLiqUsd: 50_000 }, exits: { tpPct: 100, slPct: 30, maxHoldMin: 24 * H }, sizeUsd: 100, enabled: true },
  { id: "s11", label: "Radar momentum", note: "Backtest #5: CLEAN or OK 60+, not pump.fun, liquidity $20k+, TP100 SL20, 24h", entry: { verdicts: ["CLEAN", "OK"], minScore: 60, noPumpFun: true, minLiqUsd: 20_000 }, exits: { tpPct: 100, slPct: 20, maxHoldMin: 24 * H }, sizeUsd: 100, enabled: false },
  { id: "s12", label: "Deep liquidity", note: "Backtest #4: CLEAN, OK or RISKY with $100k+ liquidity, TP100 SL20, 24h", entry: { verdicts: ["CLEAN", "OK", "RISKY"], minLiqUsd: 100_000 }, exits: { tpPct: 100, slPct: 20, maxHoldMin: 24 * H }, sizeUsd: 100, enabled: true },
  { id: "s13", label: "Momentum trail", note: "Same entry as Radar momentum, stop -20%, 25% trail once up 50%, 24h", entry: { verdicts: ["CLEAN", "OK"], minScore: 60, noPumpFun: true, minLiqUsd: 20_000 }, exits: { slPct: 20, trailPct: 25, trailArmPct: 50, maxHoldMin: 24 * H }, sizeUsd: 100, enabled: false },
  { id: "s14", label: "Clean 20k+ TP100", note: "CLEAN with $20k+ liquidity, any launchpad, TP100 SL30, 24h", entry: { verdicts: ["CLEAN"], minLiqUsd: 20_000 }, exits: { tpPct: 100, slPct: 30, maxHoldMin: 24 * H }, sizeUsd: 100, enabled: true },
  // Теневая оценка v2 (score-v2.ts): вход по вердикту v2 при любом публичном. Пара к s1 и s14 для сравнения вперёд.
  { id: "s15", label: "V2 CLEAN TP100", note: "Shadow score v2 says CLEAN (any public verdict), TP100 SL30, 24h", entry: { verdictsV2: ["CLEAN"] }, exits: { tpPct: 100, slPct: 30, maxHoldMin: 24 * H }, sizeUsd: 100, enabled: true },
  { id: "s16", label: "V2 CLEAN hold 24h", note: "Baseline for v2: shadow score v2 says CLEAN, no stops, sold after 24h", entry: { verdictsV2: ["CLEAN"] }, exits: { maxHoldMin: 24 * H }, sizeUsd: 100, enabled: true },
  // Подтверждённый вход (22.10): CLEAN на Robinhood (PB, SPOUR) теряли ликвидность за 1-4 минуты после скана,
  // мгновенный вход съедал каждый такой вытащенный пул. Ждём и входим, только если пул жив и цена не убежала.
  { id: "s17", label: "CLEAN confirmed 10m", note: "CLEAN, buy 10 min after the scan only if 80%+ of liquidity is still there, price not down 15% or up 60%, TP100 SL30, 24h", entry: { verdicts: ["CLEAN"], delayMin: 10, confirm: CONFIRM }, exits: { tpPct: 100, slPct: 30, maxHoldMin: 24 * H }, sizeUsd: 100, enabled: false },
  { id: "s18", label: "Every coin confirmed 10m", note: "Control for S17: every verdict, same 10 min confirmation, TP100 SL30, 24h", entry: { verdicts: ["CLEAN", "OK", "RISKY", "DANGER"], delayMin: 10, confirm: CONFIRM }, exits: { tpPct: 100, slPct: 30, maxHoldMin: 24 * H }, sizeUsd: 100, enabled: false },
  { id: "s19", label: "V2 CLEAN confirmed 10m", note: "Shadow score v2 says CLEAN, same 10 min confirmation, TP100 SL30, 24h", entry: { verdictsV2: ["CLEAN"], delayMin: 10, confirm: CONFIRM }, exits: { tpPct: 100, slPct: 30, maxHoldMin: 24 * H }, sizeUsd: 100, enabled: true },
  { id: "s20", label: "CLEAN confirmed 30m", note: "Like S17 but waits 30 min after the scan, TP100 SL30, 24h", entry: { verdicts: ["CLEAN"], delayMin: 30, confirm: CONFIRM }, exits: { tpPct: 100, slPct: 30, maxHoldMin: 24 * H }, sizeUsd: 100, enabled: true },
  // Ночь 22.10: лучше всех держатся TP100/SL30 на ликвидности от $20k (s11, s12, s14, s15). Скальп s4 хуже контроля s6, выключен.
  { id: "s21", label: "Clean+OK 20k+ TP100", note: "CLEAN or OK with $20k+ liquidity, TP100 SL30, 24h", entry: { verdicts: ["CLEAN", "OK"], minLiqUsd: 20_000 }, exits: { tpPct: 100, slPct: 30, maxHoldMin: 24 * H }, sizeUsd: 100, enabled: true },
  { id: "s22", label: "V2 not DANGER 20k+", note: "Second look CLEAN, OK or RISKY with $20k+ liquidity, TP100 SL30, 24h", entry: { verdictsV2: ["CLEAN", "OK", "RISKY"], minLiqUsd: 20_000 }, exits: { tpPct: 100, slPct: 30, maxHoldMin: 24 * H }, sizeUsd: 100, enabled: true },
  // 12:55: s8 (трейлинг 25%) 15 сделок, -16% против -4.5% у контроля, выключен. Стопы SL30 закрываются около -46%: пробуем шире.
  { id: "s23", label: "Clean 20k+ wide stop", note: "CLEAN with $20k+ liquidity, TP100 SL40, 24h", entry: { verdicts: ["CLEAN"], minLiqUsd: 20_000 }, exits: { tpPct: 100, slPct: 40, maxHoldMin: 24 * H }, sizeUsd: 100, enabled: false },
  // 22.10: v2 стал публичным, теневая теперь v3 (ончейн-сигналы). Пара к s15/s16 для сравнения вперёд.
  { id: "s24", label: "V3 CLEAN TP100", note: "Shadow score v3 says CLEAN (any public verdict), TP100 SL30, 24h", entry: { verdictsV3: ["CLEAN"] }, exits: { tpPct: 100, slPct: 30, maxHoldMin: 24 * H }, sizeUsd: 100, enabled: true },
  { id: "s25", label: "V3 CLEAN hold 24h", note: "Baseline for v3: shadow score v3 says CLEAN, no stops, sold after 24h", entry: { verdictsV3: ["CLEAN"] }, exits: { maxHoldMin: 24 * H }, sizeUsd: 100, enabled: true },
  // 14:40: s18 (любая монета через 10 мин) 35 сделок, -18.5% против -5.4% у контроля s6, выключен. Ожидание 30 мин (s20) пока лучше 10 мин: пробуем его на v2.
  { id: "s26", label: "V2 CLEAN confirmed 30m", note: "Score v2 says CLEAN, buy 30 min after the scan only if 80%+ of liquidity is still there, price not down 15% or up 60%, TP100 SL30, 24h", entry: { verdictsV2: ["CLEAN"], delayMin: 30, confirm: CONFIRM }, exits: { tpPct: 100, slPct: 30, maxHoldMin: 24 * H }, sizeUsd: 100, enabled: true },
  { id: "s27", label: "V2 CLEAN deep no pump", note: "Score v2 says CLEAN, not pump.fun, liquidity $50k+, TP100 SL40, 24h", entry: { verdictsV2: ["CLEAN"], noPumpFun: true, minLiqUsd: 50_000 }, exits: { tpPct: 100, slPct: 40, maxHoldMin: 24 * H }, sizeUsd: 100, enabled: true },
  // 22.10: стопы SL30 на минутных замерах исполняются около -45%. Быстрые близнецы s6/s14/s15: замер каждые 10 с,
  // зато +3% проскальзывания на каждую сторону (как высокий допуск и приоритетная комиссия в живой торговле).
  { id: "s28", label: "Every coin fast", note: "Control for fast fills: like S6, prices every 10s, +3% slippage per side", entry: { verdicts: ["CLEAN", "OK", "RISKY", "DANGER"] }, exits: { tpPct: 50, slPct: 30, maxHoldMin: 6 * H }, sizeUsd: 100, fast: { extraSlipPct: 3 }, enabled: false },
  { id: "s29", label: "Clean 20k+ TP100 fast", note: "Like S14, prices every 10s, +3% slippage per side", entry: { verdicts: ["CLEAN"], minLiqUsd: 20_000 }, exits: { tpPct: 100, slPct: 30, maxHoldMin: 24 * H }, sizeUsd: 100, fast: { extraSlipPct: 3 }, enabled: false },
  { id: "s30", label: "V2 CLEAN TP100 fast", note: "Like S15, prices every 10s, +3% slippage per side", entry: { verdictsV2: ["CLEAN"] }, exits: { tpPct: 100, slPct: 30, maxHoldMin: 24 * H }, sizeUsd: 100, fast: { extraSlipPct: 3 }, enabled: true },
  // 22.10 вечер: s3 (runner) 24 сделки -19.2% и s9 (fresh momentum) 22 сделки -9.8% при контроле s6 -5%, выключены.
  // Лучше всех глубокие пулы (s12 +9.1%, PF 1.49) и v2 не DANGER от $20k (s22): скрещиваем, и быстрый близнец s12.
  { id: "s31", label: "V2 not DANGER deep", note: "Score v2 CLEAN, OK or RISKY with $100k+ liquidity, TP100 SL20, 24h", entry: { verdictsV2: ["CLEAN", "OK", "RISKY"], minLiqUsd: 100_000 }, exits: { tpPct: 100, slPct: 20, maxHoldMin: 24 * H }, sizeUsd: 100, enabled: true },
  { id: "s32", label: "Deep liquidity fast", note: "Like S12, prices every 10s, +3% slippage per side", entry: { verdicts: ["CLEAN", "OK", "RISKY"], minLiqUsd: 100_000 }, exits: { tpPct: 100, slPct: 20, maxHoldMin: 24 * H }, sizeUsd: 100, fast: { extraSlipPct: 3 }, enabled: true },
  // 22.10 ночь: s17 (CLEAN через 10 мин) 17 сделок -14.9% при контроле s6 -4.1%, выключен. Лидеры: CLEAN от $20k с TP100
  // (s14 +11.4%, s21 +12.6%, s23 SL40 +15.3%), быстрый s29 +16.1%. Пробуем быстрые близнецы широкого стопа.
  { id: "s33", label: "Clean 20k+ wide stop fast", note: "Like S23, prices every 10s, +3% slippage per side", entry: { verdicts: ["CLEAN"], minLiqUsd: 20_000 }, exits: { tpPct: 100, slPct: 40, maxHoldMin: 24 * H }, sizeUsd: 100, fast: { extraSlipPct: 3 }, enabled: true },
  { id: "s34", label: "Clean+OK 20k+ wide fast", note: "CLEAN or OK with $20k+ liquidity, TP100 SL40, prices every 10s, +3% slippage per side", entry: { verdicts: ["CLEAN", "OK"], minLiqUsd: 20_000 }, exits: { tpPct: 100, slPct: 40, maxHoldMin: 24 * H }, sizeUsd: 100, fast: { extraSlipPct: 3 }, enabled: true },
  // 22.10 ночь: стратегии на теневых оценках впереди (s15 +16%, s19 +34%, s24 +21%, s30 +44%, выборки малые), а широкий стоп s23 сполз до -3.8% (стопы по -56%).
  // Проверяем согласие v2 и v3 и быстрый близнец s24.
  { id: "s35", label: "V2 and V3 CLEAN", note: "Both score v2 and score v3 say CLEAN, TP100 SL30, 24h", entry: { verdictsV2: ["CLEAN"], verdictsV3: ["CLEAN"] }, exits: { tpPct: 100, slPct: 30, maxHoldMin: 24 * H }, sizeUsd: 100, enabled: true },
  { id: "s36", label: "V3 CLEAN TP100 fast", note: "Like S24, prices every 10s, +3% slippage per side", entry: { verdictsV3: ["CLEAN"] }, exits: { tpPct: 100, slPct: 30, maxHoldMin: 24 * H }, sizeUsd: 100, fast: { extraSlipPct: 3 }, enabled: true },
  // 23.10 ночь: быстрый контроль s28 54 сделки -8.4% (PF 0.69) против -4.2% у обычного s6: на случайных монетах скорость не окупает +3%, выключен.
  // Лучший вход пока v2 CLEAN с подтверждением через 10 мин (s19 +24%, PF 2.1, 7 сделок): пробуем то же на v3 и с ранней фиксацией.
  { id: "s37", label: "V3 CLEAN confirmed 10m", note: "Score v3 says CLEAN, buy 10 min after the scan only if 80%+ of liquidity is still there, price not down 15% or up 60%, TP100 SL30, 24h", entry: { verdictsV3: ["CLEAN"], delayMin: 10, confirm: CONFIRM }, exits: { tpPct: 100, slPct: 30, maxHoldMin: 24 * H }, sizeUsd: 100, enabled: true },
  { id: "s38", label: "V2 CLEAN confirmed 10m TP50", note: "Like S19 but takes profit at +50%, TP50 SL30, 24h", entry: { verdictsV2: ["CLEAN"], delayMin: 10, confirm: CONFIRM }, exits: { tpPct: 50, slPct: 30, maxHoldMin: 24 * H }, sizeUsd: 100, enabled: true },
  // 23.10 ночь: широкий стоп s23 18 сделок -8.3% (PF 0.79) против -3.9% у s6, стопы исполняются около -54%: выключен.
  // Лидер теперь глубокие пулы: s12 +31.2% (9 сделок, PF 3.2), быстрый s32 два TP. Проверяем, тянут ли раннеры дальше и держится ли край на $50k.
  { id: "s39", label: "Deep liquidity TP200", note: "Like S12 but takes profit at +200%: CLEAN, OK or RISKY with $100k+ liquidity, TP200 SL20, 24h", entry: { verdicts: ["CLEAN", "OK", "RISKY"], minLiqUsd: 100_000 }, exits: { tpPct: 200, slPct: 20, maxHoldMin: 24 * H }, sizeUsd: 100, enabled: true },
  { id: "s40", label: "Liquidity 50k+", note: "Like S12 with a lower bar: CLEAN, OK or RISKY with $50k+ liquidity, TP100 SL20, 24h", entry: { verdicts: ["CLEAN", "OK", "RISKY"], minLiqUsd: 50_000 }, exits: { tpPct: 100, slPct: 20, maxHoldMin: 24 * H }, sizeUsd: 100, enabled: true },
  // 23.10: на мемах итог делают одна-две монеты. Частичная фиксация: на x2 продаём половину (вложенное вернулось),
  // стоп переезжает на вход, остаток едет со скользящим стопом 30% от пика. Пробуем на двух лучших входах (S12 и S19).
  { id: "s41", label: "Deep liquidity half at 2x", note: "Like S12: CLEAN, OK or RISKY with $100k+ liquidity, stop -20%, sell half at +100%, then stop at entry and 30% trail on the rest, 24h", entry: { verdicts: ["CLEAN", "OK", "RISKY"], minLiqUsd: 100_000 }, exits: { slPct: 20, partial: { atPct: 100, sellPct: 50, breakeven: true }, trailPct: 30, trailArmPct: 100, maxHoldMin: 24 * H }, sizeUsd: 100, enabled: true },
  { id: "s42", label: "V2 CLEAN 10m half at 2x", note: "Like S19: score v2 CLEAN, 10 min confirmation, stop -30%, sell half at +100%, then stop at entry and 30% trail on the rest, 24h", entry: { verdictsV2: ["CLEAN"], delayMin: 10, confirm: CONFIRM }, exits: { slPct: 30, partial: { atPct: 100, sellPct: 50, breakeven: true }, trailPct: 30, trailArmPct: 100, maxHoldMin: 24 * H }, sizeUsd: 100, enabled: true },
  // 23.10 ночь: контроль s6 сполз до -5.8%. Хуже него: s11 (17 сделок -9.7%, PF 0.64), s13 (16, -10.2%, PF 0.61) и быстрый s29
  // (17, -10.7%, PF 0.69), выключены. CLEAN через 30 мин (s20) единственный из CLEAN в плюсе (+2.7%, 20 сделок): даём ему частичную фиксацию.
  { id: "s43", label: "CLEAN 30m half at 2x", note: "Like S20: CLEAN, 30 min confirmation, stop -30%, sell half at +100%, then stop at entry and 30% trail on the rest, 24h", entry: { verdicts: ["CLEAN"], delayMin: 30, confirm: CONFIRM }, exits: { slPct: 30, partial: { atPct: 100, sellPct: 50, breakeven: true }, trailPct: 30, trailArmPct: 100, maxHoldMin: 24 * H }, sizeUsd: 100, enabled: true },
  // 23.10 день: два входа держатся и без двух лучших сделок: s19 (v2 CLEAN через 10 мин, +27%, 9 сделок) и s12 (пул от $100k, +21%, 11).
  // Скрещиваем: v2 CLEAN, подтверждение через 10 мин, пул от $50k, стоп -20% как у s12.
  // 23.10 день: базовый s1 (CLEAN без стопов, 24 ч) 17 сделок -61.5% (5 рагов, остальные по времени) против -5.6% у s6:
  // урок усвоен, без стопов нельзя; выключен, его 36 открытых позиций доживут свои сутки.
  { id: "s44", label: "V2 CLEAN 10m 50k+", note: "Score v2 CLEAN, 10 min confirmation, liquidity $50k+, TP100 SL20, 24h", entry: { verdictsV2: ["CLEAN"], minLiqUsd: 50_000, delayMin: 10, confirm: CONFIRM }, exits: { tpPct: 100, slPct: 20, maxHoldMin: 24 * H }, sizeUsd: 100, enabled: true },
];

// ---------- параметры симуляции ----------

const SAMPLE_MS = 60_000;
const FAST_MS = 10_000; // замер позиций стратегий с fast
const FEE = 0.01; // 1% на каждую сторону
const SLIP_CAP = 0.15; // проскальзывание: размер / ликвидность, но не больше 15%
const RUG_LIQ = 500; // ликвидность ниже — пары как будто нет
const RUG_SAMPLES = 3;
const MAX_OPEN = 40; // на стратегию
const MAX_JUMP = 100; // цена ×100 за минуту — сбой данных, замер пропускаем
const REENTRY_MS = 24 * 3600_000; // тот же токен той же стратегией не раньше чем через сутки
const BUNDLE_PCT = 5;
const CACHE_MS = 30_000;
const PENDING_GRACE_MS = 10 * 60_000; // ожидание старше delayMin + 10 мин (не было цены) выкидываем

export const paperEnabled = () => process.env.PAPER_ENGINE !== "0";

// ---------- признаки входа (они же уходят в экспорт) ----------

export interface Features {
  // verdict/score - всегда v1: стратегии s1-s23 заведены на нём. С 22.10 публичный вердикт скана - это v2,
  // а v1 лежит в r.v1; поэтому берём оттуда, а у старых сканов без r.v1 публичный и есть v1.
  verdict: Verdict;
  score: number | null;
  scoreV2: number | null; // оценка v2 (с 22.10 публичная); null — скан без v2
  verdictV2: VerdictV2 | null;
  scoreV3: number | null; // теневая оценка v3; null — скан без v3
  verdictV3: VerdictV2 | null;
  ageMin: number | null;
  liqUsd: number | null;
  fdv: number | null;
  top1: number | null;
  top10: number | null;
  snipersPct: number | null;
  snipers: number | null;
  bundlePct: number | null; // крупнейший кластер, % эмиссии; 0 — кластеров нет
  freshPct: number | null;
  devHoldsPct: number | null;
  lp: string | null;
  mint: boolean | null;
  freeze: boolean | null;
  buys1h: number | null;
  sells1h: number | null;
  volume1h: number | null;
  change1h: number | null;
  socials: number | null;
  flags: string[];
  // Только у подтверждённого входа: что было на скане и сколько прошло до покупки.
  signal?: { at: number; price: number; liqUsd: number; waitMin: number; liqKeepPct: number; movePct: number };
}

const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);

export function featuresOf(r: ScanResult): Features {
  const m = r.market;
  return {
    verdict: r.v1?.verdict ?? r.verdict,
    score: r.v1 ? r.v1.score : r.score,
    scoreV2: r.v2?.scoreV2 ?? null,
    verdictV2: r.v2?.verdictV2 ?? null,
    scoreV3: r.v3?.scoreV3 ?? null,
    verdictV3: r.v3?.verdictV3 ?? null,
    ageMin: m?.ageHours != null ? Math.round(m.ageHours * 60) : null,
    liqUsd: num(m?.liquidityUsd),
    fdv: num(m?.fdv),
    top1: num(r.holders?.top1),
    top10: num(r.holders?.top10 ?? r.evm?.top10),
    snipersPct: num(r.snipers?.holdPct),
    snipers: num(r.snipers?.wallets),
    bundlePct: r.bundles ? Math.max(0, ...r.bundles.clusters.map((c) => c.pct)) : null,
    freshPct: num(r.bundles?.fresh.pct),
    devHoldsPct: num(r.dev?.holdsPct),
    lp: r.lp?.status ?? null,
    mint: r.holders ? r.holders.mintAuthority : null,
    freeze: r.holders ? r.holders.freezeAuthority : null,
    buys1h: num(m?.buys1h),
    sells1h: num(m?.sells1h),
    volume1h: num(m?.volume1h),
    change1h: num(m?.change1h),
    socials: num(m?.socials),
    flags: r.factors.filter((f) => f.impact < 0).map((f) => f.label),
  };
}

// Неизвестное значение фильтр не проходит: «мало снайперов» без данных о снайперах не доказано.
function matches(e: EntryRule, f: Features, chain: string, token: string): boolean {
  const verdicts = e.verdicts?.length ? e.verdicts : (["CLEAN", "OK", "RISKY", "DANGER"] as Verdict[]);
  if (!verdicts.includes(f.verdict)) return false;
  if (e.chains?.length && !e.chains.includes(chain)) return false;
  if (e.noPumpFun && chain === "solana" && token.endsWith("pump")) return false;
  const min = (v: number | null, lim?: number) => lim === undefined || (v !== null && v >= lim);
  const max = (v: number | null, lim?: number) => lim === undefined || (v !== null && v <= lim);
  if (!min(f.score, e.minScore) || !max(f.score, e.maxScore)) return false;
  if (e.verdictsV2?.length && (f.verdictV2 === null || !e.verdictsV2.includes(f.verdictV2))) return false;
  if (!min(f.scoreV2, e.minScoreV2)) return false;
  // У старых записей признаков (до 22.10) поля v3 нет вовсе: undefined считаем «нет данных».
  if (e.verdictsV3?.length && (f.verdictV3 == null || !e.verdictsV3.includes(f.verdictV3))) return false;
  if (!min(f.scoreV3 ?? null, e.minScoreV3)) return false;
  if (!min(f.ageMin, e.minAgeMin) || !max(f.ageMin, e.maxAgeMin)) return false;
  if (!min(f.liqUsd, e.minLiqUsd) || !max(f.liqUsd, e.maxLiqUsd)) return false;
  if (!min(f.fdv, e.minFdv) || !max(f.fdv, e.maxFdv)) return false;
  if (!max(f.top1, e.maxTop1Pct) || !max(f.top10, e.maxTop10Pct)) return false;
  if (!max(f.snipersPct, e.maxSnipersPct) || !max(f.freshPct, e.maxFreshPct) || !max(f.devHoldsPct, e.maxDevHoldsPct)) return false;
  if (e.noBundles && (f.bundlePct === null || f.bundlePct >= BUNDLE_PCT || f.flags.includes("Bundled"))) return false;
  if (e.lpSafe && !(f.lp === "burned" || f.lp === "locked" || f.lp === "curve")) return false;
  if (e.noMintFreeze && (f.mint !== false || f.freeze !== false)) return false;
  if (e.minBuySellRatio !== undefined && (f.buys1h === null || f.sells1h === null || f.buys1h / Math.max(1, f.sells1h) < e.minBuySellRatio)) return false;
  if (!min(f.volume1h, e.minVolume1h) || !min(f.socials, e.minSocials)) return false;
  if (e.excludeFlags?.some((x) => f.flags.includes(x))) return false;
  return true;
}

// ---------- база ----------

interface PosRow {
  id: number;
  strategy: string;
  token: string;
  chain: string;
  symbol: string;
  verdict: string;
  score: number | null;
  entry_at: number;
  entry_price: number;
  size: number;
  units: number; // сколько токенов куплено после комиссии и проскальзывания
  liq0: number;
  peak_price: number;
  peak_at: number;
  low_price: number | null;
  low_at: number | null;
  last_price: number;
  last_liq: number;
  last_at: number;
  missing: number;
  features: string;
  banked: number | null; // выручка частичной продажи, уже с комиссией и проскальзыванием
  partial_at: number | null;
}
export type ExitReason = "sl" | "tp" | "trail" | "time" | "rug" | "removed";
interface TradeRow {
  id: number;
  strategy: string;
  token: string;
  chain: string;
  symbol: string;
  verdict: string;
  score: number | null;
  entry_at: number;
  exit_at: number;
  entry_price: number;
  exit_price: number;
  size: number;
  proceeds: number;
  gross_pct: number;
  net_pct: number;
  pnl: number;
  peak_pct: number;
  reason: ExitReason;
  features: string;
}

// Отложенный вход: сигнал запомнен, покупка после delayMin минут, если подтвердится.
interface PendingRow {
  id: number;
  strategy: string;
  token: string;
  chain: string;
  symbol: string;
  verdict: string;
  score: number | null;
  signal_at: number;
  signal_price: number;
  signal_liq: number;
  features: string;
}
// liq: пул вытащили, drop: цена упала, ran: уже убежала вверх, expired: так и не дождались цены,
// full: к моменту входа у стратегии MAX_OPEN позиций, removed: стратегию убрали или выключили.
export type SkipReason = "liq" | "drop" | "ran" | "expired" | "full" | "removed";
const SKIP_LOG: Record<SkipReason, string> = { liq: "liq pulled", drop: "dropped", ran: "ran", expired: "expired", full: "full", removed: "removed" };

const host = globalThis as unknown as { __crawlhivePaperDb?: boolean; __crawlhivePaper?: { started: boolean; busy: boolean; lastTick: number; lastErr?: string } };
const st = () => (host.__crawlhivePaper ??= { started: false, busy: false, lastTick: 0 });

function db() {
  const d = memDb();
  if (!d) return null;
  if (!host.__crawlhivePaperDb) {
    d.db.exec(`
      CREATE TABLE IF NOT EXISTS paper_positions (id INTEGER PRIMARY KEY AUTOINCREMENT, strategy TEXT NOT NULL, token TEXT NOT NULL, chain TEXT NOT NULL,
        symbol TEXT NOT NULL, verdict TEXT NOT NULL, score INTEGER, entry_at INTEGER NOT NULL, entry_price REAL NOT NULL, size REAL NOT NULL,
        units REAL NOT NULL, liq0 REAL NOT NULL, peak_price REAL NOT NULL, peak_at INTEGER NOT NULL, last_price REAL NOT NULL, last_liq REAL NOT NULL,
        last_at INTEGER NOT NULL, missing INTEGER NOT NULL DEFAULT 0, features TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS paper_positions_st ON paper_positions (strategy, token);
      CREATE TABLE IF NOT EXISTS paper_trades (id INTEGER PRIMARY KEY, strategy TEXT NOT NULL, token TEXT NOT NULL, chain TEXT NOT NULL,
        symbol TEXT NOT NULL, verdict TEXT NOT NULL, score INTEGER, entry_at INTEGER NOT NULL, exit_at INTEGER NOT NULL, entry_price REAL NOT NULL,
        exit_price REAL NOT NULL, size REAL NOT NULL, proceeds REAL NOT NULL, gross_pct REAL NOT NULL, net_pct REAL NOT NULL, pnl REAL NOT NULL,
        peak_pct REAL NOT NULL, reason TEXT NOT NULL, features TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS paper_trades_st ON paper_trades (strategy, exit_at);
      CREATE INDEX IF NOT EXISTS paper_trades_token ON paper_trades (strategy, token, entry_at);
      CREATE TABLE IF NOT EXISTS paper_pending (id INTEGER PRIMARY KEY AUTOINCREMENT, strategy TEXT NOT NULL, token TEXT NOT NULL, chain TEXT NOT NULL,
        symbol TEXT NOT NULL, verdict TEXT NOT NULL, score INTEGER, signal_at INTEGER NOT NULL, signal_price REAL NOT NULL, signal_liq REAL NOT NULL,
        features TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS paper_pending_st ON paper_pending (strategy, token);
      -- Пропуски храним поштучно с ценами: потом можно проверить, были ли пропущенные монеты ругами на самом деле.
      CREATE TABLE IF NOT EXISTS paper_skips (id INTEGER PRIMARY KEY AUTOINCREMENT, strategy TEXT NOT NULL, token TEXT NOT NULL, chain TEXT NOT NULL,
        symbol TEXT NOT NULL, verdict TEXT NOT NULL, score INTEGER, reason TEXT NOT NULL, signal_at INTEGER NOT NULL, at INTEGER NOT NULL,
        signal_price REAL NOT NULL, price REAL, signal_liq REAL NOT NULL, liq REAL);
      CREATE INDEX IF NOT EXISTS paper_skips_st ON paper_skips (strategy, token, signal_at);
    `);
    // Минимум цены и время пика/минимума: по истории (замер раз в 10 мин) не видно, что было раньше, тейк или стоп.
    for (const sql of [
      "ALTER TABLE paper_positions ADD COLUMN low_price REAL",
      "ALTER TABLE paper_positions ADD COLUMN low_at INTEGER",
      "ALTER TABLE paper_trades ADD COLUMN peak_at INTEGER",
      "ALTER TABLE paper_trades ADD COLUMN low_pct REAL",
      "ALTER TABLE paper_trades ADD COLUMN low_at INTEGER",
      "ALTER TABLE paper_positions ADD COLUMN banked REAL",
      "ALTER TABLE paper_positions ADD COLUMN partial_at INTEGER",
      "ALTER TABLE paper_trades ADD COLUMN partial_at INTEGER",
    ])
      try {
        d.db.exec(sql);
      } catch {
        // колонка уже есть
      }
    host.__crawlhivePaperDb = true;
  }
  return d.db;
}

const slip = (size: number, liq: number) => Math.min(SLIP_CAP, liq > 0 ? size / liq : SLIP_CAP);
const extraSlip = (strategy: string) => (STRATEGIES.find((x) => x.id === strategy)?.fast?.extraSlipPct ?? 0) / 100;
const r2 = (n: number) => Math.round(n * 100) / 100;
const startedAt = () => {
  const d = memDb();
  const v = d ? kvGet(d, "paper_engine_started") : undefined;
  return v ? Number(v) : null;
};

// ---------- вход: зовётся из radar.ts, когда вердикт готов ----------

export function paperOnSignal(r: ScanResult) {
  if (!paperEnabled()) return;
  const price = Number(r.market?.priceUsd);
  const liq = Number(r.market?.liquidityUsd);
  const f = featuresOf(r);
  if (!(price > 0) || !(liq > 0) || f.verdict === "TOO_EARLY") return;
  const d = db();
  if (!d) return;
  const now = Date.now();
  const fj = JSON.stringify(f);
  for (const s of STRATEGIES) {
    if (!s.enabled || !matches(s.entry, f, r.chain, r.id)) continue;
    // Лимит считаем вместе с ожидающими: иначе к моменту входа у стратегии окажется больше MAX_OPEN.
    const busy = d.prepare("SELECT (SELECT COUNT(*) FROM paper_positions WHERE strategy = ?) + (SELECT COUNT(*) FROM paper_pending WHERE strategy = ?) AS n").get(s.id, s.id) as { n: number };
    if (busy.n >= MAX_OPEN) continue;
    if (d.prepare("SELECT 1 FROM paper_positions WHERE strategy = ? AND token = ?").get(s.id, r.id)) continue;
    if (d.prepare("SELECT 1 FROM paper_pending WHERE strategy = ? AND token = ?").get(s.id, r.id)) continue;
    if (d.prepare("SELECT 1 FROM paper_trades WHERE strategy = ? AND token = ? AND entry_at > ?").get(s.id, r.id, now - REENTRY_MS)) continue;
    if (s.entry.delayMin) {
      // Пропущенную монету тоже не берём повторно в окне перевхода: иначе пересканы раздувают счётчик пропусков.
      if (d.prepare("SELECT 1 FROM paper_skips WHERE strategy = ? AND token = ? AND signal_at > ?").get(s.id, r.id, now - REENTRY_MS)) continue;
      d.prepare(
        `INSERT INTO paper_pending (strategy, token, chain, symbol, verdict, score, signal_at, signal_price, signal_liq, features) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(s.id, r.id, r.chain, r.symbol, f.verdict, f.score, now, price, liq, fj);
      console.log(`[paper] wait ${s.id} $${r.symbol} ${r.chain} ${f.verdict} ${s.entry.delayMin}m, scan $${price} liq $${Math.round(liq)}`);
      cache = null;
      continue;
    }
    // В сделке пишем v1, как и в признаках: стратегии заведены на нём.
    openPosition(s, { token: r.id, chain: r.chain, symbol: r.symbol, verdict: f.verdict, score: f.score }, price, liq, fj, now);
  }
}

// Покупка: 1% комиссии, остаток идёт по цене хуже на проскальзывание.
function openPosition(s: StrategyConfig, c: { token: string; chain: string; symbol: string; verdict: string; score: number | null }, price: number, liq: number, features: string, now: number) {
  const d = db()!;
  const units = (s.sizeUsd * (1 - FEE)) / (price * (1 + slip(s.sizeUsd, liq) + extraSlip(s.id)));
  d.prepare(
    `INSERT INTO paper_positions (strategy, token, chain, symbol, verdict, score, entry_at, entry_price, size, units, liq0, peak_price, peak_at, last_price, last_liq, last_at, missing, features)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
  ).run(s.id, c.token, c.chain, c.symbol, c.verdict, c.score, now, price, s.sizeUsd, units, liq, price, now, price, liq, now, features);
  cache = null;
  console.log(`[paper] open ${s.id} $${c.symbol} ${c.chain} ${c.verdict}${c.score != null ? ` ${c.score}` : ""} at $${price} liq $${Math.round(liq)}`);
}

// ---------- подтверждение отложенного входа ----------

function skipPending(q: PendingRow, reason: SkipReason, now: number, price: number | null, liq: number | null) {
  const d = db()!;
  d.exec("BEGIN");
  try {
    d.prepare(
      `INSERT INTO paper_skips (strategy, token, chain, symbol, verdict, score, reason, signal_at, at, signal_price, price, signal_liq, liq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(q.strategy, q.token, q.chain, q.symbol, q.verdict, q.score, reason, q.signal_at, now, q.signal_price, price, q.signal_liq, liq);
    d.prepare("DELETE FROM paper_pending WHERE id = ?").run(q.id);
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
  const detail =
    price != null && liq != null ? ` (price ${pct1(((price - q.signal_price) / q.signal_price) * 100)}, liq $${Math.round(q.signal_liq)} -> $${Math.round(liq)})` : "";
  console.log(`[paper] skip ${q.strategy} $${q.symbol} ${SKIP_LOG[reason]}${detail}`);
}
const pct1 = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

// Ожидающий вход в этот тик: либо ждём дальше, либо решение (позиция открыта или пропуск записан).
// pair === undefined: замера по сети не было (сбой API), это не повод считать пул вытащенным.
function resolvePending(q: PendingRow, s: StrategyConfig | undefined, pair: PairInfo | null | undefined, now: number) {
  if (!s || !s.enabled || !s.entry.delayMin) return skipPending(q, "removed", now, null, null);
  const dueAt = q.signal_at + s.entry.delayMin * 60_000;
  if (now < dueAt) return;
  if (pair === undefined) {
    if (now > dueAt + PENDING_GRACE_MS) skipPending(q, "expired", now, null, null);
    return;
  }
  const price = Number(pair?.priceUsd);
  const liq = pair?.liquidity?.usd ?? 0;
  // Пары нет или ликвидность ниже порога руга: пул вытащили, независимо от правил стратегии.
  if (!pair || !(price > 0) || liq < RUG_LIQ) return skipPending(q, "liq", now, price > 0 ? price : null, liq);
  if (price > q.signal_price * MAX_JUMP) {
    // Сбой данных: ждём следующего замера, а по истечении окна выкидываем.
    if (now > dueAt + PENDING_GRACE_MS) skipPending(q, "expired", now, price, liq);
    return;
  }
  const c = s.entry.confirm ?? {};
  const keepPct = (liq / q.signal_liq) * 100;
  const movePct = ((price - q.signal_price) / q.signal_price) * 100;
  if (c.minLiqKeepPct !== undefined && keepPct < c.minLiqKeepPct) return skipPending(q, "liq", now, price, liq);
  if (c.maxDropPct !== undefined && movePct < -c.maxDropPct) return skipPending(q, "drop", now, price, liq);
  if (c.maxRisePct !== undefined && movePct > c.maxRisePct) return skipPending(q, "ran", now, price, liq);
  const d = db()!;
  const open = d.prepare("SELECT COUNT(*) AS n FROM paper_positions WHERE strategy = ?").get(s.id) as { n: number };
  if (open.n >= MAX_OPEN) return skipPending(q, "full", now, price, liq);
  let f: Features | null = null;
  try {
    f = JSON.parse(q.features) as Features;
  } catch {
    // старые признаки битые: входим без них
  }
  const features = JSON.stringify({ ...(f ?? {}), signal: { at: q.signal_at, price: q.signal_price, liqUsd: q.signal_liq, waitMin: Math.round((now - q.signal_at) / 60_000), liqKeepPct: r1(keepPct), movePct: r1(movePct) } });
  d.exec("BEGIN");
  try {
    d.prepare("DELETE FROM paper_pending WHERE id = ?").run(q.id);
    // Позиция по тому же токену могла появиться иначе (уникальный индекс): тогда просто снимаем ожидание.
    if (!d.prepare("SELECT 1 FROM paper_positions WHERE strategy = ? AND token = ?").get(s.id, q.token)) openPosition(s, q, price, liq, features, now);
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

// ---------- выход ----------

function close(p: PosRow, price: number, liq: number, reason: ExitReason, now: number) {
  const d = db()!;
  // После частичной фиксации к выручке остатка прибавляется уже взятое: при руге теряется только остаток.
  const proceeds = (p.banked ?? 0) + (reason === "rug" ? 0 : p.units * price * Math.max(0, 1 - slip(p.size, liq) - extraSlip(p.strategy)) * (1 - FEE));
  const pnl = proceeds - p.size;
  const t = {
    gross: reason === "rug" ? -100 : ((price - p.entry_price) / p.entry_price) * 100,
    net: (pnl / p.size) * 100,
    peak: ((p.peak_price - p.entry_price) / p.entry_price) * 100,
  };
  d.exec("BEGIN");
  try {
    d.prepare(
      `INSERT INTO paper_trades (id, strategy, token, chain, symbol, verdict, score, entry_at, exit_at, entry_price, exit_price, size, proceeds, gross_pct, net_pct, pnl, peak_pct, reason, features)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(p.id, p.strategy, p.token, p.chain, p.symbol, p.verdict, p.score, p.entry_at, now, p.entry_price, reason === "rug" ? 0 : price, p.size, r2(proceeds), r2(t.gross), r2(t.net), r2(pnl), r2(t.peak), reason, p.features);
    const low = p.low_price ?? p.entry_price;
    d.prepare("UPDATE paper_trades SET peak_at = ?, low_pct = ?, low_at = ?, partial_at = ? WHERE id = ?").run(p.peak_at, r2(((low - p.entry_price) / p.entry_price) * 100), p.low_at ?? p.entry_at, p.partial_at, p.id);
    d.prepare("DELETE FROM paper_positions WHERE id = ?").run(p.id);
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
  console.log(`[paper] close ${p.strategy} $${p.symbol} ${reason} ${t.net >= 0 ? "+" : ""}${t.net.toFixed(1)}% ($${pnl.toFixed(2)}) after ${Math.round((now - p.entry_at) / 60_000)}m`);
}

// Частичная продажа по текущему замеру с теми же издержками, что и полный выход; позиция остаётся открытой.
function takePartial(p: PosRow, sellPct: number, price: number, liq: number, now: number) {
  const sold = p.units * (sellPct / 100);
  const got = sold * price * Math.max(0, 1 - slip(p.size * (sellPct / 100), liq) - extraSlip(p.strategy)) * (1 - FEE);
  Object.assign(p, { units: p.units - sold, banked: (p.banked ?? 0) + got, partial_at: now });
  db()!.prepare("UPDATE paper_positions SET units = ?, banked = ?, partial_at = ? WHERE id = ?").run(p.units, p.banked, now, p.id);
  console.log(`[paper] partial ${p.strategy} $${p.symbol} sold ${sellPct}% at ${pct1(((price - p.entry_price) / p.entry_price) * 100)} for $${got.toFixed(2)}`);
}

// Правила по порядку: стоп, тейк, трейлинг, время. Цена выхода — фактический замер, а не уровень стопа:
// между минутными замерами мемкоин легко пролетает уровень, и честнее считать по реальной цене.
function exitFor(p: PosRow, s: StrategyConfig | undefined, price: number, now: number): ExitReason | null {
  if (!s) return "removed";
  const x = s.exits;
  const pct = ((price - p.entry_price) / p.entry_price) * 100;
  if (x.slPct !== undefined && pct <= -x.slPct) return "sl";
  if (p.partial_at && x.partial?.breakeven && pct <= 0) return "sl";
  if (x.tpPct !== undefined && pct >= x.tpPct) return "tp";
  if (x.trailPct !== undefined) {
    const peakPct = ((p.peak_price - p.entry_price) / p.entry_price) * 100;
    const fromPeak = ((price - p.peak_price) / p.peak_price) * 100;
    if (peakPct >= (x.trailArmPct ?? 0) && fromPeak <= -x.trailPct) return "trail";
  }
  if (now - p.entry_at >= x.maxHoldMin * 60_000) return "time";
  return null;
}

// fastOnly: частый тик только по позициям стратегий с fast, без ожидающих входов (они живут на минутном).
export async function paperTick(fastOnly = false) {
  const s = st();
  if (s.busy || !paperEnabled()) return 0;
  const d = db();
  if (!d) return 0;
  s.busy = true;
  try {
    const now = Date.now();
    const byId = new Map(STRATEGIES.map((x) => [x.id, x]));
    const open = (d.prepare("SELECT * FROM paper_positions").all() as unknown as PosRow[]).filter((p) => !fastOnly || byId.get(p.strategy)?.fast);
    // Ожидающие входы, чьё время пришло (или стратегию убрали): цены для них берём тем же запросом, что и для позиций.
    const pending = (fastOnly ? [] : (d.prepare("SELECT * FROM paper_pending").all() as unknown as PendingRow[])).filter((q) => {
      const s = byId.get(q.strategy);
      return !s?.enabled || !s.entry.delayMin || now >= q.signal_at + s.entry.delayMin * 60_000;
    });
    if (!open.length && !pending.length) return 0;
    // Один токен у нескольких стратегий запрашиваем один раз; bestPairs режет на пачки по 30 и берёт самую
    // ликвидную пару (после миграции с pump.fun цена живёт в новом пуле).
    const byChain = new Map<string, Set<string>>();
    for (const p of [...open, ...pending]) byChain.set(p.chain, (byChain.get(p.chain) ?? new Set()).add(p.token));
    const prices = new Map<string, PairInfo | null>();
    for (const [chain, ids] of byChain) {
      try {
        const pairs = await bestPairs(chain, [...ids]);
        for (const id of ids) prices.set(`${chain}:${id}`, pairs.get(id) ?? null);
      } catch (e) {
        // Сбой API — не повод считать пару пропавшей: просто пропускаем замер этой сети.
        s.lastErr = `${chain}: ${(e as Error).message}`;
        console.warn("[paper] dexscreener failed:", s.lastErr);
      }
    }
    const upd = d.prepare("UPDATE paper_positions SET peak_price = ?, peak_at = ?, last_price = ?, last_liq = ?, last_at = ?, missing = ? WHERE id = ?");
    for (const p of open) {
      const key = `${p.chain}:${p.token}`;
      if (!prices.has(key)) continue;
      const pair = prices.get(key);
      const price = Number(pair?.priceUsd);
      const liq = pair?.liquidity?.usd ?? 0;
      const strat = byId.get(p.strategy);
      try {
        if (!pair || !(price > 0) || liq < RUG_LIQ) {
          const missing = p.missing + 1;
          if (missing >= RUG_SAMPLES) close(p, 0, 0, "rug", now);
          else upd.run(p.peak_price, p.peak_at, p.last_price, p.last_liq, now, missing, p.id);
          continue;
        }
        if (price > p.last_price * MAX_JUMP) continue;
        if (price > p.peak_price) Object.assign(p, { peak_price: price, peak_at: now });
        if (price < (p.low_price ?? p.entry_price)) {
          Object.assign(p, { low_price: price, low_at: now });
          d.prepare("UPDATE paper_positions SET low_price = ?, low_at = ? WHERE id = ?").run(price, now, p.id);
        }
        const pp = strat?.exits.partial;
        if (pp && !p.partial_at && ((price - p.entry_price) / p.entry_price) * 100 >= pp.atPct) takePartial(p, pp.sellPct, price, liq, now);
        const reason = exitFor(p, strat, price, now);
        if (reason) close(p, price, liq, reason, now);
        else upd.run(p.peak_price, p.peak_at, price, liq, now, 0, p.id);
      } catch (e) {
        console.warn("[paper] position", p.id, (e as Error).message);
      }
    }
    // Входы после открытых позиций: только что купленное замеряется уже со следующего тика.
    for (const q of pending) {
      const key = `${q.chain}:${q.token}`;
      try {
        resolvePending(q, byId.get(q.strategy), prices.has(key) ? prices.get(key) : undefined, now);
      } catch (e) {
        console.warn("[paper] pending", q.id, (e as Error).message);
      }
    }
    if (!fastOnly) s.lastTick = now;
    cache = null;
    return open.length;
  } finally {
    s.busy = false;
  }
}

export function startPaperEngine() {
  const s = st();
  if (s.started || !paperEnabled()) return;
  const d = db();
  if (!d) {
    console.warn("[paper] engine off: SQLite unavailable");
    return;
  }
  s.started = true;
  const m = memDb()!;
  if (!kvGet(m, "paper_engine_started")) kvSet(m, "paper_engine_started", String(Date.now()));
  const n = (d.prepare("SELECT COUNT(*) AS n FROM paper_positions").get() as { n: number }).n;
  const w = (d.prepare("SELECT COUNT(*) AS n FROM paper_pending").get() as { n: number }).n;
  // Один таймер на оба тика: два setInterval совпадают по фазе, и занятый быстрый тик съедал бы минутный.
  // Полный тик раз в SAMPLE_MS, между ними быстрые; полный, попавший на занятый движок, переносится на следующий шаг.
  const every = SAMPLE_MS / FAST_MS;
  const fast = STRATEGIES.some((x) => x.enabled && x.fast);
  let step = 0;
  let fullDue = true;
  setInterval(() => {
    if (++step % every === 0) fullDue = true;
    if (st().busy) return;
    const full = fullDue;
    if (!full && !fast) return;
    fullDue = false;
    paperTick(!full).catch((e) => console.warn(full ? "[paper]" : "[paper] fast", (e as Error).message));
  }, FAST_MS);
  console.log(`[paper] engine started, ${STRATEGIES.filter((x) => x.enabled).length} strategies, ${n} open positions and ${w} pending entries resumed`);
}

// ---------- статистика для страницы ----------

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r1 = (n: number) => Math.round(n * 10) / 10;

// Нереализованный итог открытой позиции: как если бы продали по последнему замеру прямо сейчас.
const markPnl = (p: PosRow) => (p.banked ?? 0) + p.units * p.last_price * Math.max(0, 1 - slip(p.size, p.last_liq) - extraSlip(p.strategy)) * (1 - FEE) - p.size;

function compute() {
  const d = db();
  const now = Date.now();
  const base = { enabled: paperEnabled(), startedAt: startedAt(), lastTick: st().lastTick || null, fee: FEE, maxOpen: MAX_OPEN, sampleSec: SAMPLE_MS / 1000, updatedAt: now };
  if (!d) return { ...base, strategies: [], open: [], trades: [] };
  const trades = d.prepare("SELECT * FROM paper_trades ORDER BY exit_at").all() as unknown as TradeRow[];
  const open = d.prepare("SELECT * FROM paper_positions ORDER BY entry_at DESC").all() as unknown as PosRow[];
  const pendingN = new Map(
    (d.prepare("SELECT strategy, COUNT(*) AS n FROM paper_pending GROUP BY strategy").all() as unknown as { strategy: string; n: number }[]).map((x) => [x.strategy, x.n]),
  );
  const skipRows = d.prepare("SELECT strategy, reason, COUNT(*) AS n FROM paper_skips GROUP BY strategy, reason").all() as unknown as { strategy: string; reason: SkipReason; n: number }[];
  const ids = [...new Set([...STRATEGIES.map((s) => s.id), ...trades.map((t) => t.strategy)])];
  const strategies = ids.map((id) => {
    const cfg = STRATEGIES.find((s) => s.id === id);
    const ts = trades.filter((t) => t.strategy === id);
    const op = open.filter((p) => p.strategy === id);
    const rets = ts.map((t) => t.net_pct);
    const wins = ts.filter((t) => t.pnl > 0);
    const gain = wins.reduce((a, t) => a + t.pnl, 0);
    const loss = -ts.filter((t) => t.pnl < 0).reduce((a, t) => a + t.pnl, 0);
    // Кривая и просадка по реализованному P&L в порядке закрытия.
    let eq = 0;
    let peak = 0;
    let dd = 0;
    const curve: [number, number][] = [];
    for (const t of ts) {
      eq += t.pnl;
      peak = Math.max(peak, eq);
      dd = Math.max(dd, peak - eq);
      curve.push([t.exit_at, r2(eq)]);
    }
    const step = Math.ceil(curve.length / 200) || 1;
    const reasons: Partial<Record<ExitReason, number>> = {};
    for (const t of ts) reasons[t.reason] = (reasons[t.reason] ?? 0) + 1;
    // Устойчивость: на мемах итог часто делает одна монета. Итог без лучшей и без двух лучших сделок, доля лучшей
    // сделки в прибыли и 95% интервал среднего показывают, преимущество это или везение.
    const byPnl = ts.map((t) => t.pnl).sort((a, b) => b - a);
    const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
    const sd = rets.length > 1 ? Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1)) : 0;
    const half = rets.length >= 5 ? (1.96 * sd) / Math.sqrt(rets.length) : null;
    return {
      id,
      label: cfg?.label ?? id,
      note: cfg?.note ?? "Removed strategy, old trades kept",
      enabled: !!cfg?.enabled,
      entry: cfg?.entry ?? null,
      exits: cfg?.exits ?? null,
      sizeUsd: cfg?.sizeUsd ?? 100,
      trades: ts.length,
      open: op.length,
      delayMin: cfg?.entry.delayMin ?? null,
      pending: pendingN.get(id) ?? 0,
      // Сколько сигналов подтверждение отсеяло, по причинам (liq: пул вытащили, drop: упала, ran: убежала вверх).
      skipped: Object.fromEntries(skipRows.filter((x) => x.strategy === id).map((x) => [x.reason, x.n])) as Partial<Record<SkipReason, number>>,
      wins: wins.length,
      winRate: ts.length ? r1((wins.length / ts.length) * 100) : null,
      pnl: r2(eq),
      openPnl: r2(op.reduce((a, p) => a + markPnl(p), 0)),
      invested: r2(ts.reduce((a, t) => a + t.size, 0)),
      avgRet: rets.length ? r1(rets.reduce((a, b) => a + b, 0) / rets.length) : null,
      medianRet: rets.length ? r1(median(rets)!) : null,
      profitFactor: loss > 0 ? Math.round((gain / loss) * 100) / 100 : null, // null: убыточных сделок нет (или сделок нет)
      maxDrawdown: r2(dd),
      avgHoldMin: ts.length ? Math.round(ts.reduce((a, t) => a + (t.exit_at - t.entry_at), 0) / ts.length / 60_000) : null,
      reasons,
      partials: ts.filter((t) => (t as TradeRow & { partial_at?: number | null }).partial_at).length,
      pnlExBest: ts.length >= 2 ? r2(eq - byPnl[0]) : null,
      pnlExTop2: ts.length >= 3 ? r2(eq - byPnl[0] - byPnl[1]) : null,
      bestShare: gain > 0 && byPnl[0] > 0 ? r1((byPnl[0] / gain) * 100) : null,
      avgRetLo: half == null ? null : r1(mean - half),
      avgRetHi: half == null ? null : r1(mean + half),
      curve: curve.filter((_, i) => i % step === 0 || i === curve.length - 1),
    };
  });
  return {
    ...base,
    strategies,
    open: open.map((p) => ({
      id: p.id,
      strategy: p.strategy,
      token: p.token,
      chain: p.chain,
      symbol: p.symbol,
      verdict: p.verdict,
      score: p.score,
      entryAt: p.entry_at,
      entryPrice: p.entry_price,
      lastPrice: p.last_price,
      lastAt: p.last_at,
      liq: Math.round(p.last_liq),
      retPct: r1(((p.last_price - p.entry_price) / p.entry_price) * 100),
      peakPct: r1(((p.peak_price - p.entry_price) / p.entry_price) * 100),
      pnl: r2(markPnl(p)),
      missing: p.missing,
      closesAt: p.entry_at + (STRATEGIES.find((s) => s.id === p.strategy)?.exits.maxHoldMin ?? 0) * 60_000,
    })),
    trades: trades.slice(-100).reverse().map((t) => ({
      id: t.id,
      strategy: t.strategy,
      token: t.token,
      chain: t.chain,
      symbol: t.symbol,
      verdict: t.verdict,
      score: t.score,
      entryAt: t.entry_at,
      exitAt: t.exit_at,
      grossPct: t.gross_pct,
      netPct: t.net_pct,
      peakPct: t.peak_pct,
      pnl: t.pnl,
      reason: t.reason,
    })),
  };
}

export type PaperEngineData = ReturnType<typeof compute>;

let cache: { at: number; data: PaperEngineData } | null = null;
export function paperEngineStats(): PaperEngineData {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  cache = { at: Date.now(), data: compute() };
  return cache.data;
}

// Полный экспорт для разбора: каждая сделка с признаками входа и исходом, плюс открытые позиции и конфиги.
export function paperExport(since = 0) {
  const d = db();
  const parse = (s: string) => {
    try {
      return JSON.parse(s) as Features;
    } catch {
      return null;
    }
  };
  if (!d) return { enabled: paperEnabled(), startedAt: null, strategies: STRATEGIES, trades: [], open: [], pending: [], skips: [] };
  const trades = d.prepare("SELECT * FROM paper_trades WHERE exit_at >= ? ORDER BY exit_at").all(since) as unknown as TradeRow[];
  const open = d.prepare("SELECT * FROM paper_positions ORDER BY entry_at").all() as unknown as PosRow[];
  const pending = d.prepare("SELECT * FROM paper_pending ORDER BY signal_at").all() as unknown as PendingRow[];
  const skips = d.prepare("SELECT * FROM paper_skips WHERE at >= ? ORDER BY at").all(since) as unknown as Record<string, unknown>[];
  return {
    enabled: paperEnabled(),
    startedAt: startedAt(),
    exportedAt: Date.now(),
    costs: { feePerSide: FEE, slippage: "size / liquidity, capped", slipCap: SLIP_CAP, rugLiqUsd: RUG_LIQ, rugSamples: RUG_SAMPLES },
    strategies: STRATEGIES,
    trades: trades.map(({ features, ...t }) => ({ ...t, holdMin: Math.round((t.exit_at - t.entry_at) / 60_000), features: parse(features) })),
    open: open.map(({ features, ...p }) => ({ ...p, features: parse(features) })),
    pending: pending.map(({ features, ...q }) => ({ ...q, features: parse(features) })),
    skips,
  };
}
