// Clean Launch на EVM-сетях. BNB Chain — four.meme: пользователь подписывает текст входа, сервер одним запросом входит
// его подписью, загружает картинку и получает у four.meme подписанные аргументы, кошелёк вызывает createToken сам
// (токен доступа живёт только внутри запроса). Robinhood Chain — лаунчпад Pons (фабрика PonsV2): кошелёк пользователя сам вызывает
// launchToken, комиссию 0.0005 ETH берёт Pons, наша — 0%. Сервер только кладёт картинку в IPFS, собирает вызов и
// после подтверждения находит адрес монеты по событию Transfer с нулевого адреса (выпуск эмиссии). Ключей у нас нет.
// ABI проверена декодированием настоящих запусков из сети, economics — защита фабрики от смены конфигурации.
import "server-only";
import { randomBytes } from "node:crypto";
import { createPublicClient, decodeEventLog, encodeFunctionData, http, parseAbi, type Hex, type Log } from "viem";
import { ApiError } from "./store";
import { launchLimit, parseCoin, pin, saveLaunch, scanAtBirth, type LaunchRecord } from "./launch";

const ZERO = "0x0000000000000000000000000000000000000000";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const BUILT_TTL = 15 * 60_000;

const PONS_ABI = parseAbi([
  "function launchToken((string name,string symbol,string logo,string description,(string twitter,string telegram,string discord,string website,string farcaster) socials,address creatorFeeRecipient,uint16 creatorTaxBps,bool buybackEnabled,bytes32 expectedEconomics,bytes32 salt) params, uint256 launchConfigId, address pairToken) payable",
  "function previewLaunchEconomics(uint256 launchConfigId, address pairToken) view returns (bytes32)",
  "function launchFee() view returns (uint256)",
  "function launchEnabled() view returns (bool)",
]);

const FOUR_ABI = parseAbi([
  "function createToken(bytes args, bytes signature) payable",
  "function _launchFee() view returns (uint256)",
  "function _tradingFeeRate() view returns (uint256)",
]);
const FOUR_API = "https://four.meme/meme-api/v1";
export const MAX_DEV_BUY_BNB = 1;

export const EVM_LAUNCH = {
  bsc: {
    chainId: 56,
    name: "BNB Chain",
    launchpad: "four.meme",
    factory: (process.env.FOUR_MANAGER?.trim() || "0x5c952063c7fc8610FFDB798152D69F0B9550762b") as Hex,
    rpc: process.env.BSC_RPC_URL?.trim() || "https://bsc-dataseed.binance.org",
    explorer: "https://bscscan.com",
  },
  robinhood: {
    chainId: 4663,
    name: "Robinhood Chain",
    launchpad: "Pons",
    factory: (process.env.PONS_FACTORY?.trim() || "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e") as Hex,
    rpc: process.env.ROBINHOOD_RPC_URL?.trim() || "https://rpc.mainnet.chain.robinhood.com",
    explorer: "https://robin.etherscan.io",
  },
} as const;
type EvmChain = keyof typeof EVM_LAUNCH;

interface Built {
  chain: EvmChain;
  creator: string;
  name: string;
  symbol: string;
  image: string;
  data: Hex;
  at: number;
}
const g = globalThis as unknown as { __crawlhiveEvmLaunch?: { built: Map<string, Built>; done: Map<string, LaunchRecord> } };
const st = () => (g.__crawlhiveEvmLaunch ??= { built: new Map(), done: new Map() });
const client = (c: EvmChain) => createPublicClient({ transport: http(EVM_LAUNCH[c].rpc, { timeout: 15_000 }) });
const isAddr = (a: string) => /^0x[a-fA-F0-9]{40}$/.test(a);

