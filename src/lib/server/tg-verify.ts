// Тариф в Telegram-боте без подключения кошелька и без подписи сообщений.
// /verify <адрес>: бот выдаёт уникальную сумму (0.000NNN SOL), человек переводит её из этого кошелька
// самому себе за 15 минут. Перевод SOL подписывает только владелец кошелька-отправителя, так что найденная
// в сети транзакция с source = адрес и ровно этой суммой доказывает владение. Деньги никуда не уходят,
// тратится только комиссия сети. Бот ничего не подписывает и никогда не спрашивает ключи.
// После проверки кошелёк привязывается к чату обычной связкой tg:<кошелёк> (как «Connect Telegram» на сайте),
// и дальше тариф считает существующая логика chatTier/tierOf по живому балансу: продал токены = тариф упал.
// Ключ tg:<кошелёк> один на кошелёк: новая проверка из другого чата перепривязывает его и отвязывает старый.
import "server-only";
import { randomInt } from "node:crypto";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN } from "@/lib/token";
import { getMeta, metaEntries, setMeta } from "./store";
import { esc, send, siteUrl } from "./telegram";
import type { Tier } from "./tiers";

const TTL_MS = 15 * 60_000;
const MAX_PENDING = 300; // на весь сервер, чтобы опрос RPC не разрастался
const STARTS_PER_HOUR = 5; // /verify с новым адресом на чат
const SIGS_PER_CHECK = 15; // последние подписи адреса за один проход
const KEY = "tgverify";

interface Challenge { chat: string; wallet: string; lamports: number; created: number; exp: number; seen: string[] }

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const solText = (lamports: number) => (lamports / 1e9).toFixed(6);

function pending(): Challenge[] {
  try {
    return JSON.parse(getMeta(KEY) ?? "[]");
  } catch {
    return [];
  }
}
const save = (list: Challenge[]) => setMeta(KEY, list.length ? JSON.stringify(list) : undefined);

const g = globalThis as unknown as { __crawlhiveTgVerify?: { starts: Map<string, number[]>; pokes: Map<string, number>; running: boolean } };
const st = () => (g.__crawlhiveTgVerify ??= { starts: new Map(), pokes: new Map(), running: false });

// Обычный кошелёк Solana: валидный base58 и точка на кривой (у PDA и программных адресов нет ключа, подписать они не могут).
function parseSolWallet(raw: string): string | null {
  const s = raw.trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return null;
  try {
    const pk = new PublicKey(s);
    return PublicKey.isOnCurve(pk.toBytes()) ? pk.toBase58() : null;
  } catch {
    return null;
  }
}

// Что даёт тариф: числа из TIER_LIMITS, а не свои.
async function perks(tier: Tier) {
  const { TIER_LIMITS } = await import("./tiers");
  const l = TIER_LIMITS[tier];
  const scans = l.botScansDay === Infinity ? "Unlimited bot scans" : `${l.botScansDay} bot scans a day`;
  return [
    `• ${scans}`,
    "• Live Launch Radar alerts, no delay (/alerts)",
    `• Wallet watchlist: ${l.watchlist} wallets (/watch)`,
    ...(l.operators ? [`• Operator watch: ${l.operators} operators (/watchop)`] : []),
    `• ${l.brainMult}x Brain API calls`,
  ].join("\n");
}

const TIER_NAME: Record<Tier, string> = { free: "Free", holder: "Holder", pro: "Pro", whale: "Whale" };

export async function tierMessage(wallet: string) {
  const { tierOf } = await import("./tiers");
  const t = await tierOf(wallet).catch(() => null);
  if (!t) return "I could not read the balance right now. Your tier updates by itself, check again with /verify in a minute.";
  if (t.tier === "free") {
    const bal = Math.floor(t.balance ?? 0).toLocaleString("en-US");
    return [
      `This wallet holds ${bal} $${TOKEN.symbol}. Holder needs ${t.need.holder.toLocaleString("en-US")} (about $10), Whale ${t.need.whale.toLocaleString("en-US")} (about $100).`,
      "The link stays: once the balance is there, the tier turns on by itself.",
      `Plans: ${siteUrl()}/pricing`,
    ].join("\n");
  }
  return [`🏅 <b>${TIER_NAME[t.tier]} unlocked</b> in this chat:`, await perks(t.tier), "", "I re-check the balance as you use the bot: if the tokens leave the wallet, the tier drops."].join("\n");
}

