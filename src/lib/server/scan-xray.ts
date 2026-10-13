// Contract X-Ray: что владелец EVM-токена может сделать с держателями. Читаем байткод из сети,
// поэтому работает и без верифицированного исходника.
// Функции контракта видны в диспетчере как 4-байтовые селекторы (PUSH4 … EQ). Сверяем их с таблицей
// известных опасных сигнатур — имя функции из байткода не достать, только хэш, поэтому таблица решает всё.
import "server-only";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "@noble/hashes/utils";
import { contractInfo } from "evmole";
import { chainRpc } from "./scan-evm";

export interface XRayPower {
  key: string; // группа: mint, blacklist, fees, …
  label: string;
  note: string;
  severity: "high" | "medium" | "low";
  fns: string[]; // найденные сигнатуры, напр. "setTaxFee(uint256)"
  inferred?: boolean; // найдено по поведению (evmole: кто что пишет в хранилище), а не по имени функции
}

export interface XRayReport {
  proxy?: { kind: "eip1967" | "eip1167" | "beacon" | "other"; impl?: string; admin?: string | null };
  codeSize: number; // байт кода (у прокси — сам прокси)
  selectors: number; // сколько функций нашли в диспетчере (прокси + реализация)
  powers: XRayPower[];
  unknown: number; // функции, которых нет ни в стандарте, ни в таблице опасных
  selfdestruct: boolean;
  delegatecall: boolean;
  roles: boolean; // AccessControl/Auth: права раздаются ролями, отказ от owner() их не снимает
  engine?: "evmole"; // поведенческий разбор сработал
}

type Group = { label: string; note: string; severity: XRayPower["severity"]; sigs: string[] };

