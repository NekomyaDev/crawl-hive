// Плашка CrawlHive на странице токена: вердикт и балл, главные флаги, снайперы, оператор, LP, дев и «Full scan».
// Живёт в Shadow DOM, чтобы стили терминала её не ломали и она не ломала терминал. Терминалы — одностраничные
// приложения, поэтому адрес страницы отслеживаем сами и обновляем плашку при переходе на другой токен.
(() => {
  const ADDR = /0x[a-fA-F0-9]{40}|[0-9A-Za-z]{32,44}/; // DexScreener пишет адрес пары маленькими буквами
  const COLOR = { CLEAN: "#a3e635", OK: "#5eead4", RISKY: "#ffb020", DANGER: "#f87171", TOO_EARLY: "#8a9099" };
  let lastUrl = "";
  let host, root, hiddenFor = "";

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const pct = (n) => `${Math.round((n ?? 0) * 10) / 10}%`;

  function ensure() {
    if (host?.isConnected) return;
    host = document.createElement("div");
    host.id = "crawlhive-ext";
    host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;";
    root = host.attachShadow({ mode: "closed" });
    document.documentElement.appendChild(host);
  }

  const CSS = `
    .p{width:300px;font:13px/1.35 -apple-system,"SF Pro Text",Inter,system-ui,sans-serif;color:#e8eaed;background:#0d0e12;border:1px solid #2a2c34;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.55);overflow:hidden}
    .h{display:flex;align-items:center;gap:8px;padding:9px 11px;border-bottom:1px solid #22252c;background:linear-gradient(90deg,rgba(255,176,32,.12),transparent)}
    .h b{font-weight:800}.h .s{margin-left:auto;display:flex;gap:6px}
    .x{cursor:pointer;color:#8a9099;border:0;background:none;font-size:15px;padding:0 2px}.x:hover{color:#fff}
    .b{padding:11px}
    .v{display:flex;align-items:center;gap:10px}
    .sc{width:46px;height:46px;border-radius:50%;display:grid;place-items:center;font-weight:900;font-size:16px;border:3px solid}
    .vt{font-weight:900;font-size:16px}.rs{color:#b9bcc3;font-size:12px;margin-top:2px}
    ul{margin:9px 0 0;padding:0;list-style:none}li{padding:4px 0;border-top:1px solid #1d2026;font-size:12px}
    li i{font-style:normal;color:#8a9099}
    .bad{color:#fca5a5}.ok{color:#bef264}.warn{color:#ffd27a}
    a.f{display:block;margin-top:10px;text-align:center;padding:7px;border-radius:10px;background:linear-gradient(90deg,#ffb020,#ff6a3d,#f472b6);color:#0b0c0f;font-weight:800;text-decoration:none}
    .m{padding:9px 11px;color:#b9bcc3}
    .min{cursor:pointer;display:flex;align-items:center;gap:7px;padding:7px 11px;border-radius:999px;background:#0d0e12;border:1px solid #2a2c34;color:#e8eaed;font:700 12px -apple-system,system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.5)}
    .dot{width:9px;height:9px;border-radius:50%}`;

  const logo = `<svg width="18" height="18" viewBox="0 0 64 64"><ellipse cx="32" cy="24" rx="12" ry="14" fill="#ffb020"/><g stroke="#f39614" stroke-width="3" fill="none" stroke-linecap="round"><path d="M22 30 L10 22"/><path d="M22 34 L9 36"/><path d="M26 37 L17 48"/><path d="M42 30 L54 22"/><path d="M42 34 L55 36"/><path d="M38 37 L47 48"/></g><circle cx="27.5" cy="23" r="3" fill="#07080a"/><circle cx="36.5" cy="23" r="3" fill="#07080a"/></svg>`;

  function render(html) {
    ensure();
    root.innerHTML = `<style>${CSS}</style>${html}`;
    root.querySelectorAll("[data-x]").forEach((el) => el.addEventListener("click", () => {
      hiddenFor = lastUrl;
      chrome.storage.local.set({ collapsed: true });
      show(lastData);
    }));
    root.querySelectorAll("[data-open]").forEach((el) => el.addEventListener("click", () => {
      chrome.storage.local.set({ collapsed: false });
      hiddenFor = "";
      show(lastData);
    }));
  }

  let lastData = null;
  async function show(d) {
    lastData = d;
    const { collapsed } = await chrome.storage.local.get("collapsed");
    if (!d) return render(`<div class="p"><div class="h">${logo}<b>CrawlHive</b><div class="s"><button class="x" data-x title="Minimize">−</button></div></div><div class="m">Scanning this token…</div></div>`);
    if (d.error) return render(`<div class="p"><div class="h">${logo}<b>CrawlHive</b><div class="s"><button class="x" data-x>−</button></div></div><div class="m">${esc(d.error)}</div></div>`);
    const c = COLOR[d.verdict] || "#8a9099";
    if (collapsed || hiddenFor === lastUrl)
      return render(`<div class="min" data-open><span class="dot" style="background:${c}"></span>${logo}${esc(d.score ?? "")} ${esc(d.verdict.replace("_", " "))} · $${esc(d.symbol)}</div>`);
    const items = [];
    for (const f of d.flags || []) items.push(`<li class="bad">✕ ${esc(f.label)} <i>· ${esc(f.note)}</i></li>`);
    if (d.lp && d.lp.status !== "curve") {
      const soon = d.lp.unlockAt && d.lp.unlockAt - Date.now() < 30 * 864e5;
      items.push(d.lp.status === "burned" ? `<li class="ok">✓ LP burned</li>` : d.lp.status === "unlocked" ? `<li class="bad">✕ LP not locked (${pct(d.lp.lockedPct)})</li>` : `<li class="${soon ? "warn" : "ok"}">${soon ? "⚠" : "✓"} LP ${pct(d.lp.lockedPct)} locked${d.lp.unlockAt ? ` · unlocks ${new Date(d.lp.unlockAt).toISOString().slice(0, 10)}` : ""}</li>`);
    }
    if (d.snipers) items.push(`<li class="${d.snipers.holdPct >= 5 ? "warn" : "ok"}">🎯 ${d.snipers.wallets} snipers · hold ${pct(d.snipers.holdPct)}${d.snipers.sold ? ` · ${d.snipers.sold} sold` : ""}</li>`);
    if (d.operator) items.push(`<li class="${d.operator.pct >= 15 ? "bad" : "warn"}">👥 operator: ${d.operator.wallets} wallets hold ${pct(d.operator.pct)} <i>· ${esc(d.operator.roles.join(" + "))}</i></li>`);
    if (d.devSnipers) items.push(`<li class="bad">✕ ${d.devSnipers} snipers funded by the dev</li>`);
    if (d.dev) items.push(`<li>🧾 dev: ${d.dev.launched > 1 ? `${d.dev.launched - 1} earlier launches · ${d.dev.graduated} graduated` : "first launch"} <i>· <a href="https://crawlhive.xyz/dev/${esc(d.dev.creator)}" target="_blank" style="color:#7cc4ff">history</a></i></li>`);
    render(`<div class="p"><div class="h">${logo}<b>CrawlHive</b><span style="color:#8a9099">$${esc(d.symbol)}</span><div class="s"><button class="x" data-x title="Minimize">−</button></div></div>
      <div class="b"><div class="v"><div class="sc" style="border-color:${c};color:${c}">${esc(d.score ?? "-")}</div><div><div class="vt" style="color:${c}">${esc(d.verdict.replace("_", " "))}</div><div class="rs">${esc(d.reason)}</div></div></div>
      <ul>${items.join("")}</ul>${larpBox(d.larp)}<a class="f" href="${esc(d.url)}" target="_blank">Full scan on CrawlHive</a></div></div>`);
  }

  // Второе мнение Larpcheck о проекте за токеном; ссылка на их проверку обязательна.
  function larpBox(l) {
    if (!l || !l.verdict || !l.url) return "";
    const lc = /SCAM|LARP/.test(l.verdict) ? "#f87171" : /REAL/.test(l.verdict) && !/PARTLY/.test(l.verdict) ? "#a3e635" : "#ffb020";
    return `<a href="${esc(l.url)}" target="_blank" style="display:flex;align-items:center;gap:8px;margin:8px 0 2px;padding:7px 9px;border-radius:9px;border:1px solid ${lc}66;background:${lc}14;color:#e8eaed;text-decoration:none;font-size:12px"><span style="color:#8a9099;font-size:10px;letter-spacing:.08em">LARPCHECK</span><b style="color:${lc}">${esc(l.verdict)}${l.score != null ? " " + esc(l.score) : ""}</b><span style="margin-left:auto;color:#8a9099">↗</span></a>`;
  }

  function tick() {
    const url = location.href;
    if (url === lastUrl) return;
    lastUrl = url;
    if (!ADDR.test(location.pathname + location.search)) {
      if (host) host.remove();
      return;
    }
    show(null);
    chrome.runtime.sendMessage({ type: "verdict", url }, (d) => {
      if (url !== lastUrl) return; // пока ждали, пользователь ушёл на другой токен
      show(d || { error: "No answer from CrawlHive" });
    });
  }

  tick();
  setInterval(tick, 1000);
})();
