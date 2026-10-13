// «Рентген сайта»: ищем на сайте мемкоина код, который сливает кошелёк посетителя.
// У лендинга мемкоина нет честной причины просить у кошелька апрув токенов или подпись переводов —
// дрейнер-киты прячутся именно там («claim airdrop», «connect to verify»).
// Качаем только через safe-fetch (SSRF), код не исполняем — смотрим строки. Это эвристика:
// минифицированный дрейнер с переименованными функциями мы пропустим, а громкий вывод даём только
// на сочетании сигналов. Лучше промолчать о слабом сигнале, чем зря пугать.
import "server-only";
import { checkPublicUrl, fetchPublicText } from "./safe-fetch";
import { astScan } from "./scan-site-ast";

export interface SiteFinding { key: string; label: string; note: string; severity: "high" | "medium" | "low"; evidence: string }
export interface SiteReport { url: string; host: string; scripts: number; bytes: number; findings: SiteFinding[]; wallet: boolean; error?: string }

const HTML_MAX = 1_000_000;
const HTML_TIMEOUT = 6_000;
const SCRIPT_MAX = 1_500_000;
const SCRIPTS_LIMIT = 8;
const TOTAL_BUDGET_MS = 12_000;
const TOTAL_BYTES = 6_000_000;
const CONCURRENCY = 3;
const TTL = 6 * 3600_000;
const ERROR_TTL = 10 * 60_000; // недоступный сайт перепроверяем чаще: мог просто моргнуть
const CACHE_MAX = 500;

// Аналитика есть почти везде и кошелёк не трогает — не тратим на неё бюджет.
const ANALYTICS = /googletagmanager|google-analytics|gtag\/js|cloudflareinsights|plausible\.io|_vercel\/insights|vercel-insights|vercel\.live|hotjar|clarity\.ms|segment\.com\/analytics/i;

// Названия кошельков и «connect wallet» голыми словами не берём: это и ссылки-логотипы, и текст инструкции
// «Connect your wallet to Raydium». Считаем только API кошелька, его SDK и кнопку/строку интерфейса.
const WALLET = /window\.ethereum|window\.solana|window\.phantom|isPhantom|PhantomWalletAdapter|window\.solflare|SolflareWalletAdapter|walletconnect|web3modal|@reown|reown\.com|@wagmi\/|wagmiconfig|wagmiprovider|rainbowkit|@solana\/wallet-adapter|wallet-adapter-react|eth_requestAccounts|>\s*connect\s*(?:your\s*)?wallet\s*<|["'`]connect\s*(?:your\s*)?wallet["'`]/i;

// Адреса, которые законно зашиты в библиотеки и dapp-ы: нулевой, Permit2, Seaport, Multicall3, роутеры Uniswap, WETH/USDC.
// Они не считаются «зашитым получателем»: дрейнер шлёт апрув на свой адрес, а не на Permit2.
const KNOWN_ADDR = new Set(
  [
    "0x0000000000000000000000000000000000000000",
    "0x000000000022d473030f116ddee9f6b43ac78ba3", // Permit2
    "0x00000000006c3852cbef3e08e8df289169ede581", // Seaport 1.1
    "0x00000000000006c7676171937c444f6bde3d6282", // Seaport 1.2
    "0x0000000000000ad24e80fd803c6ac37206a45f15", // Seaport 1.4
    "0x00000000000000adc04c56bf30ac9d3c0aaf14dc", // Seaport 1.5
    "0x0000000000000068f116a894984e2db1123eb395", // Seaport 1.6
    "0xca11bde05977b3631167028862be2a173976ca11", // Multicall3
    "0xef1c6e67703c7bd7107eed8303fbe6ec2554bf6b", // Uniswap Universal Router (старый)
    "0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad", // Uniswap Universal Router
    "0x66a9893cc07d91d95644aedd05d03f95e1dba8af", // Uniswap Universal Router v4
    "0x7a250d5630b4cf539739df2c5dacb4c659f2488d", // Uniswap V2 Router
    "0xe592427a0aece92de3edee1f18e0157c05861564", // Uniswap V3 Router
    "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45", // Uniswap SwapRouter02
    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", // WETH
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // USDC
    "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", // «нативная монета» в агрегаторах
    "0x10ed43c718714eb63d5aa57b78b54704e256024e", // PancakeSwap V2 Router
    "0x13f4ea83d0bd40e75c8222255bc855a974568dd4", // PancakeSwap Smart Router
    "0x1b81d678ffb9c0263b24a97847620c99d213eb14", // PancakeSwap V3 Router
    "0x1a0a18ac4becddbd6389559687d1a73d8927e416", // PancakeSwap Universal Router
    "0x111111125421ca6dc452d289314280a0f8842a65", // 1inch v6
    "0x1111111254eeb25477b68fb85ed929f73a960582", // 1inch v5
    "0xdef1c0ded9bec7f1a1670819833240f027b25eff", // 0x Exchange Proxy
    "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", // WBNB
  ].map((a) => a.toLowerCase()),
);

type Bundle = { name: string; code: string };

// Короткий кусок вокруг совпадения, только печатный ASCII — уходит в UI.
function snippet(code: string, idx: number, len: number) {
  const pad = Math.max(0, Math.floor((80 - Math.min(len, 80)) / 2));
  const s = code.slice(Math.max(0, idx - pad), idx + len + pad).replace(/[^\x20-\x7e]+/g, " ").replace(/\s+/g, " ").trim();
  return s.length > 80 ? s.slice(0, 77) + "..." : s;
}

function first(code: string, re: RegExp) {
  const m = re.exec(code);
  return m ? { idx: m.index, len: m[0].length, text: m[0] } : undefined;
}

function countMatches(code: string, re: RegExp, stopAt = Infinity) {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let n = 0;
  while (g.exec(code) && ++n < stopAt);
  return n;
}

// Чужой зашитый адрес рядом с позицией: 40 hex-символов ровно, не из списка известных.
function strangerAddr(win: string) {
  const re = /0x[a-fA-F0-9]{40}(?![a-fA-F0-9])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(win))) if (!KNOWN_ADDR.has(m[0].toLowerCase())) return m[0];
  return undefined;
}