// Адрес новой монеты по чеку: стандартный выпуск ERC-20 (Transfer с нулевого адреса); если его нет — событие
// TokenCreate контракта four.meme; в крайнем случае адрес на …4444 (так four.meme подбирает адреса своих монет).
const TOKEN_CREATE = parseAbi(["event TokenCreate(address creator, address token, uint256 requestId, string name, string symbol, uint256 totalSupply, uint256 launchTime, uint256 launchFee)"]);
function tokenFromReceipt(logs: Log[], factory: string): string | null {
  const f = factory.toLowerCase();
  const mint = logs.find((l) => l.topics[0] === TRANSFER && l.topics[1] && BigInt(l.topics[1]) === 0n && l.address.toLowerCase() !== f);
  if (mint) return mint.address.toLowerCase();
  for (const l of logs.filter((x) => x.address.toLowerCase() === f)) {
    try {
      const d = decodeEventLog({ abi: TOKEN_CREATE, data: l.data, topics: l.topics as [Hex, ...Hex[]] });
      return d.args.token.toLowerCase();
    } catch {}
  }
  return logs.find((l) => /4444$/i.test(l.address) && l.address.toLowerCase() !== f)?.address.toLowerCase() ?? null;
}

export async function evmLaunchInfo(chain: EvmChain) {
  const c = EVM_LAUNCH[chain];
  if (!c) throw new ApiError("Unknown chain");
  const pc = client(chain);
  if (chain === "bsc") {
    const fee = await pc.readContract({ address: c.factory, abi: FOUR_ABI, functionName: "_launchFee" }).catch(() => null);
    return { chain, chainId: c.chainId, launchpad: c.launchpad, enabled: fee !== null, feeEth: fee == null ? null : Number(fee) / 1e18, maxDevBuy: MAX_DEV_BUY_BNB };
  }
  const [enabled, fee] = await Promise.all([
    pc.readContract({ address: c.factory, abi: PONS_ABI, functionName: "launchEnabled" }).catch(() => false),
    pc.readContract({ address: c.factory, abi: PONS_ABI, functionName: "launchFee" }).catch(() => null),
  ]);
  return { chain, chainId: c.chainId, launchpad: c.launchpad, enabled: !!enabled && !!process.env.PINATA_JWT?.trim(), feeEth: fee == null ? null : Number(fee) / 1e18 };
}

// ---------- four.meme ----------

