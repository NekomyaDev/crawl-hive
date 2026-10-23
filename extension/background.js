// Фоновый скрипт: ходит в API CrawlHive за вердиктом (у расширения есть разрешение на crawlhive.xyz, поэтому
// CORS страницы не мешает) и держит короткий кэш, чтобы переходы туда-обратно не сканировали токен заново.
// С 1.2 ещё репутация дева (/api/dev/<адрес>) и Rug Feed (/api/rugs): ленту держим здесь и отдаём плашке
// только строку нужного токена, а не все 500 записей.
const cache = new Map();
const TTL = 2 * 60 * 1000;
const DEV_TTL = 10 * 60 * 1000;
const RUGS_TTL = 5 * 60 * 1000;
let rugs = null; // { at, items: Map<адрес, строка ленты> }

async function apiBase() {
  const { apiBase } = await chrome.storage.local.get("apiBase");
  return apiBase || "https://crawlhive.xyz";
}

// EVM-адреса в ленте и в сканах в нижнем регистре, Solana как есть.
const norm = (a) => (String(a).startsWith("0x") ? String(a).toLowerCase() : String(a));

async function cached(key, ttl, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.data;
  const data = await load();
  cache.set(key, { at: Date.now(), data });
  return data;
}

async function rugOf(id) {
  if (!rugs || Date.now() - rugs.at >= RUGS_TTL) {
    const r = await fetch(`${await apiBase()}/api/rugs`);
    if (!r.ok) throw new Error(`rugs ${r.status}`);
    const j = await r.json();
    rugs = { at: Date.now(), items: new Map((j?.items || []).map((x) => [norm(x.id), x])) };
  }
  const x = rugs.items.get(norm(id));
  return x ? { kind: x.kind, hoursToRug: x.hoursToRug, lowPct: x.lowPct, liqPulledPct: x.liqPulledPct, eventAt: x.eventAt } : null;
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === "verdict") {
    (async () => {
      const key = msg.url;
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < TTL) return reply(hit.data);
      try {
        const base = await apiBase();
        const r = await fetch(`${base}/api/ext/verdict?url=${encodeURIComponent(msg.url)}`);
        const data = await r.json();
        if (r.ok) cache.set(key, { at: Date.now(), data });
        reply(r.ok ? data : { error: data?.error || `CrawlHive answered ${r.status}` });
      } catch (e) {
        reply({ error: "CrawlHive is not reachable right now" });
      }
    })();
    return true; // ответ придёт асинхронно
  }
  if (msg?.type === "dev" && typeof msg.address === "string") {
    // Репутация дева: ярлык и строка «3 of 4 coins rugged». Таблица монет плашке не нужна.
    cached(`dev:${norm(msg.address)}`, DEV_TTL, async () => {
      const r = await fetch(`${await apiBase()}/api/dev/${encodeURIComponent(msg.address)}`);
      if (!r.ok) throw new Error(`dev ${r.status}`);
      const j = await r.json();
      return j?.badge ? { badge: j.badge, badgeLine: j.badgeLine, dev: j.dev } : null;
    })
      .then(reply)
      .catch(() => reply(null));
    return true;
  }
  if (msg?.type === "rug" && typeof msg.id === "string") {
    rugOf(msg.id)
      .then(reply)
      .catch(() => reply(null));
    return true;
  }
});