const MAX_UINT = /(?:0x)?f{64}(?![0-9a-f])/gi;
const APPROVE_CALL = /0x095ea7b3|increaseAllowance|\.approve\s*\(|["'`]approve["'`]|functionName\s*:\s*["'`](?:approve|increaseAllowance)/;
const PERMIT_CTX = /permitTransferFrom|PermitBatch|0x000000000022D473030F116dDEE9F6B43aC78BA3|OrderComponents|considerationItems/i;
// setApprovalForAll как вызов, а не строка ABI: ".setApprovalForAll(" или writeContract с functionName.
const SAFA_CALL = /\.setApprovalForAll\s*\(|functionName\s*:\s*["'`]setApprovalForAll["'`]/g;
const WIN = 400;

// EVM. В бандлах wagmi/viem/ethers есть ABI со словами approve/setApprovalForAll и константа MaxUint256,
// поэтому ни одно слово само по себе ничего не значит. Тревога — только когда в одном окне ±400 символов
// стоят max-uint литерал, апрув/permit/Seaport и зашитый чужой адрес (получатель). Это и есть форма
// «approve(0xСвой, 2^256-1)». Для setApprovalForAll достаточно вызова рядом с чужим адресом.
function evmApproval(b: Bundle): SiteFinding | undefined {
  const code = b.code;
  MAX_UINT.lastIndex = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = MAX_UINT.exec(code)) && n++ < 200) {
    const win = code.slice(Math.max(0, m.index - WIN), m.index + WIN);
    if (!APPROVE_CALL.test(win) && !PERMIT_CTX.test(win)) continue;
    const addr = strangerAddr(win);
    if (!addr) continue;
    return {
      key: "evm-approval",
      label: "Asks for unlimited approvals",
      note: `Code requests an unlimited token approval / permit to a hard-coded address ${addr.slice(0, 10)}... — the classic drainer move.`,
      severity: "high",
      evidence: snippet(code, m.index, Math.min(m[0].length, 24)),
    };
  }
  SAFA_CALL.lastIndex = 0;
  n = 0;
  while ((m = SAFA_CALL.exec(code)) && n++ < 50) {
    const win = code.slice(Math.max(0, m.index - WIN), m.index + WIN);
    const addr = strangerAddr(win);
    if (!addr) continue;
    return {
      key: "evm-approval",
      label: "Asks for unlimited approvals",
      note: `Code calls setApprovalForAll for a hard-coded operator ${addr.slice(0, 10)}... — hands over every NFT in the wallet.`,
      severity: "high",
      evidence: snippet(code, m.index, m[0].length),
    };
  }
  return undefined;
}