async function four<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const r = await fetch(`${FOUR_API}${path}`, {
    ...init,
    headers: { ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...(token ? { "meme-web-access": token } : {}), ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  const j = (await r?.json().catch(() => null)) as { code?: number | string; data?: T; msg?: string } | null;
  if (!r?.ok || !j || String(j.code) !== "0") throw new ApiError(`four.meme: ${j?.msg ?? `request failed (${r?.status ?? 0})`}`, 502);
  return j.data as T;
}

// Шаг перед подписью: одноразовый nonce для текста входа «You are sign in Meme <nonce>».
export async function fourNonce(address: string) {
  const a = address.toLowerCase();
  if (!isAddr(a)) throw new ApiError("Connect an EVM wallet first");
  const nonce = await four<string>("/private/user/nonce/generate", { method: "POST", body: JSON.stringify({ accountAddress: a, verifyType: "LOGIN", networkCode: "BSC" }) });
  return { nonce, message: `You are sign in Meme ${nonce}` };
}

const toHex = (v: string): Hex => (v.startsWith("0x") ? (v as Hex) : /^[0-9a-fA-F]+$/.test(v) ? (`0x${v}` as Hex) : (`0x${Buffer.from(v, "base64").toString("hex")}` as Hex));

async function buildFour(f: ReturnType<typeof parseCoin>, creator: string, loginSig: string, devBuy: number) {
  const c = EVM_LAUNCH.bsc;
  // Вход подписью пользователя: токен доступа живёт только в этой функции.
  const token = await four<string>("/private/user/login/dex", {
    method: "POST",
    body: JSON.stringify({ region: "WEB", langType: "EN", loginIp: "", inviteCode: "", walletName: "MetaMask", verifyInfo: { address: creator, networkCode: "BSC", signature: loginSig, verifyType: "LOGIN" } }),
  });
  const form = new FormData();
  form.append("file", new Blob([Buffer.from(f.image.bytes)], { type: f.image.type }), `${f.symbol}.${f.image.type.split("/")[1]}`);
  const imgUrl = await four<string>("/private/token/upload", { method: "POST", body: form }, token);
  const config = await four<{ symbol?: string; status?: string; totalBAmount?: number | string; totalAmount?: number | string; saleRate?: number | string }[]>("/public/config");
  const raised = config.filter((x) => x.status === "PUBLISH").find((x) => x.symbol === "BNB") ?? config.find((x) => x.symbol === "BNB");
  if (!raised) throw new ApiError("four.meme: BNB launches are not available right now", 503);
  const created = await four<{ createArg: string; signature: string }>(
    "/private/token/create",
    {
      method: "POST",
      body: JSON.stringify({
        name: f.name,
        shortName: f.symbol,
        desc: f.description || f.name,
        totalSupply: raised.totalAmount !== undefined ? Number(raised.totalAmount) : 1_000_000_000,
        raisedAmount: raised.totalBAmount !== undefined ? Number(raised.totalBAmount) : 24,
        saleRate: raised.saleRate !== undefined ? Number(raised.saleRate) : 0.8,
        reserveRate: 0,
        imgUrl,
        raisedToken: raised,
        launchTime: Date.now(),
        funGroup: false,
        label: "Meme",
        lpTradingFee: 0.0025,
        preSale: String(devBuy),
        clickFun: false,
        symbol: "BNB",
        dexType: "PANCAKE_SWAP",
        rushMode: false,
        onlyMPC: false,
        feePlan: false,
        ...(f.links.website ? { webUrl: f.links.website } : {}),
        ...(f.links.twitter ? { twitterUrl: f.links.twitter } : {}),
        ...(f.links.telegram ? { telegramUrl: f.links.telegram } : {}),
      }),
    },
    token,
  );
  const pc = client("bsc");
  const [fee, rate] = await Promise.all([
    pc.readContract({ address: c.factory, abi: FOUR_ABI, functionName: "_launchFee" }),
    pc.readContract({ address: c.factory, abi: FOUR_ABI, functionName: "_tradingFeeRate" }),
  ]);
  const devWei = BigInt(Math.round(devBuy * 1e6)) * 10n ** 12n;
  const value = fee + devWei + (devWei * rate) / 10_000n;
  const data = encodeFunctionData({ abi: FOUR_ABI, functionName: "createToken", args: [toHex(created.createArg), toHex(created.signature)] });
  return { data, value, image: imgUrl };
}

export async function prepareEvmLaunch(ip: string, body: Record<string, unknown>) {
  const chain = String(body.chain ?? "") as EvmChain;
  const c = EVM_LAUNCH[chain];
  if (!c) throw new ApiError("Unknown chain");
  const creator = String(body.creator ?? "").toLowerCase();
  if (!isAddr(creator)) throw new ApiError("Connect an EVM wallet first");
  const f = parseCoin(body);
  const taxBps = Math.round(Number(body.taxBps ?? 0));
  if (chain === "robinhood" && ![0, 100, 200].includes(taxBps)) throw new ApiError("Creator fee: 0%, 1% or 2%");
  launchLimit(ip);
  if (chain === "bsc") {
    const sig = String(body.loginSignature ?? "");
    if (!/^0x[0-9a-fA-F]{130}$/.test(sig)) throw new ApiError("Sign the four.meme login message in your wallet first");
    const devBuy = body.devBuy === undefined || body.devBuy === "" ? 0 : Number(body.devBuy);
    if (!Number.isFinite(devBuy) || devBuy < 0 || devBuy > MAX_DEV_BUY_BNB) throw new ApiError(`Dev buy: 0 to ${MAX_DEV_BUY_BNB} BNB`);
    const b = await buildFour(f, creator, sig, devBuy);
    const id = randomBytes(12).toString("hex");
    const s = st();
    for (const [k, x] of s.built) if (Date.now() - x.at > BUILT_TTL) s.built.delete(k);
    s.built.set(id, { chain, creator, name: f.name, symbol: f.symbol, image: b.image, data: b.data, at: Date.now() });
    return { id, tx: { chainId: c.chainId, to: c.factory, data: b.data, value: `0x${b.value.toString(16)}` }, feeEth: Number(b.value) / 1e18 };
  }
  const pc = client(chain);
  const [enabled, fee, economics] = await Promise.all([
    pc.readContract({ address: c.factory, abi: PONS_ABI, functionName: "launchEnabled" }),
    pc.readContract({ address: c.factory, abi: PONS_ABI, functionName: "launchFee" }),
    pc.readContract({ address: c.factory, abi: PONS_ABI, functionName: "previewLaunchEconomics", args: [0n, ZERO] }),
  ]).catch(() => {
    throw new ApiError(`${c.name} is not answering right now, try again`, 502);
  });
  if (!enabled) throw new ApiError(`${c.launchpad} launches are paused right now`, 503);
  const ext = f.image.type.split("/")[1];
  const httpUrl = await pin(`${f.symbol}.${ext}`, f.image.bytes, f.image.type);
  const logo = `ipfs://${httpUrl.split("/ipfs/")[1]}`;
  const data = encodeFunctionData({
    abi: PONS_ABI,
    functionName: "launchToken",
    args: [
      {
        name: f.name,
        symbol: f.symbol,
        logo,
        description: f.description,
        socials: { twitter: f.links.twitter ?? "", telegram: f.links.telegram ?? "", discord: "", website: f.links.website ?? "", farcaster: "" },
        creatorFeeRecipient: creator as Hex,
        creatorTaxBps: taxBps,
        buybackEnabled: false,
        expectedEconomics: economics,
        salt: `0x${randomBytes(32).toString("hex")}`,
      },
      0n,
      ZERO,
    ],
  });
  const id = randomBytes(12).toString("hex");
  const s = st();
  for (const [k, b] of s.built) if (Date.now() - b.at > BUILT_TTL) s.built.delete(k);
  s.built.set(id, { chain, creator, name: f.name, symbol: f.symbol, image: httpUrl, data, at: Date.now() });
  return { id, tx: { chainId: c.chainId, to: c.factory, data, value: `0x${fee.toString(16)}` }, feeEth: Number(fee) / 1e18 };
}

// Пользователь отправил транзакцию из кошелька. Проверяем, что это ровно наш вызов от его адреса, ждём чек,
// находим монету и отправляем рой её сканировать. Пока чека нет — «pending», клиент спросит ещё раз.
export async function submitEvmLaunch(body: Record<string, unknown>) {
  const id = String(body.id ?? "");
  const hash = String(body.hash ?? "") as Hex;
  if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) throw new ApiError("Bad transaction hash");
  const s = st();
  const done = s.done.get(hash);
  if (done) return { status: "live", mint: done.mint, hash };
  const b = s.built.get(id);
  if (!b) throw new ApiError("That launch expired, start again");
  const c = EVM_LAUNCH[b.chain as EvmChain];
  const pc = client(b.chain as EvmChain);
  const tx = await pc.getTransaction({ hash }).catch(() => null);
  if (!tx) return { status: "pending", hash };
  if (tx.from.toLowerCase() !== b.creator || tx.to?.toLowerCase() !== c.factory.toLowerCase() || tx.input !== b.data) throw new ApiError("That transaction is not the launch we built");
  const receipt = await pc.getTransactionReceipt({ hash }).catch(() => null);
  if (!receipt) return { status: "pending", hash };
  if (receipt.status !== "success") {
    s.built.delete(id);
    return { status: "failed", hash };
  }
  const token = tokenFromReceipt(receipt.logs, c.factory);
  if (!token) throw new ApiError("Launched, but we could not find the token address in the receipt");
  const rec: LaunchRecord = { mint: token, name: b.name, symbol: b.symbol, image: b.image, creator: b.creator, devBuySol: 0, signature: hash, at: Date.now(), chain: b.chain };
  s.built.delete(id);
  s.done.set(hash, rec);
  saveLaunch(rec);
  scanAtBirth(rec);
  return { status: "live", mint: rec.mint, hash };
}
