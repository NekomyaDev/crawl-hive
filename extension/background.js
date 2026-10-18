// Фоновый скрипт: ходит в API CrawlHive за вердиктом (у расширения есть разрешение на crawlhive.xyz, поэтому
// CORS страницы не мешает) и держит короткий кэш, чтобы переходы туда-обратно не сканировали токен заново.
const cache = new Map();
const TTL = 2 * 60 * 1000;

async function apiBase() {
  const { apiBase } = await chrome.storage.local.get("apiBase");
  return apiBase || "https://crawlhive.xyz";
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== "verdict") return;
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
});
