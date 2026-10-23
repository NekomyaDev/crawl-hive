// Вход подписью кошелька (упрощённый Sign-In With Solana; для кошельков EVM — personal_sign).
// Кошелёк подписывает сообщение с одноразовым nonce, сервер проверяет ed25519-подпись
// и выдаёт токен сессии (HMAC). Без этого любой мог бы читать чужие приватные сигналы по адресу.
import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519";
import { PublicKey } from "@solana/web3.js";
import { ApiError, getMeta, metaValue, setMeta } from "./store";
import { isEvmAddress, recoverEvmSigner } from "./robinhood";

const NONCE_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 7 * 86400_000;

// purpose: у nonce для подтверждения действия (выдача ключа и т.п.); у nonce входа его нет, и они не взаимозаменяемы.
const g = globalThis as unknown as { __crawlhiveNonces?: Map<string, { address: string; exp: number; issuedAt: string; purpose?: string }> };
const SITE = () => (process.env.PUBLIC_URL?.trim() || "https://crawlhive.xyz").replace(/\/$/, "");
const nonces = () => (g.__crawlhiveNonces ??= new Map());

function secret(): string {
  // Секрет сессий: из env, иначе генерируется один раз и хранится вместе с состоянием.
  return process.env.SESSION_SECRET?.trim() || metaValue("sessionSecret", () => randomBytes(32).toString("hex"));
}

// В сообщении домен и адрес сайта (как в SIWS / EIP-4361): кошелёк и человек видят, куда входят,
// а подпись, выманенная фишинговым сайтом под видом «входа», не подходит к чужому домену.
export function signInMessage(address: string, nonce: string, issuedAt: string) {
  const site = SITE();
  return `${new URL(site).host} wants you to sign in with your wallet:\n${address}\n\nCrawlHive sign-in. This signature only proves you own the wallet. It does not send a transaction or cost anything.\n\nURI: ${site}\nNonce: ${nonce}\nIssued At: ${issuedAt}`;
}

export function issueNonce(address: string) {
  if (!isEvmAddress(address)) new PublicKey(address); // бросит на кривом адресе
  const now = Date.now();
  for (const [k, v] of nonces()) if (v.exp < now) nonces().delete(k);
  const nonce = randomBytes(12).toString("base64url");
  const issuedAt = new Date(now).toISOString();
  nonces().set(nonce, { address, exp: now + NONCE_TTL_MS, issuedAt });
  return { nonce, issuedAt, message: signInMessage(address, nonce, issuedAt) };
}

// Подпись сообщения кошельком: ed25519 для Solana, personal_sign для EVM.
function signatureOk(address: string, text: string, signatureB64: string) {
  const sig = Buffer.from(String(signatureB64), "base64");
  try {
    return isEvmAddress(address)
      ? recoverEvmSigner(text, sig) === address
      : ed25519.verify(sig, new TextEncoder().encode(text), new PublicKey(address).toBytes());
  } catch {
    return false;
  }
}

// ---------- свежая подпись для опасных действий ----------
// Сессии мало (токен мог утечь из браузера): действие вроде выдачи ключа требует подписать одноразовый nonce
// прямо сейчас. Тот же механизм nonce, что у входа, но с purpose: nonce входа сюда не подходит и наоборот.

export const actionMessage = (purpose: string, nonce: string) => `CrawlHive ${purpose} ${nonce}`;

export function issueActionNonce(address: string, purpose: string) {
  if (!isEvmAddress(address)) new PublicKey(address);
  const now = Date.now();
  // Старые nonce того же действия у этого кошелька гасим: живой всегда один.
  for (const [k, v] of nonces()) if (v.exp < now || (v.address === address && v.purpose === purpose)) nonces().delete(k);
  const nonce = randomBytes(12).toString("base64url");
  const exp = now + NONCE_TTL_MS;
  nonces().set(nonce, { address, exp, issuedAt: new Date(now).toISOString(), purpose });
  return { nonce, message: actionMessage(purpose, nonce), expiresAt: exp };
}

// Бросает 401, если nonce чужой, другого действия, просрочен (5 минут) или подпись не та. Nonce одноразовый:
// гасится до проверки подписи, так что перебор подписей по одному nonce невозможен.
export function verifyActionSignature(address: string, purpose: string, nonce: unknown, signatureB64: unknown) {
  if (typeof nonce !== "string" || typeof signatureB64 !== "string" || !nonce || !signatureB64) throw new ApiError("Sign the confirmation message with your wallet first", 401);
  const n = nonces().get(nonce);
  if (n) nonces().delete(nonce);
  if (!n || n.purpose !== purpose || n.address !== address || n.exp < Date.now()) throw new ApiError("Confirmation expired, try again", 401);
  if (!signatureOk(address, actionMessage(purpose, nonce), signatureB64)) throw new ApiError("Signature does not match the wallet", 401);
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function verifySignIn(address: string, nonce: string, _clientIssuedAt: string, signatureB64: string) {
  const n = nonces().get(nonce);
  if (!n || n.purpose || n.address !== address || n.exp < Date.now()) throw new ApiError("Sign-in expired, try again", 401);
  nonces().delete(nonce);
  // Время берём своё, сохранённое вместе с nonce: присланное клиентом позволяло вписать в сообщение что угодно.
  const text = signInMessage(address, nonce, n.issuedAt);
  if (!signatureOk(address, text, signatureB64)) throw new ApiError("Signature does not match the wallet", 401);
  const payload = Buffer.from(JSON.stringify({ w: address, exp: Date.now() + SESSION_TTL_MS, v: sessionVersion(address) })).toString("base64url");
  return { token: `${payload}.${sign(payload)}` };
}

// Кошелёк из заголовка Authorization: Bearer <token>. null — не вошёл.
export function sessionWallet(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(payload));
  const got = Buffer.from(mac);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  try {
    const { w, exp, v } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return typeof w === "string" && exp > Date.now() && (v ?? 0) === sessionVersion(w) ? w : null;
  } catch {
    return null;
  }
}

// Версия сессий кошелька: «выйти везде» поднимает её, и все выданные токены перестают работать.
const sessionVersion = (wallet: string) => Number(getMeta(`sessv:${wallet}`) ?? 0);
export function revokeSessions(wallet: string) {
  setMeta(`sessv:${wallet}`, String(sessionVersion(wallet) + 1));
  return { ok: true };
}