const intro = (c: Challenge) =>
  [
    `🔐 <b>Verify wallet</b> <code>${esc(short(c.wallet))}</code>`,
    "",
    `Send exactly <b>${solText(c.lamports)} SOL</b> from this wallet <b>to itself</b> (same address as sender and receiver) within 15 minutes.`,
    "The SOL stays yours, only the network fee (about 0.000005 SOL) is spent. If your wallet will not send to itself, send it to any other address you own.",
    "",
    "I check the chain every 30 seconds and message you here when it lands. /verify shows the status, /verify cancel stops.",
    "",
    "⚠️ I never ask for a seed phrase or private key and never ask you to sign anything. Anyone who does is a scammer.",
  ].join("\n");

// /verify [адрес | cancel] в личке.
export async function handleVerify(chat: string, arg: string) {
  const a = arg.trim();
  const list = pending().filter((c) => c.exp > Date.now());
  const mine = list.find((c) => c.chat === chat);
  if (!a) {
    if (!mine)
      return send(chat, "Send /verify followed by your Solana wallet address, e.g. <code>/verify 7xKX…abcd</code>. No wallet connect, no signing: you prove it is yours with a tiny transfer to yourself, and your $" + TOKEN.symbol + " tier unlocks here.");
    // Ручная проверка не чаще раза в 10 секунд.
    const last = st().pokes.get(chat) ?? 0;
    if (Date.now() - last > 10_000) {
      st().pokes.set(chat, Date.now());
      if (await checkOne(mine)) return;
    }
    if (getMeta(`tg:${mine.wallet}`) === chat && !pending().some((c) => c.chat === chat)) return; // привязал фоновый проход
    return send(chat, `⏳ Still waiting for <b>${solText(mine.lamports)} SOL</b> from <code>${esc(short(mine.wallet))}</code> to itself. ${Math.max(1, Math.ceil((mine.exp - Date.now()) / 60_000))} min left.`);
  }
  if (a.toLowerCase() === "cancel") {
    save(pending().filter((c) => c.chat !== chat));
    return send(chat, mine ? "Verification cancelled." : "Nothing to cancel.");
  }
  if (/seed|private|mnemonic/i.test(a) || a.split(/\s+/).length > 1)
    return send(chat, "Send only the public wallet address, nothing else. Never share a seed phrase or private key with anyone, including me.");
  if (/^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(a) || /^\[[\d,\s]+\]$/.test(a))
    return send(chat, "⚠️ That looks like a private key, not an address. Delete that message, and if anyone else has seen the key, move your funds to a new wallet. I only need the public address.");
  const wallet = parseSolWallet(a);
  if (!wallet) return send(chat, "That is not a Solana wallet address. Send the public address of the wallet that holds your $" + TOKEN.symbol + ".");
  if (getMeta(`tg:${wallet}`) === chat) return send(chat, `<code>${esc(short(wallet))}</code> is already linked here.\n\n${await tierMessage(wallet)}`);
  if (mine?.wallet === wallet) return send(chat, intro(mine));

  const now = Date.now();
  const starts = (st().starts.get(chat) ?? []).filter((t: number) => now - t < 3600_000);
  if (starts.length >= STARTS_PER_HOUR) return send(chat, "Too many verifications this hour. Try again later.");
  const others = list.filter((c) => c.chat !== chat);
  if (others.length >= MAX_PENDING) return send(chat, "A lot of people are verifying right now. Try again in a few minutes.");
  starts.push(now);
  st().starts.set(chat, starts);

  // Сумма уникальна среди открытых проверок этого же адреса: другой чат с тем же адресом получит другую.
  const taken = new Set(others.filter((c) => c.wallet === wallet).map((c) => c.lamports));
  let n = 0;
  for (let i = 0; i < 50 && (!n || taken.has(n * 1000)); i++) {
    n = randomInt(101, 1000);
    if (n % 10 === 0) n = 0; // без хвостового нуля: 0.000430 легко набрать как 0.00043 и ошибиться в сравнении глазами
  }
  if (!n || taken.has(n * 1000)) return send(chat, "Could not make a unique amount, try again.");
  const c: Challenge = { chat, wallet, lamports: n * 1000, created: now, exp: now + TTL_MS, seen: [] };
  save([...pending().filter((x) => x.chat !== chat), c]);
  return send(chat, intro(c));
}