// Опасные сигнатуры по группам. Селектор считаем из строки — руками не вбиваем, чтобы не ошибиться.
const GROUPS: Record<string, Group> = {
  upgrade: {
    label: "Upgradeable",
    note: "the team can replace the contract code at any time",
    severity: "high",
    sigs: ["upgradeTo(address)", "upgradeToAndCall(address,bytes)", "changeAdmin(address)"],
  },
  mint: {
    label: "Can mint",
    note: "the team can create new tokens and dump them on holders",
    severity: "high",
    sigs: [
      "mint(address,uint256)", "mint(uint256)", "mintTo(address,uint256)", "mintFor(address,uint256)",
      "issue(uint256)", "issue(address,uint256)", "addSupply(uint256)", "increaseSupply(uint256)",
      "mintTokens(address,uint256)", "batchMint(address[],uint256[])", "airdropMint(address[],uint256[])",
    ],
  },
  blacklist: {
    label: "Can blacklist",
    note: "the team can block your wallet from selling",
    severity: "high",
    sigs: [
      "blacklist(address)", "blacklist(address,bool)", "addToBlacklist(address)", "addToBlackList(address)",
      "removeFromBlacklist(address)", "setBlacklist(address,bool)", "setBlackList(address,bool)",
      "addBlackList(address)", "removeBlackList(address)", "blacklistAddress(address,bool)",
      "blacklistAddress(address)", "addBot(address)", "addBots(address[])", "setBots(address[],bool)",
      "setBot(address,bool)", "setIsBot(address,bool)", "blockBots(address[])", "blockBot(address)",
      "delBot(address)", "banAddress(address)", "ban(address)", "setSniper(address,bool)",
      "isBlacklisted(address,bool)", "manageBlacklist(address[],bool)", "bulkBlacklist(address[],bool)",
      "setBlacklisted(address,bool)", "freeze(address)", "freezeAccount(address,bool)",
    ],
  },
  fees: {
    label: "Tax can change",
    note: "the team can raise the buy/sell tax, up to making the token unsellable",
    severity: "high",
    sigs: [
      "setFee(uint256)", "setFee(uint256,uint256)", "setFees(uint256,uint256)", "setFees(uint256,uint256,uint256)",
      "setTaxFee(uint256)", "setTaxFeePercent(uint256)", "setSellFee(uint256)", "setBuyFee(uint256)",
      "setTax(uint256)", "setTax(uint256,uint256)", "setTaxes(uint256,uint256)", "setTaxes(uint256,uint256,uint256)",
      "updateFees(uint256,uint256)", "updateFee(uint256,uint256)", "setSellTax(uint256)", "setBuyTax(uint256)",
      "updateSellFees(uint256,uint256,uint256)", "updateBuyFees(uint256,uint256,uint256)",
      "setMarketingFee(uint256)", "setLiquidityFee(uint256)", "setLiquidityFeePercent(uint256)",
      "setTotalFees(uint256)", "setBuyFees(uint256,uint256)", "setSellFees(uint256,uint256)",
      "setBuyFees(uint256,uint256,uint256)", "setSellFees(uint256,uint256,uint256)", "setFeePercent(uint256)",
      "changeFees(uint256,uint256)", "setTransferFee(uint256)", "setBuyTaxes(uint256,uint256)",
      "setSellTaxes(uint256,uint256)", "setFeeRates(uint256,uint256)", "setTaxRate(uint256)",
      "updateBuyFees(uint256,uint256)", "updateSellFees(uint256,uint256)", "updateTransferFees(uint256,uint256)",
      "setBuyTaxRate(uint256)", "setSellTaxRate(uint256)", "setTaxRates(uint256,uint256)",
    ],
  },
  balance: {
    label: "Can seize balances",
    note: "the team can change or burn tokens in any wallet",
    severity: "high",
    sigs: ["setBalance(address,uint256)", "burn(address,uint256)", "burnFrom(address)", "adminBurn(address,uint256)", "setBalances(address[],uint256[])"],
  },
  pause: {
    label: "Can stop trading",
    note: "the team can freeze buys and sells",
    severity: "medium",
    sigs: ["pause()", "unpause()", "setTradingEnabled(bool)", "setTradingOpen(bool)", "tradingStatus(bool)", "setTrading(bool)", "enableTrading(bool)", "setPaused(bool)", "stopTrading()"],
  },
  limits: {
    label: "Sell limits",
    note: "the team can cap how much you can buy, hold or sell",
    severity: "medium",
    sigs: [
      "setMaxTxAmount(uint256)", "setMaxWalletSize(uint256)", "setMaxTxPercent(uint256)", "setMaxWallet(uint256)",
      "updateMaxTxnAmount(uint256)", "updateMaxWalletAmount(uint256)", "setMaxTx(uint256)", "setMaxTxn(uint256)",
      "setMaxWalletAmount(uint256)", "setMaxWalletPercent(uint256)", "setMaxSellAmount(uint256)",
      "setMaxBuyAmount(uint256)", "setMaxTransactionAmount(uint256)", "updateMaxWallet(uint256)",
    ],
  },
  launch: {
    label: "Trading switch",
    note: "one-shot launch switch, normal for fair launches",
    severity: "low",
    sigs: ["enableTrading()", "openTrading()", "startTrading()", "launch()"],
  },
  unlimit: {
    label: "Limits removable",
    note: "the team can only lift limits, not add them",
    severity: "low",
    sigs: ["removeLimits()", "removeAllLimits()", "disableLimits()"],
  },
  exclusion: {
    label: "Tax-free wallets",
    note: "some wallets trade without tax",
    severity: "low",
    sigs: [
      "excludeFromFee(address)", "excludeFromFees(address,bool)", "includeInFee(address)", "setExcludeFromFee(address,bool)",
      "setExcludedFromFee(address,bool)", "setExcludeFromFees(address,bool)", "setIsFeeExempt(address,bool)", "excludeMultipleAccountsFromFees(address[],bool)",
      "excludeFromMaxTransaction(address,bool)", "setIsTxLimitExempt(address,bool)", "excludeFromReward(address)",
    ],
  },
  cooldown: {
    label: "Cooldown",
    note: "the team can tune trade cooldowns or auto-swap",
    severity: "low",
    sigs: ["setCooldownEnabled(bool)", "setCooldown(uint256)", "setSwapEnabled(bool)", "setSwapAndLiquifyEnabled(bool)", "updateSwapEnabled(bool)", "setSwapTokensAtAmount(uint256)", "toggleSwapBack(bool)"],
  },
};

