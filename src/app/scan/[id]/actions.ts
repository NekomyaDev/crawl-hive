"use server";
// Полный разбор скана для страницы /scan/<адрес>. Страница рендерится на сервере без кошелька, поэтому глубокие
// секции не попадают в её HTML: клиент просит их здесь со своим токеном сессии, тариф проверяется на сервере
// (tierOf, порог DEEP_SCAN_TIER из tiers.ts). Ниже тарифа данных нет, только тариф для заглушки.
import { sessionWallet } from "@/lib/server/auth";
import { savedScan, type ScanResult } from "@/lib/server/scan";
import { V2 } from "@/lib/server/score-v2";
import { launchOf, memDb } from "@/lib/server/memory-db";
import { DEEP_SCAN_TIER, tierAtLeast, tierOf, type Tier } from "@/lib/server/tiers";
import { VERDICT_LABEL } from "@/lib/scan-share";
import { lookV3, type SecondLookData } from "@/lib/second-look";
import type { FactorLine } from "@/components/scan-factors";

export interface DeepScan {
  chain: string;
  secondLook?: SecondLookData;
  since?: ScanResult["since"];
  lines: FactorLine[] | null;
  factors: ScanResult["factors"];
  dump?: ScanResult["dump"];
  launch?: ScanResult["launch"];
  operators?: ScanResult["operators"];
  firstBuyers?: ScanResult["firstBuyers"];
}

export async function deepScan(id: string, token: string): Promise<{ tier: Tier; deep: DeepScan | null }> {
  if (typeof id !== "string" || typeof token !== "string" || id.length > 128 || token.length > 2048) return { tier: "free", deep: null };
  // sessionWallet читает заголовок запроса: собираем его из присланного токена.
  const wallet = token ? sessionWallet(new Request("http://local/", { headers: { authorization: `Bearer ${token}` } })) : null;
  const { tier } = await tierOf(wallet);
  if (!tierAtLeast(tier, DEEP_SCAN_TIER)) return { tier, deep: null };
  const r = savedScan(id);
  if (!r) return { tier, deep: null };
  // Доказательства запуска свежими из базы: настоящего создателя фоновый поиск может найти уже после скана.
  const db = memDb();
  const fresh = db ? launchOf(db, r.chain === "solana" ? r.id : r.id.toLowerCase()) : null;
  const launch = fresh
    ? { ...r.launch, deployer: fresh.deployer ?? r.launch?.deployer, factory: r.launch?.factory ?? fresh.factory ?? undefined, poolCreator: fresh.poolCreator ?? r.launch?.poolCreator, tx: fresh.tx ?? r.launch?.tx, launchedAt: fresh.launchedAt ?? r.launch?.launchedAt, seenAt: fresh.seenAt }
    : r.launch;
  return {
    tier,
    deep: {
      chain: r.chain,
      secondLook: lookV3(r.v3),
      since: r.since,
      lines: v2Lines(r),
      factors: r.factors,
      dump: r.dump,
      launch: launch as ScanResult["launch"],
      operators: r.operators,
      firstBuyers: r.firstBuyers,
    },
  };
}

// С 22.10 публичный балл считает v2: строки списка - её правила, и их сумма равна показанному баллу.
// Флаги краулеров (v1) идут ниже со знаком «!»: в v2 они входят одним правилом «балл краулеров», свои очки v1
// видны в подсказке. Скан без v2 (базовый актив, старый скан) показываем по-старому.
const cap1 = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function v2Lines(r: ScanResult): FactorLine[] | null {
  if (!r.v1 || !r.v2 || r.score === null) return null;
  const out: FactorLine[] = [{ key: "base", impact: V2.base, label: "Starting score", note: "every coin starts here, the rules below move it" }];
  let raw: number = V2.base;
  let cap: string | undefined;
  for (const x of r.v2.reasonsV2) {
    if (x.startsWith("capped")) {
      cap = x.replace(/^capped at \d+: /, "");
      continue;
    }
    const m = x.match(/^([+-]?\d+) (.*)$/);
    if (!m) continue;
    const pts = Number(m[1]);
    raw += pts;
    const v1 = m[2].match(/^v1 score (\d+)$/);
    const dumped = m[2].match(/^(\d+) wallets were on tokens that dumped$/);
    out.push(
      v1
        ? { key: x, impact: pts, label: `Crawler checks: ${v1[1]}/100`, note: pts > 0 ? "80 or more, few red flags below" : "under 60, see the red flags below" }
        : dumped
          ? { key: x, impact: pts, label: "Wallets from dumped coins", note: `${dumped[1]} wallets here were on earlier coins that dumped` }
          : { key: x, impact: pts, label: cap1(m[2]), note: "" },
    );
  }
  // Сумма правил обрезается в 0-100, потом потолок по жёсткому флагу, потом жёсткие правила v1 могут держать вердикт ниже.
  const clamped = Math.max(0, Math.min(100, raw));
  if (clamped !== raw) out.push({ key: "clamp", impact: clamped - raw, label: clamped === 0 ? "Floor at 0" : "Ceiling at 100", note: "the score stays between 0 and 100" });
  if (cap && r.v2.scoreV2 < clamped) out.push({ key: "cap", impact: r.v2.scoreV2 - clamped, label: `Capped at ${r.v2.scoreV2}`, note: `${cap}: a coin with this flag can't score above RISKY` });
  if (r.score !== r.v2.scoreV2) out.push({ key: "hard", impact: r.score - r.v2.scoreV2, label: `Held at ${VERDICT_LABEL[r.verdict]}`, note: "a hard red flag below keeps the verdict this low" });
  const ruled = new Set(out.map((l) => l.label));
  for (const f of r.factors)
    if (!ruled.has(f.label))
      out.push({ key: `f:${f.label}`, impact: null, label: f.label, note: f.note, v1: f.impact, hint: f.impact ? `Old score (v1): ${f.impact > 0 ? `+${f.impact}` : f.impact}` : undefined });
  return out;
}
