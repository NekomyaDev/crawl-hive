// Ограничение частоты запросов с одного IP: защита от флуда и простых DoS-скриптов на уровне приложения.
// Ведро токенов: 10 запросов в секунду в среднем, запас на всплеск (страница при загрузке тянет несколько
// запросов сразу). Сверх лимита — 429 с Retry-After. Статика Next и картинки не считаются.
// Настоящий IP клиента: последнее значение X-Forwarded-For, его дописывает Caddy — клиент подделать не может.
// Кто упирается в лимит долго, попадает в DATA_DIR/ratelimit.log (не чаще раза в 5 с на IP); fail2ban на сервере
// читает этот файл и при непрерывном флуде банит IP на уровне файрвола — дальше запросы не доходят даже до Caddy.
// Объёмные атаки (гигабиты трафика) так не остановить: это задача CDN перед сервером, см. README.
import { appendFile, stat, truncate } from "node:fs/promises";
import path from "node:path";
import { isIP } from "node:net";
import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

const RATE = Number(process.env.RATE_LIMIT_RPS ?? 10); // токенов в секунду
const BURST = Number(process.env.RATE_LIMIT_BURST ?? 60); // ёмкость ведра
const MAX_IPS = 50_000;

interface Bucket {
  tokens: number;
  at: number;
}
const g = globalThis as unknown as {
  __crawlhiveRate?: { buckets: Map<string, Bucket>; sweptAt: number; blocked: number; logged: Map<string, number>; day: string; uniq: Set<string>; reqs: number };
};
const st = () => (g.__crawlhiveRate ??= { buckets: new Map(), sweptAt: Date.now(), blocked: 0, logged: new Map(), day: "", uniq: new Set(), reqs: 0 });

// Посетители за сутки для админки: только хэш IP с суточной солью и только в памяти.
function countVisit(ip: string) {
  const s = st();
  const day = new Date().toISOString().slice(0, 10);
  if (s.day !== day) Object.assign(s, { day, uniq: new Set(), reqs: 0 });
  s.reqs++;
  if (s.uniq.size < 200_000) s.uniq.add(createHash("sha256").update(day + ip).digest("base64url").slice(0, 16));
}

const LOG = path.join(process.env.DATA_DIR?.trim() || path.join(process.cwd(), ".data"), "ratelimit.log");
const LOG_MAX = 5 * 1024 * 1024;

// Строка для fail2ban: "<время ISO> <ip> 429". Файл не растёт бесконечно: больше 5 МБ — обнуляем.
function logBlocked(ip: string, now: number) {
  const s = st();
  if (now - (s.logged.get(ip) ?? 0) < 5_000) return;
  s.logged.set(ip, now);
  if (s.logged.size > MAX_IPS) s.logged.clear();
  void (async () => {
    try {
      if (((await stat(LOG).catch(() => null))?.size ?? 0) > LOG_MAX) await truncate(LOG, 0);
      await appendFile(LOG, `${new Date(now).toISOString()} ${ip} 429\n`);
    } catch {
      // нет доступа к диску — лимит всё равно работает
    }
  })();
}

function clientIp(req: NextRequest) {
  const xff = req.headers.get("x-forwarded-for");
  const ip = (xff ? xff.split(",").at(-1)!.trim() : req.headers.get("x-real-ip")) ?? "";
  return isIP(ip) ? ip : "unknown";
}

// IPv6: у одного абонента обычно целая сеть /64 — считаем её одним клиентом, иначе лимит обходится сменой адреса.
function bucketKey(ip: string) {
  if (isIP(ip) !== 6) return ip;
  const full = ip.includes("::") ? ip.replace("::", ":" + "0:".repeat(Math.max(0, 8 - ip.split(":").filter(Boolean).length))).replace(/^:|:$/g, "") : ip;
  return full.split(":").slice(0, 4).join(":") + "::/64";
}

export function proxy(req: NextRequest) {
  if (process.env.RATE_LIMIT_OFF === "1") return NextResponse.next();
  const s = st();
  const now = Date.now();
  // Раз в минуту выбрасываем полные вёдра — память не растёт от разовых посетителей.
  if (now - s.sweptAt > 60_000 || s.buckets.size > MAX_IPS) {
    for (const [ip, b] of s.buckets) if (b.tokens + ((now - b.at) / 1000) * RATE >= BURST) s.buckets.delete(ip);
    s.sweptAt = now;
  }
  const ip = clientIp(req);
  if (req.method === "GET" && !req.nextUrl.pathname.startsWith("/api/")) countVisit(ip);
  const key = bucketKey(ip);
  const b = s.buckets.get(key) ?? { tokens: BURST, at: now };
  b.tokens = Math.min(BURST, b.tokens + ((now - b.at) / 1000) * RATE);
  b.at = now;
  if (b.tokens < 1) {
    s.buckets.set(key, b);
    if (++s.blocked % 100 === 1) console.warn(`[rate] 429 for ${ip} (${s.blocked} blocked since start)`);
    if (ip !== "unknown") logBlocked(ip, now); // в журнал fail2ban — только настоящий IP
    const retry = Math.ceil((1 - b.tokens) / RATE);
    return new NextResponse(JSON.stringify({ error: "Too many requests, slow down" }), {
      status: 429,
      headers: { "content-type": "application/json", "retry-after": String(retry) },
    });
  }
  b.tokens -= 1;
  s.buckets.set(key, b);
  return NextResponse.next();
}

export const config = {
  // Всё, кроме статики сборки, оптимизатора картинок и файлов из public.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|woff2?)$).*)"],
};