// Стандарт и безвредное: не считаем «неизвестными». Список честный — только то, что не даёт рычагов.
const STANDARD = [
  "name()", "symbol()", "decimals()", "totalSupply()", "balanceOf(address)", "transfer(address,uint256)",
  "transferFrom(address,address,uint256)", "approve(address,uint256)", "allowance(address,address)",
  "increaseAllowance(address,uint256)", "decreaseAllowance(address,uint256)", "owner()", "getOwner()",
  "renounceOwnership()", "transferOwnership(address)", "pendingOwner()", "acceptOwnership()",
  "permit(address,address,uint256,uint256,uint8,bytes32,bytes32)", "nonces(address)", "DOMAIN_SEPARATOR()",
  "eip712Domain()", "burn(uint256)", "burnFrom(address,uint256)", "paused()", "supportsInterface(bytes4)",
  "implementation()", "admin()", "proxiableUUID()", "uniswapV2Pair()", "uniswapV2Router()", "version()",
  "deposit()", "withdraw(uint256)", "cap()", "maxSupply()", "hasRole(bytes32,address)", "getRoleAdmin(bytes32)",
  "grantRole(bytes32,address)", "revokeRole(bytes32,address)", "renounceRole(bytes32,address)",
  "DEFAULT_ADMIN_ROLE()", "MINTER_ROLE()", "PAUSER_ROLE()",
];

// Признаки ролевого доступа: при них отказ от owner() ничего не гарантирует.
const ROLES = ["grantRole(bytes32,address)", "hasRole(bytes32,address)", "authorize(address)"];

const sel = (sig: string) => bytesToHex(keccak_256(new TextEncoder().encode(sig)).slice(0, 4));

const DANGER = new Map<string, { group: string; sig: string }>();
for (const [group, g0] of Object.entries(GROUPS)) for (const s of g0.sigs) DANGER.set(sel(s), { group, sig: s });
const KNOWN = new Set([...STANDARD.map(sel), ...DANGER.keys()]);
const ROLE_SELS = new Set(ROLES.map(sel));

export const XRAY_SIGNATURES = DANGER.size; // для отчётов и тестов

function hexBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

// Хвост solc — CBOR-метаданные, длина в последних двух байтах. В нём случаются байты 0xff/0xf4, отрезаем.
function stripMeta(code: Uint8Array): Uint8Array {
  if (code.length < 4) return code;
  const len = (code[code.length - 2] << 8) | code[code.length - 1];
  const start = code.length - 2 - len;
  if (len > 0 && start > 0 && code[start] >= 0xa1 && code[start] <= 0xa5) return code.subarray(0, start);
  return code;
}

// Проход по опкодам с пропуском данных PUSH: иначе байт внутри константы примем за SELFDESTRUCT.
export function scanCode(hex: string): { selectors: Set<string>; selfdestruct: boolean; delegatecall: boolean } {
  const code = stripMeta(hexBytes(hex));
  const selectors = new Set<string>();
  let selfdestruct = false;
  let delegatecall = false;
  for (let i = 0; i < code.length; i++) {
    const op = code[i];
    if (op === 0xff) selfdestruct = true;
    else if (op === 0xf4) delegatecall = true;
    else if (op >= 0x60 && op <= 0x7f) {
      const n = op - 0x5f;
      // PUSH4 (или PUSH3 — оптимизатор ужимает селекторы с ведущим нулём), затем EQ через 0–2 опкода (DUP/SWAP).
      if (n === 4 || n === 3) {
        let j = i + 1 + n;
        for (let k = 0; k < 3 && j < code.length; k++) {
          const o = code[j];
          if (o === 0x14) {
            selectors.add(bytesToHex(code.subarray(i + 1, i + 1 + n)).padStart(8, "0"));
            break;
          }
          if (!((o >= 0x80 && o <= 0x9f) || o === 0x50)) break; // DUPn/SWAPn/POP — терпим, остальное нет
          j++;
        }
      }
      i += n;
    }
  }
  return { selectors, selfdestruct, delegatecall };
}

// Поведенческий разбор (evmole, движок EVM-модуля REA): функции, их аргументы и раскладка хранилища —
// какие селекторы читают и пишут каждый слот. Так ловим опасные функции с незнакомыми именами:
// таблица сигнатур видит только известные имена, а скамеры свои функции переименовывают.
// По одному хранилищу блэклист не отличить от списка пулов (setAutomatedMarketMakerPair устроен так же),
// поэтому имя кандидата сначала ищем в открытой базе сигнатур и решаем по нему; без имени — только «возможно».
const TRANSFER = new Set(["a9059cbb", "23b872dd"]); // transfer, transferFrom
const TOTAL_SUPPLY = "18160ddd";
type Candidate = { sel: string; args: string; shape: "flag" | "number" | "supply" };

