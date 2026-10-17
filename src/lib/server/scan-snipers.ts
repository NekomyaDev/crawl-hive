// Снайперы (crawler_snipers): кто купил токен в первых блоках после создания и сколько у них осталось.
// Источник — лента сделок pump.fun (свежие первыми, по 100 на страницу): листаем до самой первой сделки,
// покупатели в слоте создания и двух следующих (~1 секунда) — боты или сам создатель. Создателя не считаем,
// его доля — в истории разработчика. Остаток считаем по тем же сделкам: купил минус продал. RPC не тратится,
// поэтому дневной лимит узла сканом снайперов не съедается. Переводы между кошельками не видны — это оценка.
import "server-only";

export interface SniperReport {
  wallets: number; // сколько кошельков купили в первых блоках
  boughtPct: number; // сколько они купили, % эмиссии
  holdPct: number; // сколько у них осталось по сделкам
  sold: number; // сколько из них уже всё продали
  slots: number; // окно в слотах после создания
}

interface Trade {
  slotIndexId: string;
  userAddress: string;
  type: "buy" | "sell";
  baseAmount: string;
}

const API = "https://swap-api.pump.fun/v2/coins";
const WINDOW_SLOTS = 2;
const BUDGET_MS = 10_000;
const MAX_PAGES = 40; // 4000 сделок; у более активных токенов до первой сделки не доходим

const slotOf = (t: Trade) => Number(t.slotIndexId.slice(0, 12));

// Кэш на 30 минут: первые блоки не меняются, а лента pump.fun режет частые запросы с одного IP.
const CACHE_MS = 30 * 60_000;
const g = globalThis as unknown as { __crawlhiveSnipers?: Map<string, { at: number; r: SniperReport | null }> };
const cache = () => (g.__crawlhiveSnipers ??= new Map());

export async function traceSnipers(mint: string, supplyUi: number, creator?: string): Promise<SniperReport | null> {
  const hit = cache().get(mint);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.r;
  const r = await readSnipers(mint, supplyUi, creator);
  if (r) cache().set(mint, { at: Date.now(), r });
  return r;
}

async function readSnipers(mint: string, supplyUi: number, creator?: string): Promise<SniperReport | null> {
  if (!supplyUi) return null;
  const started = Date.now();
  const trades: Trade[] = [];
  let cursor = "0";
  let reachedStart = false;
  for (let page = 0; page < MAX_PAGES && Date.now() - started < BUDGET_MS; page++) {
    const r = await fetch(`${API}/${mint}/trades?limit=100&cursor=${encodeURIComponent(cursor)}&minSolAmount=0`, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error(`pump.fun trades ${r.status}`); // 429 и прочее — «не удалось», а не «слишком много сделок»
    const d = (await r.json()) as { trades?: Trade[]; pagination?: { nextCursor?: string; hasMore?: boolean } };
    trades.push(...(d.trades ?? []));
    if (!d.pagination?.hasMore || !d.pagination.nextCursor) {
      reachedStart = true;
      break;
    }
    cursor = d.pagination.nextCursor;
  }
  if (!reachedStart || !trades.length) return null;

  const birth = Math.min(...trades.map(slotOf));
  const net = new Map<string, number>();
  for (const t of trades) net.set(t.userAddress, (net.get(t.userAddress) ?? 0) + (t.type === "buy" ? 1 : -1) * Number(t.baseAmount));
  const bought = new Map<string, number>();
  for (const t of trades) {
    if (t.type !== "buy" || slotOf(t) > birth + WINDOW_SLOTS || t.userAddress === creator) continue;
    bought.set(t.userAddress, (bought.get(t.userAddress) ?? 0) + Number(t.baseAmount));
  }
  const pct = (x: number) => Math.round((x / supplyUi) * 10000) / 100;
  const left = [...bought.keys()].map((w) => Math.max(0, net.get(w) ?? 0));
  return {
    wallets: bought.size,
    boughtPct: pct([...bought.values()].reduce((s, x) => s + x, 0)),
    holdPct: pct(left.reduce((s, x) => s + x, 0)),
    sold: left.filter((x) => x < 1).length,
    slots: WINDOW_SLOTS,
  };
}
