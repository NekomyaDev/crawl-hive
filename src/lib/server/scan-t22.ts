// Contract X-Ray для Solana: большинство мемкоинов — обычные SPL-токены, у них проверять нечего, кроме
// mint/freeze authority (это уже делает crawler_holders). У минтов Token-2022 бывают расширения, которыми
// эмитент может навредить держателям: вечный делегат, хук на каждый перевод, налог, заморозка, пауза.
// Читаем сырой аккаунт минта одним запросом и разбираем расширения локально через @solana/spl-token.
import "server-only";
import { PublicKey, type Connection } from "@solana/web3.js";
import {
  AccountState,
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getDefaultAccountState,
  getExtensionTypes,
  getInterestBearingMintConfigState,
  getMintCloseAuthority,
  getNonTransferable,
  getPausableConfig,
  getPermanentDelegate,
  getScaledUiAmountConfig,
  getTransferFeeConfig,
  getTransferHook,
  unpackMint,
} from "@solana/spl-token";

export interface T22Ext {
  key: string;
  label: string;
  note: string;
  severity: "high" | "medium" | "low";
  detail?: string;
}
export interface T22Report {
  program: "spl" | "token2022";
  extensions: T22Ext[];
}

const CACHE_MS = 30 * 60_000;
const CACHE_MAX = 2_000;

const g = globalThis as unknown as { __crawlhiveT22?: Map<string, { at: number; report: T22Report }> };
const cache = () => (g.__crawlhiveT22 ??= new Map());

// В Token-2022 «нет authority» хранится как нулевой ключ, а не null.
const isSet = (k: PublicKey | null | undefined): k is PublicKey => !!k && !k.equals(PublicKey.default);
const short = (k: PublicKey) => {
  const s = k.toBase58();
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
};
const pctOf = (bps: number) => `${+(bps / 100).toFixed(2)}%`;

function inspect(mintPk: PublicKey, info: Parameters<typeof unpackMint>[1]): T22Ext[] {
  const mint = unpackMint(mintPk, info, TOKEN_2022_PROGRAM_ID);
  const types = new Set(getExtensionTypes(mint.tlvData));
  const out: T22Ext[] = [];

  const pd = getPermanentDelegate(mint);
  if (isSet(pd?.delegate)) {
    out.push({ key: "permanentDelegate", label: "Permanent delegate", note: "one wallet can move or burn tokens from ANY holder at any time", severity: "high", detail: short(pd.delegate) });
  }

  const hook = getTransferHook(mint);
  if (isSet(hook?.programId)) {
    // Без authority программу хука сменить нельзя, но сама программа может быть обновляемой — опасность остаётся.
    const fixed = !isSet(hook.authority);
    out.push({
      key: "transferHook",
      label: "Transfer hook",
      note: `every transfer runs the team's own program, which can block sells${fixed ? " (hook program is fixed, but its code may still be upgradable)" : ""}`,
      severity: "high",
      detail: hook.programId.toBase58(),
    });
  } else if (hook && isSet(hook.authority)) {
    // Хук пока пустой, но authority может в любой момент подключить свою программу (так устроен PYUSD).
    out.push({
      key: "transferHookDormant",
      label: "Transfer hook can be switched on",
      note: "no hook program now, but the authority can attach one that blocks transfers",
      severity: "medium",
      detail: `hook authority ${short(hook.authority)}`,
    });
  }

  const fee = getTransferFeeConfig(mint);
  if (fee) {
    // newer — ставка, которая действует сейчас или вступит со своей эпохи; older к этому моменту уходит в прошлое.
    const bps = Math.max(fee.newerTransferFee.transferFeeBasisPoints, 0);
    const canChange = isSet(fee.transferFeeConfigAuthority);
    if (bps > 0 || canChange) {
      out.push({
        key: "transferFee",
        label: bps > 0 ? `Transfer tax ${pctOf(bps)}` : "Transfer tax (0% now)",
        note:
          bps > 0
            ? `every transfer pays ${pctOf(bps)} to the issuer${canChange ? "; the authority can change the fee" : "; the fee is locked"}`
            : "no fee right now, but the authority can switch one on",
        severity: bps > 500 ? "high" : bps > 0 ? "medium" : "low",
        detail: canChange ? `fee authority ${short(fee.transferFeeConfigAuthority)}` : undefined,
      });
    }
  }

  const das = getDefaultAccountState(mint);
  if (das?.state === AccountState.Frozen) {
    out.push({ key: "defaultFrozen", label: "New wallets start frozen", note: "buyers can't sell until the team unfreezes their wallet", severity: "high" });
  }

  const pause = getPausableConfig(mint);
  if (pause && isSet(pause.authority)) {
    out.push({
      key: "pausable",
      label: "Can pause all transfers",
      note: "one key can stop every transfer, buy and sell at once",
      severity: "high",
      detail: `${pause.paused ? "PAUSED right now · " : ""}authority ${short(pause.authority)}`,
    });
  }

  if (getNonTransferable(mint) || types.has(ExtensionType.NonTransferable)) {
    out.push({ key: "nonTransferable", label: "Can't be transferred", note: "soulbound token: holders can't send or sell it", severity: "high" });
  }

  if (types.has(ExtensionType.ConfidentialTransferMint)) {
    out.push({ key: "confidentialTransfer", label: "Confidential transfers", note: "balances and transfer amounts can be hidden, so holder data may be incomplete", severity: "medium" });
  }

  const close = getMintCloseAuthority(mint);
  if (isSet(close?.closeAuthority)) {
    out.push({ key: "mintCloseAuthority", label: "Mint can be closed", note: "the mint account can be closed once supply hits zero", severity: "low", detail: short(close.closeAuthority) });
  }

  if (getInterestBearingMintConfigState(mint) || getScaledUiAmountConfig(mint)) {
    out.push({ key: "uiAmount", label: "Displayed balance can change", note: "wallets show a scaled or interest-adjusted balance, not the raw amount", severity: "low" });
  }

  // metadata pointer / metadata / group — безвредны, их не показываем.
  return out;
}