export function behaviour(code: string, skip: Set<string>): { cands: Candidate[]; ok: boolean } {
  let info;
  try {
    info = contractInfo(code, { selectors: true, arguments: true, stateMutability: true, storage: true });
  } catch {
    return { cands: [], ok: false };
  }
  const fns = new Map((info.functions ?? []).map((f) => [f.selector, f]));
  const out = new Map<string, Candidate>();
  for (const r of info.storage ?? []) {
    const readByTransfer = r.reads.some((x) => TRANSFER.has(x));
    for (const w of r.writes) {
      const f = fns.get(w);
      if (!f || skip.has(w) || TRANSFER.has(w) || f.stateMutability === "view" || f.stateMutability === "pure") continue;
      const args = f.arguments ?? "";
      // Инициализаторы (строки, структуры, длинные списки) пишут всё подряд один раз при создании — не рычаг.
      if (/string|\(/.test(args) || args.split(",").length > 4) continue;
      if (readByTransfer && /^mapping\(address => (bool|uint8)\)$/.test(r.type) && /address/.test(args)) out.set(w, { sel: w, args, shape: "flag" });
      else if (r.reads.includes(TOTAL_SUPPLY) && args) out.set(w, { sel: w, args, shape: "supply" });
      else if (readByTransfer && /^uint\d+$/.test(r.type) && /^uint\d+(,uint\d+)*$/.test(args) && !out.has(w)) out.set(w, { sel: w, args, shape: "number" });
    }
  }
  return { cands: [...out.values()], ok: true };
}

// Имена селекторов из открытой базы сигнатур (openchain): кэш на процесс, сбой — просто без имён.
const names = new Map<string, string | null>();
async function lookupNames(sels: string[]): Promise<void> {
  const need = sels.filter((x) => !names.has(x)).slice(0, 60);
  if (!need.length) return;
  try {
    const r = await fetch(`https://api.openchain.xyz/signature-database/v1/lookup?filter=true&function=${need.map((x) => `0x${x}`).join(",")}`, { signal: AbortSignal.timeout(3_000) });
    const j = (await r.json()) as { result?: { function?: Record<string, { name: string }[] | null> } };
    for (const x of need) names.set(x, j.result?.function?.[`0x${x}`]?.[0]?.name ?? null);
    if (names.size > 20_000) names.clear();
  } catch {}
}

const NAME_BLACKLIST = /black|bot|ban|block|frozen|freeze|deny|sniper|jail|restrict|isbad/i;
const NAME_BENIGN = /pair|pool|amm|market|exclude|exempt|whitelist|fee|reward|dividend|limit|wallet|router|migrat/i;
const NAME_MINT = /mint|issue|airdrop|reward|supply|inflat/i;
const NAME_INIT = /^(init|initialize|setup|configure)/i;
// Имя стандартной функции ERC-20 с другими аргументами или регистром (Approve(address[]) вместо approve):
// так прячут рычаг от глаз в эксплорере — частый приём honeypot-контрактов.
const STD_NAMES = new Set(["approve", "transfer", "transferfrom", "allowance", "balanceof", "increaseallowance", "decreaseallowance", "totalsupply"]);
const disguised = (name: string) => STD_NAMES.has(name.split("(")[0].toLowerCase());

async function inferPowers(code: string, skip: Set<string>): Promise<{ powers: { key: string; fns: string[] }[]; ok: boolean }> {
  const { cands, ok } = behaviour(code, skip);
  await lookupNames(cands.map((c) => c.sel));
  const found = new Map<string, string[]>();
  const add = (key: string, fn: string) => found.set(key, [...(found.get(key) ?? []), fn]);
  for (const c of cands) {
    const name = names.get(c.sel) ?? null;
    const fn = name ?? `0x${c.sel}(${c.args})`;
    if (name && NAME_INIT.test(name)) continue;
    if (name && disguised(name)) add("disguised", fn);
    else if (c.shape === "flag") {
      if (name ? NAME_BLACKLIST.test(name) : false) add("named-blacklist", fn);
      else if (!name) add("hidden-blacklist", fn);
      else if (!NAME_BENIGN.test(name)) add("hidden-flag", fn);
    } else if (c.shape === "supply") {
      if (!name || NAME_MINT.test(name)) add("hidden-supply", fn);
    } else add("hidden-setting", fn);
  }
  return { powers: [...found.entries()].map(([key, fns]) => ({ key, fns: fns.sort() })), ok };
}

const INFERRED: Record<string, Omit<XRayPower, "key" | "fns">> = {
  "named-blacklist": { label: "Can blacklist", note: "a function that flags wallets checked on every transfer (found by behaviour, name from the signature database)", severity: "high", inferred: true },
  "hidden-blacklist": { label: "Possible hidden blacklist", note: "an unnamed function sets a per-wallet flag that every transfer checks; could also be a list of pools", severity: "medium", inferred: true },
  disguised: { label: "Disguised function", note: "a function named like a standard ERC-20 call changes what transfers check: a classic honeypot trick", severity: "high", inferred: true },
  "hidden-flag": { label: "Per-wallet switch", note: "a function toggles a per-wallet flag that every transfer checks (whitelist, exemption or block list)", severity: "medium", inferred: true },
  "hidden-supply": { label: "Hidden supply control", note: "a function outside the known mint/burn writes the total supply (inferred from storage use)", severity: "medium", inferred: true },
  "hidden-setting": { label: "Hidden transfer setting", note: "a setter changes a number every transfer reads: tax, limit or threshold (inferred)", severity: "low", inferred: true },
};

const SLOT_IMPL = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const SLOT_ADMIN = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";
const SLOT_BEACON = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";
// Старые прокси OpenZeppelin/ZOS (так устроен, например, BUSD на BSC) — до EIP-1967.
const SLOT_ZOS_IMPL = "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3";
const SLOT_ZOS_ADMIN = "0x10d6a54a4754c8869d6886b5f5d7fbfa5b4522237ea5c60d11bc4e7a1ff9390b";
const MINIMAL = /^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3/;

const asAddr = (word?: string | null): string | null => {
  if (!word || word.length < 42) return null;
  const a = `0x${word.slice(-40)}`.toLowerCase();
  return /^0x0{40}$/.test(a) ? null : a;
};

const CACHE_MS = 30 * 60_000;
const CACHE_MAX = 2000;
const g = globalThis as unknown as { __crawlhiveXRay?: Map<string, { at: number; r: XRayReport | undefined }> };
const cache = () => (g.__crawlhiveXRay ??= new Map());

async function analyze(token: string, chain: string): Promise<XRayReport | undefined> {
  const slot = (s: string) => chainRpc<string>(chain, "eth_getStorageAt", [token, s, "latest"]).catch(() => null);
  const [code, impl, admin, beacon, zosImpl, zosAdmin] = await Promise.all([
    chainRpc<string>(chain, "eth_getCode", [token, "latest"]),
    slot(SLOT_IMPL), slot(SLOT_ADMIN), slot(SLOT_BEACON), slot(SLOT_ZOS_IMPL), slot(SLOT_ZOS_ADMIN),
  ]);
  if (!code || code === "0x") return undefined;
  const lower = code.toLowerCase();

  let proxy: XRayReport["proxy"];
  const m = MINIMAL.exec(lower);
  if (m) proxy = { kind: "eip1167", impl: `0x${m[1]}` };
  else if (asAddr(impl)) proxy = { kind: "eip1967", impl: asAddr(impl)!, admin: asAddr(admin) };
  else if (asAddr(beacon)) {
    // У beacon-прокси адрес реализации отдаёт сам маяк через implementation().
    const b = asAddr(beacon)!;
    const out = await chainRpc<string>(chain, "eth_call", [{ to: b, data: "0x5c60da1b" }, "latest"]).catch(() => null);
    proxy = { kind: "beacon", impl: asAddr(out) ?? undefined, admin: b };
  } else if (asAddr(zosImpl)) proxy = { kind: "other", impl: asAddr(zosImpl)!, admin: asAddr(zosAdmin) };

  const own = scanCode(lower);
  let logic = lower;
  const selectors = new Set(own.selectors);
  let { selfdestruct, delegatecall } = own;
  if (proxy?.impl) {
    // Один уровень вглубь: у прокси свои функции — пара админских, вся логика токена в реализации.
    const implCode = await chainRpc<string>(chain, "eth_getCode", [proxy.impl, "latest"]).catch(() => null);
    if (implCode && implCode !== "0x") {
      logic = implCode.toLowerCase();
      const s = scanCode(logic);
      for (const x of s.selectors) selectors.add(x);
      selfdestruct ||= s.selfdestruct;
      delegatecall ||= s.delegatecall;
    }
  }

  const found = new Map<string, string[]>();
  let unknown = 0;
  for (const s of selectors) {
    const d = DANGER.get(s);
    if (d) found.set(d.group, [...(found.get(d.group) ?? []), d.sig]);
    if (!KNOWN.has(s)) unknown++;
  }
  // Прокси с адресом реализации — апгрейд возможен, даже если upgradeTo спрятан в ProxyAdmin.
  if (proxy && !found.has("upgrade")) found.set("upgrade", []);

  // Поведенческий разбор кода логики: известные по имени функции уже учтены, ищем остальные.
  const inf = await inferPowers(logic, KNOWN);
  const order = Object.keys(GROUPS);
  const powers: XRayPower[] = [...found.entries()]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([key, fns]) => {
      const gr = GROUPS[key];
      let note = gr.note;
      if (key === "upgrade" && proxy) note += proxy.admin ? ` (upgrade admin ${proxy.admin})` : proxy.kind === "eip1167" ? " (minimal clone: only if the implementation allows it)" : "";
      return { key, label: gr.label, note, severity: gr.severity, fns: fns.sort() };
    });
  for (const p of inf.powers) {
    // Если по имени уже нашли блэклист или mint, поведенческая находка того же рода ничего не добавляет.
    if ((/blacklist/.test(p.key) && found.has("blacklist")) || (p.key === "hidden-supply" && found.has("mint"))) continue;
    powers.push({ key: p.key, ...INFERRED[p.key], fns: p.fns.slice(0, 4) });
  }
  // Клон EIP-1167 сам по себе не обновляется: убираем ложный «Upgradeable», если в реализации нет upgradeTo.
  const fixed = proxy?.kind === "eip1167" ? powers.filter((p) => p.key !== "upgrade" || p.fns.length) : powers;

  return {
    ...(proxy ? { proxy } : {}),
    codeSize: (lower.length - 2) >> 1,
    selectors: selectors.size,
    powers: fixed,
    unknown,
    selfdestruct,
    delegatecall,
    roles: [...selectors].some((s) => ROLE_SELS.has(s)),
    ...(inf.ok ? { engine: "evmole" as const } : {}),
  };
}

