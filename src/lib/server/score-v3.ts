// Теневая оценка v3: гипотеза для проверки вперёд, на публичный вердикт не влияет (показывается как «Second look»).
// Подход другой, чем у v2: от v2 берём только рыночную основу (место запуска, пул, возраст), а балл v1 и память
// кошельков заменяем живыми ончейн-сигналами, которые v2 не смотрит: кто держит LP, сколько у дева, снайперов,
// бандлов и топ-10, давление продаж, оборот к пулу, соцсети, доля связанного «оператора» с бабл-карты.
// Бэктеста почти нет: большинство этих полей пишется в скан только с 20-21.10, в Track Record их нет совсем.
// Поэтому правила простые, аддитивные и с круглыми очками; судить v3 будем по таблице /api/track/compare.
// Нет данных по сигналу - 0 очков (неизвестное не штрафуем и не награждаем).
//
// Очки (база 60 + рыночная часть v2):
//   LP:        можно вынуть -25 · не залочена -15 · анлок за 7 дней -10 · сожжена или залочена (в т.ч. Pons) +10
//   Дев:       держит > 10% -15 · 5-10% -5
//   Снайперы:  держат >= 15% -15 · 5-15% -5
//   Бандл:     кластер >= 10% или 5+ кошельков -15 · >= 4% или 3+ кошельков -5
//   Топ-10:    Solana: следующие 10 после крупнейшего > 50% -15 · > 30% -5; EVM: топ-10 с пулом > 90% -10
//   Покупки/продажи за 1 ч (от 20 сделок): продаж вдвое больше -10 · покупок в 1.5 раза больше +5
//   Оборот 1 ч к пулу (пул от $5k): >= 50% +5 · < 2% -5
//   Соцсети:   нет ни одной -5 · 2 и больше +3
//   Оператор:  группа 2+ кошельков держит >= 30% -15 · >= 15% -10 · снайперы от создателя -10
//   Кошельки с рухнувших токенов: 5+ -15 · 3-4 -10
//   Потолки:   жёсткий флаг (honeypot, минт, заморозка, опасный байткод) 45; LP можно вынуть 54 (не выше RISKY)
//   Пороги те же, что у v2: CLEAN >= 70, OK >= 55, RISKY >= 40, иначе DANGER.
import "server-only";
import { hardFlag, V2, v2Market, verdictOf, type VerdictV2 } from "./score-v2";
import type { ScanResult } from "./scan";

export interface ScoreV3 {
  scoreV3: number;
  verdictV3: VerdictV2;
  reasonsV3: string[];
}

// Поменяли очки заметно - это уже v4: старые записи Track Record считались по этим числам.
export const V3 = {
  base: V2.base,
  lpPull: -25,
  lpUnlocked: -15,
  lpUnlockWeek: -10,
  lpSafe: 10,
  devBig: -15, // > 10%
  devMid: -5, // 5-10%
  snipersBig: -15, // >= 15%
  snipersMid: -5, // 5-15%
  bundleBig: -15,
  bundleMid: -5,
  top10Big: -15, // Solana, следующие 10 > 50%
  top10Mid: -5, // > 30%
  top10Evm: -10, // EVM, топ-10 с пулом > 90%
  sellPressure: -10,
  buyPressure: 5,
  volActive: 5, // оборот за час от 50% пула
  volDead: -5, // меньше 2%
  noSocials: -5,
  socials: 3,
  operatorBig: -15, // >= 30%
  operatorMid: -10, // >= 15%
  devSnipers: -10,
  dumpWalletsBig: -15, // 5+
  dumpWalletsMid: -10, // 3-4
  hardCap: V2.hardCap,
  lpPullCap: 54,
} as const;