const SOL_TRANSFER = /createTransferCheckedInstruction|createTransferInstruction|SystemProgram\.transfer\b|createApproveInstruction|\bsetAuthority\b|createSetAuthorityInstruction/;
const B58_STR = /["'`][1-9A-HJ-NP-Za-km-z]{32,44}["'`]/g;
const OBF = /_0x[a-f0-9]{4,6}\b/g;

// Solana. Адаптер кошелька сам объявляет signAllTransactions, а web3.js/SDK DEX-ов строят переводы
// (Raydium зовёт SystemProgram.transfer, чтобы завернуть SOL) — на одних именах ловили бы честные dapp-ы.
// Дрейнер отличается тем, что получатель зашит: рядом с инструкцией перевода/апрува стоит литерал base58-адреса.
// Поэтому тревога — signAllTransactions в бандле + перевод с base58-литералом в окне ±400 символов.
function solanaDrain(b: Bundle): SiteFinding | undefined {
  const code = b.code;
  const sign = first(code, /signAllTransactions/);
  if (!sign) return undefined;
  const re = new RegExp(SOL_TRANSFER.source, "g");
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(code)) && n++ < 100) {
    const win = code.slice(Math.max(0, m.index - WIN), m.index + WIN);
    if (!/["'`][1-9A-HJ-NP-Za-km-z]{32,44}["'`]/.test(win)) continue;
    // Исходники spl-token/web3.js перечисляют десятки инструкций подряд — это библиотека, не дрейнер.
    if (countMatches(win, /create\w+Instruction/g, 4) >= 4) continue;
    return {
      key: "sol-drain",
      label: "Signs away Solana tokens",
      note: "Bundle builds a token/SOL transfer or authority change to a hard-coded address and asks the wallet to sign everything at once.",
      severity: "high",
      evidence: snippet(code, m.index, m[0].length),
    };
  }
  if (countMatches(code, OBF, 201) > 200 && countMatches(code, B58_STR, 21) > 20) {
    return {
      key: "sol-drain",
      label: "Signs away Solana tokens",
      note: "Obfuscated bundle with a batch-sign call and a long list of hard-coded Solana addresses.",
      severity: "high",
      evidence: snippet(code, sign.idx, sign.len),
    };
  }
  return undefined;
}

// Имена китов, в которых уверены: так их называют сами продавцы и отчёты ScamSniffer/SlowMist.
const KITS = /\b(?:Inferno|Angel|Pink|MS|Venom|Monkey|Ace|Pussy|Medusa|Atomic|Chick|Nova)\s*Drainer\b/i;
const TG_BOT = /api\.telegram\.org\/bot/i;
const WS_DRAIN = /wss?:\/\/[^"'`\s]{0,120}drain/i;

function knownKit(b: Bundle): SiteFinding | undefined {
  const code = b.code;
  const kit = first(code, KITS);
  if (kit) return { key: "kit", label: "Known drainer kit", note: `Code carries the marker of a known drainer kit (${kit.text}).`, severity: "high", evidence: snippet(code, kit.idx, kit.len) };
  const ws = first(code, WS_DRAIN);
  if (ws) return { key: "kit", label: "Known drainer kit", note: "Page talks to a websocket endpoint named after draining.", severity: "high", evidence: snippet(code, ws.idx, ws.len) };
  const word = first(code, /\bdrainer\b/i);
  if (word && /\breceiver\b|seaport/i.test(code)) {
    return { key: "kit", label: "Known drainer kit", note: "Code references a 'drainer' together with a receiver/Seaport setup.", severity: "high", evidence: snippet(code, word.idx, word.len) };
  }
  // Браузерный код не ходит в Bot API: токен бота окажется у каждого посетителя. Так дрейнеры логируют жертв.
  const tg = first(code, TG_BOT);
  if (tg) return { key: "kit", label: "Known drainer kit", note: "Browser code calls the Telegram Bot API directly — drainers log victims and wallets to TG bots this way.", severity: "high", evidence: snippet(code, tg.idx, tg.len) };
  return undefined;
}

function hidden(b: Bundle): SiteFinding | undefined {
  const code = b.code;
  const ev = first(code, /\beval\s*\(\s*atob\s*\(|new\s+Function\s*\(\s*atob\s*\(/);
  if (ev) return { key: "hidden", label: "Hidden code", note: "Code decodes and runs a hidden payload (eval/Function of base64).", severity: "medium", evidence: snippet(code, ev.idx, ev.len) };
  if (countMatches(code, OBF, 201) > 200) {
    const o = first(code, /_0x[a-f0-9]{4,6}\b/)!;
    return { key: "hidden", label: "Hidden code", note: "Heavily obfuscated script (javascript-obfuscator pattern) on a page with wallet connect.", severity: "medium", evidence: snippet(code, o.idx, o.len) };
  }
  return undefined;
}

// Есть ли в бандле что разбирать деревом: без этих слов разбор впустую тратит время.
const AST_HINT = /approve|setApprovalForAll|095ea7b3|Instruction|SystemProgram/;
const AST_BUDGET_MS = 5_000;

// Чистый анализ без сети: html страницы и тексты внешних скриптов. Экспортирован ради тестов.
export function analyzeCode(html: string, scripts: string[]): { wallet: boolean; findings: SiteFinding[] } {
  const bundles: Bundle[] = [{ name: "page", code: html }, ...scripts.map((code, i) => ({ name: `script${i}`, code }))];
  const wallet = bundles.some((b) => WALLET.test(b.code));
  const found = new Map<string, SiteFinding>();
  const add = (f?: SiteFinding) => { if (f && !found.has(f.key)) found.set(f.key, f); };
  const t0 = Date.now();
  for (const b of bundles) {
    add(knownKit(b));
    // Сначала точный разбор по дереву; не разобрался (большой или битый файл, кончился бюджет) — регулярки.
    const ast = AST_HINT.test(b.code) && Date.now() - t0 < AST_BUDGET_MS ? astScan(b.code, KNOWN_ADDR) : { ok: false, findings: [] };
    if (ast.ok) {
      for (const f of ast.findings) {
        // Перевод на зашитый адрес бывает и честным (комиссия dapp-а), дрейнер же просит подписать всё сразу.
        if (f.key === "sol-drain" && !/signAllTransactions/.test(b.code)) continue;
        if (f.key === "evm-approval" && !wallet) continue;
        add({ key: f.key, label: f.key === "evm-approval" ? "Asks for unlimited approvals" : "Signs away Solana tokens", note: f.note, severity: "high", evidence: f.evidence });
      }
      // Обфусцированный бандл дерево не прочтёт по смыслу (имена спрятаны) — для него остаётся правило регулярок.
      if (countMatches(b.code, OBF, 201) > 200) add(solanaDrain(b));
      continue;
    }
    add(solanaDrain(b));
    // Апрув без подключения кошелька ничего не сделает — без wallet не поднимаем.
    if (wallet) add(evmApproval(b));
  }
  if (wallet && !found.size) for (const b of bundles) add(hidden(b));
  if (wallet && !found.size) {
    const w = bundles.map((b) => ({ b, m: first(b.code, WALLET) })).find((x) => x.m)!;
    add({ key: "wallet", label: "Wallet connect on a meme page", note: "Site asks to connect a wallet. A meme landing page rarely needs that — never sign approvals here.", severity: "low", evidence: snippet(w.b.code, w.m!.idx, w.m!.len) });
  }
  return { wallet, findings: [...found.values()] };
}

// Скрипты страницы: внешние src (плюс modulepreload — чанки Vite/Next), без аналитики; инлайн-код отдельно.
function extract(html: string, base: URL) {
  const srcs: string[] = [];
  const inline: string[] = [];
  const push = (raw: string) => {
    try {
      const u = new URL(raw.replace(/&amp;/g, "&"), base);
      if ((u.protocol === "https:" || u.protocol === "http:") && !ANALYTICS.test(u.href) && !srcs.includes(u.href)) srcs.push(u.href);
    } catch { /* битый адрес — пропускаем */ }
  };
  const tagRe = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html))) {
    const attrs = m[1];
    const src = /\bsrc\s*=\s*["']?([^"'\s>]+)/i.exec(attrs);
    if (src) push(src[1]);
    else if (!/type\s*=\s*["']?application\/(?:ld\+)?json/i.test(attrs) && m[2].trim()) inline.push(m[2]);
  }
  const linkRe = /<link\b[^>]*rel\s*=\s*["']?modulepreload[^>]*>/gi;
  while ((m = linkRe.exec(html))) {
    const href = /\bhref\s*=\s*["']?([^"'\s>]+)/i.exec(m[0]);
    if (href) push(href[1]);
  }
  return { srcs: srcs.slice(0, SCRIPTS_LIMIT), inline };
}

async function fetchScripts(urls: string[]) {
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const out: string[] = [];
  let bytes = 0;
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next++];
      const left = deadline - Date.now();
      if (left < 500 || bytes >= TOTAL_BYTES) return;
      try {
        const body = await fetchPublicText(url, { maxBytes: Math.min(SCRIPT_MAX, TOTAL_BYTES - bytes), timeoutMs: Math.min(6_000, left) });
        bytes += body.length;
        out.push(body);
      } catch { /* один скрипт не скачался — смотрим остальные */ }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { out, bytes };
}

const g = globalThis as unknown as { __crawlhiveSiteXray?: Map<string, { at: number; ttl: number; report: SiteReport }> };

export async function xraySite(url: string): Promise<SiteReport | undefined> {
  let u: URL;
  try {
    u = checkPublicUrl(/^[a-z][a-z0-9+.-]*:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`);
  } catch {
    return undefined;
  }
  const host = u.hostname.toLowerCase();
  const cache = (g.__crawlhiveSiteXray ??= new Map());
  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.report;

  let report: SiteReport;
  try {
    const html = await fetchPublicText(u.toString(), { maxBytes: HTML_MAX, timeoutMs: HTML_TIMEOUT });
    const { srcs, inline } = extract(html, u);
    const { out, bytes } = await fetchScripts(srcs);
    const { wallet, findings } = analyzeCode(html, [...inline, ...out]);
    report = { url: u.toString(), host, scripts: srcs.length + inline.length, bytes: html.length + bytes, findings, wallet };
  } catch (e) {
    report = { url: u.toString(), host, scripts: 0, bytes: 0, findings: [], wallet: false, error: e instanceof Error ? e.message : "unreachable" };
  }
  // Ограничиваем память: выкидываем самую старую запись (Map хранит порядок вставки).
  cache.delete(host);
  while (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(host, { at: Date.now(), ttl: report.error ? ERROR_TTL : TTL, report });
  return report;
}

export function siteFactors(r: SiteReport): { label: string; impact: number; note: string }[] {
  const out: { label: string; impact: number; note: string }[] = [];
  const has = (label: string) => out.some((f) => f.label === label);
  for (const f of r.findings) {
    if (f.key === "kit") {
      if (!has("Known drainer kit")) out.push({ label: "Known drainer kit", impact: -60, note: f.note });
    } else if (f.severity === "high") {
      if (!has("Drainer signs")) out.push({ label: "Drainer signs", impact: -40, note: f.note });
    } else if (f.severity === "medium") {
      if (!has(f.label)) out.push({ label: f.label, impact: -10, note: f.note });
    } else if (!has(f.label)) out.push({ label: f.label, impact: 0, note: f.note });
  }
  return out;
}