export async function xrayEvm(token: string, chain: string): Promise<XRayReport | undefined> {
  const key = `${chain}:${token.toLowerCase()}`;
  const hit = cache().get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.r;
  try {
    // Общий потолок 8 с: X-Ray — дополнение к скану, ждать его дольше самого скана нельзя.
    const r = await Promise.race([
      analyze(token, chain),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("xray timeout")), 8_000)),
    ]);
    const c = cache();
    if (c.size >= CACHE_MAX) c.delete(c.keys().next().value!); // Map хранит порядок вставки — первый самый старый
    c.set(key, { at: Date.now(), r });
    return r;
  } catch {
    return undefined; // сбой RPC не кэшируем — в следующий раз попробуем снова
  }
}

// Какие рычаги реально живы. Допущение: почти все опасные функции закрыты onlyOwner, поэтому после отказа
// от владения они мертвы. Ролевой доступ (AccessControl, Auth.authorize) из байткода не отличить —
// если такие селекторы есть, считаем владельца активным, даже когда owner() пуст.
// Прокси и selfdestruct от owner() не зависят: апгрейдом правит отдельный админ прокси.
export function xrayLive(x: XRayReport, ownerActive: boolean): XRayPower[] {
  const out = ownerActive || x.roles ? [...x.powers] : x.powers.filter((p) => p.key === "upgrade");
  if (x.selfdestruct)
    out.push({ key: "selfdestruct", label: "Self-destruct", note: "the contract code contains SELFDESTRUCT", severity: "high", fns: [] });
  return out;
}

const IMPACT: Record<string, number> = { disguised: -30, "named-blacklist": -25, "hidden-blacklist": -8, "hidden-supply": -10, upgrade: -20, mint: -25, blacklist: -25, fees: -15, balance: -30, pause: -10, limits: -6, selfdestruct: -15 };

// Факторы для оценки сканера. Низкая серьёзность не штрафуется: это обычные механики запуска.
export function xrayFactors(x: XRayReport, ownerActive = true): { label: string; impact: number; note: string }[] {
  return xrayLive(x, ownerActive)
    .filter((p) => p.severity !== "low" && IMPACT[p.key] !== undefined)
    .map((p) => ({ label: p.label, impact: IMPACT[p.key], note: p.fns.length ? `${p.note}: ${p.fns.join(", ")}` : p.note }));
}
