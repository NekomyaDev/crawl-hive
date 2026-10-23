// Чистая математика и разбор транзакций для оплаты сжиганием $CRAWLHIVE (Pro, Brain, спавн и продление краулера).
// Без серверных зависимостей и без импортов в рантайме: так её можно проверить локальным скриптом прямо через node.
import type { ParsedTransactionWithMeta } from "@solana/web3.js";

export const MEMO_PROGRAM_ADDR = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

// Скидка за оплату спавна и продления сжиганием токена вместо SOL, в процентах.
export const SPAWN_BURN_DISCOUNT_PCT = 20;

// Котировка спавна в токенах: цена тира в SOL → доллары → минус скидка → токены по текущей цене $CRAWLHIVE.
// Токены округляем вверх до целых: человек сжигает не меньше долларовой суммы со скидкой.
export function spawnBurnQuote(p: { sol: number; solUsd: number; tokenUsd: number; discountPct: number; decimals: number }) {
  if (!(p.sol > 0) || !(p.solUsd > 0) || !(p.tokenUsd > 0)) throw new Error("Bad price inputs");
  if (!(p.discountPct >= 0 && p.discountPct < 100)) throw new Error("Bad discount");
  if (!Number.isInteger(p.decimals) || p.decimals < 0 || p.decimals > 12) throw new Error("Bad decimals");
  const usdFull = p.sol * p.solUsd;
  const usd = (usdFull * (100 - p.discountPct)) / 100;
  const tokens = Math.max(1, Math.ceil(usd / p.tokenUsd));
  const raw = BigInt(tokens) * BigInt(10) ** BigInt(p.decimals);
  return { usdFull, usd, tokens, raw };
}

// Что транзакция сожгла от имени кошелька: burn/burnChecked нужного минта нужной программой токена,
// включая вложенные инструкции. signer: подписал ли транзакцию сам кошелёк; failed: упала ли она в сети.
export function scanBurn(tx: ParsedTransactionWithMeta, wallet: string, mintAddr: string, program: string) {
  const failed = !!tx.meta?.err;
  const k = tx.transaction.message.accountKeys.find((x) => x.pubkey.toBase58() === wallet);
  const signer = !!k?.signer;
  const all = [...tx.transaction.message.instructions, ...(tx.meta?.innerInstructions ?? []).flatMap((x) => x.instructions)];
  let raw = BigInt(0);
  for (const ix of all) {
    if (!("parsed" in ix) || ix.programId.toBase58() !== program) continue;
    const p = ix.parsed as { type?: string; info?: { mint?: string; authority?: string; multisigAuthority?: string; amount?: string; tokenAmount?: { amount?: string } } };
    const info = p.info;
    if ((p.type === "burn" || p.type === "burnChecked") && info?.mint === mintAddr && (info.authority ?? info.multisigAuthority) === wallet)
      raw += BigInt(info.tokenAmount?.amount ?? info.amount ?? "0");
  }
  return { failed, signer, raw };
}

// Есть ли в транзакции memo ровно с этим текстом (верхний уровень, программа memo).
export function hasMemo(tx: ParsedTransactionWithMeta, memo: string) {
  return tx.transaction.message.instructions.some((ix) => ix.programId.toBase58() === MEMO_PROGRAM_ADDR && "parsed" in ix && ix.parsed === memo);
}

// Полная проверка сжигания за спавн/продление. Возвращает текст ошибки или сожжённое количество.
// Правила: транзакция успешна; подписана кошельком; есть memo этой котировки; сожжено нужного минта не меньше котировки;
// блок-тайм в окне котировки (после её выдачи и не позже срока плюс минута на доставку).
export function checkSpawnBurn(
  tx: ParsedTransactionWithMeta,
  q: { wallet: string; mint: string; program: string; memo: string; minRaw: bigint; createdAt: number; exp: number },
  now = Date.now(),
): { ok: true; raw: bigint; at: number } | { ok: false; error: string; status: number } {
  const s = scanBurn(tx, q.wallet, q.mint, q.program);
  if (s.failed) return { ok: false, error: "Transaction failed on-chain, nothing was burned", status: 400 };
  if (!s.signer) return { ok: false, error: "Transaction was not signed by your wallet", status: 403 };
  if (!hasMemo(tx, q.memo)) return { ok: false, error: "Transaction is not linked to this quote (memo missing)", status: 400 };
  if (s.raw <= BigInt(0)) return { ok: false, error: "Transaction does not burn $CRAWLHIVE from your wallet", status: 400 };
  if (s.raw < q.minRaw) return { ok: false, error: "Burned less than the quote", status: 400 };
  const at = (tx.blockTime ?? Math.floor(now / 1000)) * 1000;
  if (at < q.createdAt - 60_000) return { ok: false, error: "This burn happened before the quote", status: 400 };
  if (at > q.exp + 60_000) return { ok: false, error: "The quote expired before the burn landed. Start again.", status: 410 };
  return { ok: true, raw: s.raw, at };
}