export function scoreV3(r: ScanResult): ScoreV3 {
  let s: number = V3.base;
  const reasons: string[] = [];
  const add = (pts: number, why: string) => {
    s += pts;
    reasons.push(`${pts > 0 ? "+" : ""}${pts} ${why}`);
  };
  for (const [pts, why] of v2Market(r)) add(pts, why);
  const pct = (x: number) => `${Math.round(x * 10) / 10}%`;

  // LP: кто может вынуть ликвидность.
  const lp = r.lp;
  const liq = r.market?.liquidityUsd ?? 0;
  if (lp?.pullable) add(V3.lpPull, "a wallet can pull the liquidity");
  else if (lp?.status === "unlocked" && liq >= 5_000) add(V3.lpUnlocked, "liquidity is not locked");
  else if (lp?.unlockAt && lp.unlockAt - Date.now() < 7 * 86_400_000) add(V3.lpUnlockWeek, "locked liquidity unlocks this week");
  else if (lp?.status === "burned" || lp?.status === "locked" || /pons/i.test(lp?.locker ?? "")) add(V3.lpSafe, lp?.status === "burned" ? "liquidity is burned" : `liquidity is locked${lp?.locker ? ` (${lp.locker})` : ""}`);

  const dev = r.dev?.holdsPct;
  if (dev !== undefined && dev > 10) add(V3.devBig, `dev holds ${pct(dev)}`);
  else if (dev !== undefined && dev >= 5) add(V3.devMid, `dev holds ${pct(dev)}`);

  const sn = r.snipers?.holdPct;
  if (sn !== undefined && sn >= 15) add(V3.snipersBig, `snipers still hold ${pct(sn)}`);
  else if (sn !== undefined && sn >= 5) add(V3.snipersMid, `snipers still hold ${pct(sn)}`);

  const cl = r.bundles?.clusters[0];
  if (cl && (cl.pct >= 10 || cl.wallets >= 5)) add(V3.bundleBig, `${cl.wallets} bundled wallets hold ${pct(cl.pct)}`);
  else if (cl && (cl.pct >= 4 || cl.wallets >= 3)) add(V3.bundleMid, `${cl.wallets} linked wallets hold ${pct(cl.pct)}`);

  // Топ-10: у Solana крупнейший держатель обычно пул, поэтому смотрим на следующие десять (top10 - top1).
  if (r.holders) {
    const next = r.holders.top10 - r.holders.top1;
    if (next > 50) add(V3.top10Big, `the next 10 wallets hold ${pct(next)}`);
    else if (next > 30) add(V3.top10Mid, `the next 10 wallets hold ${pct(next)}`);
  } else if ((r.evm?.top10 ?? 0) > 90) add(V3.top10Evm, `the top 10 wallets hold ${pct(r.evm!.top10!)}`);

  const buys = r.market?.buys1h ?? 0;
  const sells = r.market?.sells1h ?? 0;
  if (buys + sells >= 20) {
    if (sells > buys * 2) add(V3.sellPressure, `${sells} sells vs ${buys} buys in the last hour`);
    else if (buys >= sells * 1.5) add(V3.buyPressure, `${buys} buys vs ${sells} sells in the last hour`);
  }

  const vol = r.market?.volume1h;
  if (vol !== undefined && liq >= 5_000) {
    if (vol / liq >= 0.5) add(V3.volActive, "busy trading for its pool size");
    else if (vol / liq < 0.02) add(V3.volDead, "almost no trading for its pool size");
  }

  // Соцсети знаем только при найденной паре.
  if (r.market) {
    if (!r.market.socials) add(V3.noSocials, "no website or socials");
    else if (r.market.socials >= 2) add(V3.socials, `${r.market.socials} links to site and socials`);
  }

  const op = r.operators?.operators.find((o) => o.wallets >= 2);
  if (op && op.pct >= 30) add(V3.operatorBig, `one operator (${op.wallets} wallets) holds ${pct(op.pct)}`);
  else if (op && op.pct >= 15) add(V3.operatorMid, `one operator (${op.wallets} wallets) holds ${pct(op.pct)}`);
  if (r.operators?.devSnipers) add(V3.devSnipers, `${r.operators.devSnipers} snipers linked to the creator`);

  const dw = r.v2?.dumpWallets;
  if (dw != null && dw >= 5) add(V3.dumpWalletsBig, `${dw} wallets were on tokens that dumped`);
  else if (dw != null && dw >= 3) add(V3.dumpWalletsMid, `${dw} wallets were on tokens that dumped`);

  s = Math.max(0, Math.min(100, s));
  const hard = hardFlag(r);
  if (hard && s > V3.hardCap) {
    reasons.push(`capped at ${V3.hardCap}: ${hard.toLowerCase()}`);
    s = V3.hardCap;
  } else if (lp?.pullable && s > V3.lpPullCap) {
    reasons.push(`capped at ${V3.lpPullCap}: liquidity can be pulled`);
    s = V3.lpPullCap;
  }
  return { scoreV3: s, verdictV3: verdictOf(s), reasonsV3: reasons };
}

// Теневая оценка не должна ронять скан: ошибка - просто нет v3.
export function safeScoreV3(r: ScanResult): ScoreV3 | undefined {
  try {
    return scoreV3(r);
  } catch (e) {
    console.warn("[score-v3]", (e as Error).message);
    return undefined;
  }
}