// undefined — минт не прочитать или это не токен-программа; ошибки не бросаем, скан идёт без этой секции.
export async function xraySolana(conn: Connection, mint: string): Promise<T22Report | undefined> {
  const hit = cache().get(mint);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.report;
  try {
    const mintPk = new PublicKey(mint);
    const info = await conn.getAccountInfo(mintPk);
    if (!info) return undefined;
    let report: T22Report;
    if (info.owner.equals(TOKEN_PROGRAM_ID)) report = { program: "spl", extensions: [] };
    else if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) report = { program: "token2022", extensions: inspect(mintPk, info) };
    else return undefined;
    const c = cache();
    // Map хранит порядок вставки: при переполнении выкидываем самые старые записи.
    if (c.size >= CACHE_MAX) for (const k of [...c.keys()].slice(0, c.size - CACHE_MAX + 1)) c.delete(k);
    c.set(mint, { at: Date.now(), report });
    return report;
  } catch {
    return undefined;
  }
}

// Факторы для оценки риска; low-находки на оценку не влияют.
export function t22Factors(r: T22Report): { label: string; impact: number; note: string }[] {
  const out: { label: string; impact: number; note: string }[] = [];
  for (const e of r.extensions) {
    let impact = 0;
    if (e.key === "permanentDelegate") impact = -35;
    else if (e.key === "transferHook") impact = -25;
    else if (e.key === "defaultFrozen") impact = -30;
    else if (e.key === "pausable") impact = -25;
    else if (e.key === "nonTransferable") impact = -40;
    else if (e.key === "confidentialTransfer") impact = -8;
    else if (e.key === "transferFee") {
      const m = /([\d.]+)%/.exec(e.label);
      const bps = m ? Number(m[1]) * 100 : 0;
      if (bps > 0) impact = -Math.round(Math.min(30, (bps / 100) * 3));
    }
    if (impact) out.push({ label: e.label, impact, note: e.note });
  }
  return out;
}
