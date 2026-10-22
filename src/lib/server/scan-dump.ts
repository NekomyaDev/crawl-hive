// «Probable dump»: насколько упала бы цена, если бы подозрительные кошельки продали всё, что держат сейчас, в текущую
// ликвидность. Подозрительные: снайперы, кошельки операторов и бандлов (связанные группы), создатель и свежие кошельки.
// Каждый кошелёк считаем один раз; пулы, кривые, локеры и сожжённое сюда не попадают (их отсекают сами краулеры:
// на Solana это адреса программ, на EVM контракты). Оценка, а не прогноз: на балл и вердикт не влияет.
//
// Модель: пул с постоянным произведением x*y=k. Продажа dX токенов при резерве токена X даёт цену
// (X/(X+dX))^2 от текущей. В долларах: резерв котируемой стороны L = ликвидность/2 (DexScreener считает обе
// стороны), продажа стоит V = доля * FDV по текущей цене, и X*P = L, поэтому падение 1 - (L/(L+V))^2.
// Кривая pump.fun устроена так же (виртуальные резервы x*y=k): там берём виртуальный резерв токена прямо из
// аккаунта кривой. Остальные кривые без пула (Meteora DBC, LaunchLab, four.meme...) резервов не отдают: оценки нет.
import "server-only";
import { PublicKey, type Connection } from "@solana/web3.js";
import type { BundleReport } from "./scan-bundles";
import type { DevReport } from "./scan-dev";
import type { OperatorReport } from "./scan-operators";
import type { SniperReport } from "./scan-snipers";

export interface DumpProjection {
  pct: number; // падение цены, 0-99
  suspiciousPct: number; // сколько эмиссии у подозрительных кошельков сейчас
  basis: "pool" | "curve"; // по ликвидности пула или по резервам кривой pump.fun
  venue?: string; // лаунчпад или dexId, для подписи
  liquidityUsd?: number; // котируемая сторона пула, которой встречаем продажу (только basis=pool)
  sellUsd?: number; // сколько стоит подозрительная доля по текущей цене
  breakdown: { label: string; wallets: number; pct: number }[];
  meaningful: boolean; // доля не меньше DUMP_MIN_PCT: только тогда блок показывается
}

export const DUMP_MIN_PCT = 5;
const PUMP = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const BURN = new Set(["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead", "0xdead000000000000000042069420694206942069", "1nc1nerator11111111111111111111111111111111"]);
const norm = (a: string) => (a.startsWith("0x") ? a.toLowerCase() : a);

// Виртуальные резервы кривой pump.fun: 8 байт дискриминатора, затем virtualTokenReserves и virtualSolReserves (u64),
// флаг complete на 48-м байте. Кривая закрыта (токен ушёл в пул): резервы не нужны.
export async function pumpCurve(conn: Connection, mint: string): Promise<{ tokenRaw: number } | null> {
  const [curve] = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()], PUMP);
  const acc = await conn.getAccountInfo(curve);
  if (!acc || !acc.owner.equals(PUMP) || acc.data.length < 49 || acc.data[48] === 1) return null;
  const tokenRaw = Number(acc.data.readBigUInt64LE(8));
  return tokenRaw > 0 ? { tokenRaw } : null;
}

type Cat = "dev" | "linked" | "sniper" | "fresh";
const LABEL: Record<Cat, string> = { dev: "Creator", linked: "Linked wallets (operators, bundles)", sniper: "Snipers (first-block buyers)", fresh: "Fresh wallets (under 3 days)" };

