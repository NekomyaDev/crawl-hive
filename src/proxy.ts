// Ограничение частоты запросов с одного IP: защита от флуда и простых DoS-скриптов на уровне приложения.
// Ведро токенов: 10 запросов в секунду в среднем, запас на всплеск (страница при загрузке тянет несколько
// запросов сразу). Сверх лимита — 429 с Retry-After. Статика Next и картинки не считаются.
// Настоящий IP клиента: последнее значение X-Forwarded-For, его дописывает Caddy — клиент подделать не может.
// Объёмные атаки (гигабиты трафика) так не остановить: это задача CDN перед сервером, см. README.
import { NextResponse, type NextRequest } from "next/server";

const RATE = Number(process.env.RATE_LIMIT_RPS ?? 10); // токенов в секунду
const BURST = Number(process.env.RATE_LIMIT_BURST ?? 60); // ёмкость ведра
const MAX_IPS = 50_000;

interface Bucket {
  tokens: number;
  at: number;
}
const g = globalThis as unknown as { __crawlhiveRate?: { buckets: Map<string, Bucket>; sweptAt: number; blocked: number } };
const st = () => (g.__crawlhiveRate ??= { buckets: new Map(), sweptAt: Date.now(), blocked: 0 });

function clientIp(req: NextRequest) {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",").at(-1)!.trim();
  return req.headers.get("x-real-ip") ?? "local";
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
  const b = s.buckets.get(ip) ?? { tokens: BURST, at: now };
  b.tokens = Math.min(BURST, b.tokens + ((now - b.at) / 1000) * RATE);
  b.at = now;
  if (b.tokens < 1) {
    s.buckets.set(ip, b);
    if (++s.blocked % 100 === 1) console.warn(`[rate] 429 for ${ip} (${s.blocked} blocked since start)`);
    const retry = Math.ceil((1 - b.tokens) / RATE);
    return new NextResponse(JSON.stringify({ error: "Too many requests, slow down" }), {
      status: 429,
      headers: { "content-type": "application/json", "retry-after": String(retry) },
    });
  }
  b.tokens -= 1;
  s.buckets.set(ip, b);
  return NextResponse.next();
}

export const config = {
  // Всё, кроме статики сборки, оптимизатора картинок и файлов из public.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|woff2?)$).*)"],
};
