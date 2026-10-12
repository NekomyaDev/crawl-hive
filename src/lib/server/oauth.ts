// OAuth 2.1 для MCP: ChatGPT (Dots), Meta Muse, Claude и другие агенты подключаются к краулерам кнопкой
// «Connect», без ручного копирования ключа. Агент регистрируется сам (RFC 7591), владелец на странице
// /oauth/authorize выбирает, какой Grok Bot он подключает (или создаёт нового), и агент получает токен
// этого бота: те же права, что у ключа chb_ — только выбранные краулеры, только чтение, отзыв удалением бота.
// PKCE (S256) обязателен. Коды живут 10 минут и одноразовые.
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { ApiError, getMeta, setMeta } from "./store";
import { attachBotToken, refreshBotToken, ownBot } from "./bots";

export const ISSUER = (process.env.PUBLIC_URL?.trim() || "https://crawlhive.xyz").replace(/\/$/, "");
const CLIENTS_KEY = "oauthclients";
const MAX_CLIENTS = 500;
const CODE_TTL_MS = 10 * 60_000;

export interface OAuthClient {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  createdAt: number;
}

function clients(): OAuthClient[] {
  try {
    return JSON.parse(getMeta(CLIENTS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

// Опасные схемы отсекаем; https, localhost и схемы приложений (cursor://, vscode://) разрешены.
function validRedirect(u: unknown): string | null {
  if (typeof u !== "string" || u.length > 500) return null;
  try {
    const url = new URL(u);
    if (["javascript:", "data:", "file:", "blob:"].includes(url.protocol)) return null;
    if (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return null;
    if (url.hash) return null;
    return url.toString() === u ? u : url.toString();
  } catch {
    return null;
  }
}

export function registerClient(input: { client_name?: unknown; redirect_uris?: unknown }) {
  const uris = (Array.isArray(input.redirect_uris) ? input.redirect_uris : []).map(validRedirect);
  if (!uris.length || uris.some((u) => !u)) throw new ApiError("invalid_redirect_uri");
  const client: OAuthClient = {
    client_id: `chc_${randomBytes(12).toString("base64url")}`,
    client_name: String(input.client_name ?? "AI agent").trim().slice(0, 60) || "AI agent",
    redirect_uris: uris as string[],
    createdAt: Date.now(),
  };
  setMeta(CLIENTS_KEY, JSON.stringify([...clients(), client].slice(-MAX_CLIENTS)));
  return client;
}

export function clientFor(clientId: string, redirectUri: string) {
  const c = clients().find((x) => x.client_id === clientId);
  if (!c) throw new ApiError("Unknown app. Start the connection again from your agent.", 400);
  if (!c.redirect_uris.includes(redirectUri)) throw new ApiError("This redirect address is not registered for the app", 400);
  return c;
}

// ---------- коды авторизации ----------

interface Code {
  clientId: string;
  redirectUri: string;
  challenge: string;
  botId: string;
  wallet: string;
  exp: number;
}
const g = globalThis as unknown as { __crawlhiveOAuthCodes?: Map<string, Code> };
const codes = () => (g.__crawlhiveOAuthCodes ??= new Map());

export function approve(
  wallet: string,
  input: { client_id?: unknown; redirect_uri?: unknown; code_challenge?: unknown; code_challenge_method?: unknown; state?: unknown; bot_id?: unknown },
) {
  const clientId = String(input.client_id ?? "");
  const redirectUri = String(input.redirect_uri ?? "");
  clientFor(clientId, redirectUri);
  const challenge = String(input.code_challenge ?? "");
  if (input.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge))
    throw new ApiError("The app must use PKCE (S256). Update the agent and try again.");
  const bot = ownBot(wallet, String(input.bot_id ?? ""));
  const now = Date.now();
  for (const [k, v] of codes()) if (v.exp < now) codes().delete(k);
  const code = randomBytes(24).toString("base64url");
  codes().set(code, { clientId, redirectUri, challenge, botId: bot.id, wallet, exp: now + CODE_TTL_MS });
  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  if (typeof input.state === "string" && input.state) url.searchParams.set("state", input.state);
  url.searchParams.set("iss", ISSUER);
  return { redirect: url.toString() };
}

// Ошибки токен-эндпоинта по RFC 6749: { error, error_description } и статус 400.
export class OAuthError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
  }
}

const s256 = (v: string) => createHash("sha256").update(v).digest("base64url");

export function exchange(p: Record<string, string>) {
  if (p.grant_type === "authorization_code") {
    const c = codes().get(p.code ?? "");
    codes().delete(p.code ?? "");
    if (!c || c.exp < Date.now()) throw new OAuthError("invalid_grant", "Code expired or already used");
    if (c.clientId !== p.client_id || c.redirectUri !== p.redirect_uri) throw new OAuthError("invalid_grant", "Code was issued to another app");
    if (!p.code_verifier || s256(p.code_verifier) !== c.challenge) throw new OAuthError("invalid_grant", "PKCE check failed");
    const name = clients().find((x) => x.client_id === c.clientId)?.client_name ?? "AI agent";
    return tokenResponse(attachBotToken(c.wallet, c.botId, name));
  }
  if (p.grant_type === "refresh_token") {
    const t = refreshBotToken(p.refresh_token ?? "");
    if (!t) throw new OAuthError("invalid_grant", "Refresh token expired or revoked");
    return tokenResponse(t);
  }
  throw new OAuthError("unsupported_grant_type", "Use authorization_code or refresh_token");
}

const tokenResponse = (t: { access: string; refresh: string; expiresIn: number }) => ({
  access_token: t.access,
  token_type: "Bearer",
  expires_in: t.expiresIn,
  refresh_token: t.refresh,
  scope: "crawlers",
});

// ---------- метаданные ----------

export const protectedResourceMeta = () => ({
  resource: `${ISSUER}/mcp`,
  authorization_servers: [ISSUER],
  bearer_methods_supported: ["header"],
  scopes_supported: ["crawlers"],
  resource_name: "CrawlHive crawlers",
  resource_documentation: `${ISSUER}/my`,
});

export const authServerMeta = () => ({
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/oauth/authorize`,
  token_endpoint: `${ISSUER}/api/oauth/token`,
  registration_endpoint: `${ISSUER}/api/oauth/register`,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
  scopes_supported: ["crawlers"],
  service_documentation: `${ISSUER}/my`,
});

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
};
