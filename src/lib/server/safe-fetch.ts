// Загрузка страниц по адресам, которые ввёл пользователь (цели docs-краулера), без SSRF.
// Пускаем только http(s) на портах 80/443, только на публичные адреса: loopback, частные сети, link-local
// (метаданные облака 169.254.169.254), CGNAT и их IPv6-аналоги отсекаются. Проверка стоит прямо в DNS-lookup
// соединения, поэтому подмена DNS между проверкой и запросом (DNS rebinding) не проходит. Редиректы — вручную,
// каждый шаг проверяется заново. Тело читается с ограничением размера, а не целиком в память.
import "server-only";
import http from "node:http";
import https from "node:https";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import net from "node:net";

const MAX_REDIRECTS = 3;

function privateV4(ip: string) {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224
  );
}

export function isPrivateIp(ip: string) {
  if (net.isIPv4(ip)) return privateV4(ip);
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return privateV4(v.slice(7));
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff");
}

// Быстрая проверка адреса до сохранения цели: схема, порт, IP-литерал.
export function checkPublicUrl(raw: string): URL {
  const u = new URL(raw);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Only http(s) pages");
  if (u.port && u.port !== "80" && u.port !== "443") throw new Error("Only standard web ports");
  if (u.username || u.password) throw new Error("No credentials in the URL");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && isPrivateIp(host)) throw new Error("Private address");
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) throw new Error("Private address");
  return u;
}

// DNS-lookup, который отказывает частным адресам: им пользуется само соединение.
function safeLookup(hostname: string, options: object, cb: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) {
  dnsLookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err, "");
    const list = (addrs as LookupAddress[]) ?? [];
    if (!list.length || list.some((a) => isPrivateIp(a.address))) return cb(Object.assign(new Error("Blocked private address"), { code: "EBLOCKED" }), "");
    if ((options as { all?: boolean }).all) cb(null, list);
    else cb(null, list[0].address, list[0].family);
  });
}

function once(url: URL, maxBytes: number, timeoutMs: number): Promise<{ status: number; location?: string; body: string }> {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(
      url,
      { method: "GET", lookup: safeLookup as never, headers: { "User-Agent": "Mozilla/5.0 (compatible; CrawlHive/1.0)", Accept: "text/html,text/plain,*/*" }, timeout: timeoutMs },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, location: res.headers.location, body: "" });
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            chunks.push(c.subarray(0, Math.max(0, c.length - (size - maxBytes))));
            res.destroy();
            return;
          }
          chunks.push(c);
        });
        const done = () => resolve({ status, body: Buffer.concat(chunks).toString("utf8") });
        res.on("end", done);
        res.on("close", done);
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

export async function fetchPublicText(raw: string, opts: { maxBytes?: number; timeoutMs?: number } = {}) {
  let url = checkPublicUrl(raw);
  const deadline = Date.now() + (opts.timeoutMs ?? 15_000);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const left = deadline - Date.now();
    if (left <= 0) throw new Error("timeout");
    const r = await once(url, opts.maxBytes ?? 1_500_000, left);
    if (r.location && hop < MAX_REDIRECTS) {
      url = checkPublicUrl(new URL(r.location, url).toString());
      continue;
    }
    if (r.status < 200 || r.status >= 300) throw new Error(`HTTP ${r.status}`);
    return r.body;
  }
  throw new Error("Too many redirects");
}
