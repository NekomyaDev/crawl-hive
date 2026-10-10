// Вход подписью кошелька (упрощённый Sign-In With Solana).
// Кошелёк подписывает сообщение с одноразовым nonce, сервер проверяет ed25519-подпись
// и выдаёт токен сессии (HMAC). Без этого любой мог бы читать чужие приватные сигналы по адресу.
import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519";
import { PublicKey } from "@solana/web3.js";
import { ApiError, metaValue } from "./store";

const NONCE_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 7 * 86400_000;

const g = globalThis as unknown as { __crawlhiveNonces?: Map<string, { address: string; exp: number }> };
const nonces = () => (g.__crawlhiveNonces ??= new Map());

function secret(): string {
  // Секрет сессий: из env, иначе генерируется один раз и хранится вместе с состоянием.
  return process.env.SESSION_SECRET?.trim() || metaValue("sessionSecret", () => randomBytes(32).toString("hex"));
}

export function signInMessage(address: string, nonce: string, issuedAt: string) {
  return `CrawlHive sign-in\n\nWallet: ${address}\nNonce: ${nonce}\nIssued: ${issuedAt}\n\nThis signature only proves you own the wallet. It does not send a transaction or cost anything.`;
}

export function issueNonce(address: string) {
  new PublicKey(address); // бросит на кривом адресе
  const now = Date.now();
  for (const [k, v] of nonces()) if (v.exp < now) nonces().delete(k);
  const nonce = randomBytes(12).toString("base64url");
  const issuedAt = new Date(now).toISOString();
  nonces().set(nonce, { address, exp: now + NONCE_TTL_MS });
  return { nonce, issuedAt, message: signInMessage(address, nonce, issuedAt) };
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function verifySignIn(address: string, nonce: string, issuedAt: string, signatureB64: string) {
  const n = nonces().get(nonce);
  if (!n || n.address !== address || n.exp < Date.now()) throw new ApiError("Sign-in expired, try again", 401);
  nonces().delete(nonce);
  const msg = new TextEncoder().encode(signInMessage(address, nonce, issuedAt));
  let ok = false;
  try {
    ok = ed25519.verify(Buffer.from(signatureB64, "base64"), msg, new PublicKey(address).toBytes());
  } catch {
    ok = false;
  }
  if (!ok) throw new ApiError("Signature does not match the wallet", 401);
  const payload = Buffer.from(JSON.stringify({ w: address, exp: Date.now() + SESSION_TTL_MS })).toString("base64url");
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
    const { w, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return typeof w === "string" && exp > Date.now() ? w : null;
  } catch {
    return null;
  }
}
