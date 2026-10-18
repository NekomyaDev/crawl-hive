// Ограничитель запросов к Solana RPC. Один скан делает десятки вызовов (держатели, связанные кошельки,
// история создателя), а у тарифа RPC есть лимит в секунду: при наплыве сканов web3.js получал 429 и
// повторял вслепую, и часть проверок не успевала. Здесь общая на весь сервер очередь: не больше RPS
// запросов в секунду и CONCURRENCY одновременно; на 429 — пауза с ростом и до трёх повторов.
import "server-only";

const RPS = () => Math.max(1, Number(process.env.SOLANA_RPC_RPS ?? 12));
const CONCURRENCY = 8;
const RETRIES = 3;

const g = globalThis as unknown as { __crawlhiveRpc?: { stamps: number[]; active: number } };
const st = () => (g.__crawlhiveRpc ??= { stamps: [], active: 0 });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Ждём свободного места: и по числу одновременных запросов, и по числу запросов за последнюю секунду.
async function acquire() {
  const s = st();
  for (;;) {
    const now = Date.now();
    s.stamps = s.stamps.filter((t) => now - t < 1000);
    if (s.active < CONCURRENCY && s.stamps.length < RPS()) {
      s.active++;
      s.stamps.push(now);
      return;
    }
    const wait = s.stamps.length >= RPS() ? 1000 - (now - s.stamps[0]) + 5 : 25;
    await sleep(Math.max(5, wait));
  }
}

const release = () => {
  st().active--;
};

// Запасной узел, когда у основного кончился дневной лимит (QuickNode отвечает 429 «daily request limit reached»):
// до полуночи UTC ходим туда, повторять основной бессмысленно.
const FALLBACK = () => process.env.SOLANA_RPC_FALLBACK?.trim() || "https://api.mainnet-beta.solana.com";
const g2 = globalThis as unknown as { __crawlhiveRpcDown?: number };
const nextUtcMidnight = () => Math.ceil(Date.now() / 86400_000) * 86400_000;

// Счётчик вызовов по методам: раз в час пишем в лог, на что уходит дневной лимит узла.
const g3 = globalThis as unknown as { __crawlhiveRpcStats?: { since: number; by: Map<string, number> } };
const stats = () => (g3.__crawlhiveRpcStats ??= { since: Date.now(), by: new Map() });
function count(body: unknown) {
  try {
    const j = JSON.parse(String(body));
    for (const m of (Array.isArray(j) ? j : [j]).map((x: { method?: string }) => x.method ?? "?")) stats().by.set(m, (stats().by.get(m) ?? 0) + 1);
  } catch {}
}
export function rpcStats() {
  const s = stats();
  return { since: s.since, total: [...s.by.values()].reduce((a, b) => a + b, 0), by: Object.fromEntries([...s.by].sort((a, b) => b[1] - a[1])) };
}
if (!(globalThis as { __crawlhiveRpcLog?: boolean }).__crawlhiveRpcLog) {
  (globalThis as { __crawlhiveRpcLog?: boolean }).__crawlhiveRpcLog = true;
  setInterval(() => {
    const r = rpcStats();
    console.log(`[rpc] ${r.total} calls in ${Math.round((Date.now() - r.since) / 60_000)} min: ${Object.entries(r.by).slice(0, 8).map(([m, n]) => `${m} ${n}`).join(", ")}`);
  }, Number(process.env.RPC_STATS_MIN ?? 60) * 60_000);
}

// fetch для web3.js Connection.
export const limitedFetch: typeof fetch = async (input, init) => {
  count(init?.body);
  for (let attempt = 0; ; attempt++) {
    const down = (g2.__crawlhiveRpcDown ?? 0) > Date.now();
    await acquire();
    let res: Response;
    try {
      res = await fetch(down ? FALLBACK() : input, init);
    } catch (e) {
      // Основной узел не отвечает вовсе (сеть, DNS): 10 минут ходим на запасной и повторяем запрос.
      if (!down && attempt < RETRIES) {
        g2.__crawlhiveRpcDown = Date.now() + 10 * 60_000;
        console.warn("[rpc] primary RPC unreachable, using the fallback for 10 minutes:", (e as Error).message);
        continue;
      }
      throw e;
    } finally {
      release();
    }
    if (res.status === 429 && !down) {
      const text = await res.clone().text().catch(() => "");
      if (/daily request limit|credits|quota/i.test(text)) {
        g2.__crawlhiveRpcDown = nextUtcMidnight();
        console.warn("[rpc] primary RPC is out of its daily limit, using the fallback until 00:00 UTC");
        continue;
      }
    }
    if (res.status !== 429 || attempt >= RETRIES) return res;
    const retryAfter = Number(res.headers.get("retry-after"));
    await sleep(retryAfter > 0 ? retryAfter * 1000 : 400 * 2 ** attempt + Math.random() * 200);
  }
};