// /unlink [адрес] в личке: без адреса снимает все кошельки этого чата.
export function handleUnlink(chat: string, arg: string) {
  const a = arg.trim();
  const mine = metaEntries("tg:").filter(([k, v]) => v === chat && (!a || k.slice(3) === a));
  for (const [k] of mine) setMeta(k, undefined);
  if (!mine.length) return send(chat, a ? "That wallet is not linked to this chat. /status shows what is." : "No wallet is linked to this chat. Link one with /verify &lt;address&gt;.");
  return send(chat, `Unlinked ${mine.map(([k]) => `<code>${esc(short(k.slice(3)))}</code>`).join(", ")}. Tier perks and crawler signals from ${mine.length > 1 ? "them" : "it"} stop here. /verify to link again.`);
}

// Ищем в последних транзакциях адреса успешный перевод SOL с source = адрес и ровно нужной суммой.
async function findProof(c: Challenge): Promise<string | null> {
  const { rpcConnection } = await import("./solana");
  const conn = rpcConnection();
  const pk = new PublicKey(c.wallet);
  const sigs = await conn.getSignaturesForAddress(pk, { limit: SIGS_PER_CHECK }, "confirmed");
  const fresh = sigs.filter((s) => !s.err && !c.seen.includes(s.signature) && (s.blockTime == null || s.blockTime * 1000 >= c.created - 60_000));
  for (const s of fresh) {
    const tx = await conn.getParsedTransaction(s.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!tx) continue; // ещё не видна, посмотрим в следующий проход
    c.seen = [...c.seen, s.signature].slice(-100);
    if (tx.meta?.err) continue;
    if (tx.blockTime != null && tx.blockTime * 1000 < c.created - 60_000) continue;
    const signed = tx.transaction.message.accountKeys.some((k) => k.signer && k.pubkey.toBase58() === c.wallet);
    if (!signed) continue;
    const ok = tx.transaction.message.instructions.some((ix) => {
      if (!ix.programId.equals(SystemProgram.programId) || !("parsed" in ix)) return false;
      const p = ix.parsed as { type?: string; info?: { source?: string; lamports?: number | string } };
      return p?.type === "transfer" && p.info?.source === c.wallet && Number(p.info?.lamports) === c.lamports;
    });
    if (ok) return s.signature;
  }
  return null;
}

// Проверяет одну проверку; true, если кошелёк привязан.
async function checkOne(c: Challenge): Promise<boolean> {
  let sig: string | null = null;
  try {
    sig = await findProof(c);
  } catch (e) {
    console.warn("[tg-verify]", (e as Error).message);
  }
  // Сохраняем просмотренные подписи, чтобы не тянуть их из RPC снова.
  const list = pending();
  const i = list.findIndex((x) => x.chat === c.chat && x.wallet === c.wallet && x.created === c.created);
  if (i < 0) return false; // отменили, пока ходили в сеть
  if (!sig) {
    list[i] = { ...list[i], seen: c.seen };
    save(list);
    return false;
  }
  list.splice(i, 1);
  save(list);
  (await import("./referrals")).claimFromChat(c.chat, c.wallet); // до привязки: ref_<код> из /start этого чата
  const old = getMeta(`tg:${c.wallet}`);
  if (old && old !== c.chat) send(old, `Wallet <code>${esc(short(c.wallet))}</code> was verified by another Telegram account and is no longer linked here.`);
  setMeta(`tg:${c.wallet}`, c.chat);
  send(c.chat, `✅ <b>Wallet verified</b>: <code>${esc(short(c.wallet))}</code> is linked to this chat.\n\n${await tierMessage(c.wallet)}\n\n/unlink removes it.`);
  return true;
}

// Раз в 30 секунд из startTelegram: открытые проверки по очереди, истёкшие закрываем с сообщением.
export async function checkVerifications() {
  if (st().running || !getMeta(KEY)) return;
  st().running = true;
  try {
    const now = Date.now();
    // Истёкшую проверку смотрим последний раз: перевод мог попасть в сеть перед самым концом окна.
    for (const c of pending()) {
      if (await checkOne(c)) continue;
      if (c.exp > now) continue;
      const left = pending();
      if (!left.some((x) => x.chat === c.chat && x.created === c.created)) continue;
      save(left.filter((x) => !(x.chat === c.chat && x.created === c.created)));
      send(c.chat, `⌛ Verification for <code>${esc(short(c.wallet))}</code> expired, no transfer of ${solText(c.lamports)} SOL was seen. Send /verify &lt;address&gt; for a new amount.`);
    }
  } finally {
    st().running = false;
  }
}
