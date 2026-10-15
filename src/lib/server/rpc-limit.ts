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

// fetch для web3.js Connection.
export const limitedFetch: typeof fetch = async (input, init) => {
  for (let attempt = 0; ; attempt++) {
    const down = (g2.__crawlhiveRpcDown ?? 0) > Date.now();
    await acquire();
    let res: Response;
    try {
      res = await fetch(down ? FALLBACK() : input, init);
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