export function probableDump(x: {
  snipers?: SniperReport;
  bundles?: BundleReport;
  operators?: OperatorReport;
  dev?: DevReport;
  creator?: string; // создатель из доказательств запуска (EVM), если нет отчёта dev
  pair?: string;
  liquidityUsd?: number;
  fdv?: number;
  onCurve: boolean;
  venue?: string;
  curve?: { tokenRaw: number } | null;
  supplyRaw?: number;
}): DumpProjection | undefined {
  // Кошелёк -> (доля, категория); первая категория по важности побеждает: создатель, связанные, снайпер, свежий.
  const seen = new Map<string, { pct: number; cat: Cat }>();
  const skip = new Set([...BURN, ...(x.pair ? [norm(x.pair)] : [])]);
  const add = (w: string, pct: number, cat: Cat) => {
    const k = norm(w);
    if (!(pct > 0) || skip.has(k) || seen.has(k)) return;
    seen.set(k, { pct, cat });
  };
  const creator = x.dev?.creator ?? x.creator;
  if (x.dev?.holdsPct) add(x.dev.creator, x.dev.holdsPct, "dev");
  const nodes = x.operators?.map?.nodes ?? [];
  // На EVM доля создателя есть только на карте (он среди топ-держателей).
  for (const n of nodes) if (creator && norm(n.w) === norm(creator)) add(n.w, n.pct, "dev");
  // Связанные: кошельки внутри операторов (группы из 2+ или связанные с создателем) на бабл-карте.
  for (const n of nodes) if (!n.hub && n.g >= 0) add(n.w, n.pct, "linked");
  // Карты нет (мало узлов), а бандл есть: берём держателей с общим спонсором из ссылок бандла.
  if (!nodes.length && x.bundles?.clusters.length) {
    const funders = new Set(x.bundles.clusters.map((c) => c.funder));
    const byWallet = new Map((x.bundles.wallets ?? []).map((w) => [w.wallet, w.pct]));
    for (const l of x.bundles.links ?? []) if (funders.has(l.funder)) add(l.wallet, byWallet.get(l.wallet) ?? l.pct, "linked");
  }
  for (const b of x.snipers?.buyers ?? []) add(b.wallet, b.leftPct, "sniper");
  const freshPct = new Map((x.bundles?.wallets ?? []).map((w) => [w.wallet, w.pct]));
  for (const w of x.bundles?.freshWallets ?? []) add(w, freshPct.get(w) ?? 0, "fresh");
  if (!seen.size) return undefined;

  const total = Math.min(100, [...seen.values()].reduce((a, v) => a + v.pct, 0));
  const breakdown = (["dev", "linked", "sniper", "fresh"] as Cat[])
    .map((cat) => {
      const ws = [...seen.values()].filter((v) => v.cat === cat);
      return { label: LABEL[cat], wallets: ws.length, pct: Math.round(ws.reduce((a, v) => a + v.pct, 0) * 100) / 100 };
    })
    .filter((b) => b.wallets > 0 && b.pct > 0);
  const share = total / 100;
  let drop: number | undefined;
  let basis: DumpProjection["basis"] = "pool";
  let liquidityUsd: number | undefined;
  if (x.onCurve) {
    // Кривая pump.fun: продажа dX токенов в виртуальный резерв X.
    if (!x.curve || !x.supplyRaw) return undefined;
    const dX = share * x.supplyRaw;
    drop = 1 - (x.curve.tokenRaw / (x.curve.tokenRaw + dX)) ** 2;
    basis = "curve";
  } else {
    if (!x.liquidityUsd || !x.fdv) return undefined;
    liquidityUsd = x.liquidityUsd / 2;
    const v = share * x.fdv;
    drop = 1 - (liquidityUsd / (liquidityUsd + v)) ** 2;
  }
  const sellUsd = x.fdv ? Math.round(share * x.fdv) : undefined;
  return {
    pct: Math.max(0, Math.min(99, Math.round(drop * 100))),
    suspiciousPct: Math.round(total * 100) / 100,
    basis,
    ...(x.venue ? { venue: x.venue } : {}),
    ...(liquidityUsd !== undefined ? { liquidityUsd: Math.round(liquidityUsd) } : {}),
    ...(sellUsd !== undefined ? { sellUsd } : {}),
    breakdown,
    meaningful: total >= DUMP_MIN_PCT,
  };
}
