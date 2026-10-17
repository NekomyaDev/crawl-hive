// Clean Launch на EVM-сетях. Robinhood Chain — лаунчпад Pons (фабрика PonsV2): кошелёк пользователя сам вызывает
// launchToken, комиссию 0.0005 ETH берёт Pons, наша — 0%. Сервер только кладёт картинку в IPFS, собирает вызов и
// после подтверждения находит адрес монеты по событию Transfer с нулевого адреса (выпуск эмиссии). Ключей у нас нет.
// ABI проверена декодированием настоящих запусков из сети, economics — защита фабрики от смены конфигурации.
import "server-only";
import { randomBytes } from "node:crypto";
import { createPublicClient, encodeFunctionData, http, parseAbi, type Hex } from "viem";
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

export const EVM_LAUNCH = {
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

export async function evmLaunchInfo(chain: EvmChain) {
  const c = EVM_LAUNCH[chain];
  const pc = client(chain);
  const [enabled, fee] = await Promise.all([
    pc.readContract({ address: c.factory, abi: PONS_ABI, functionName: "launchEnabled" }).catch(() => false),
    pc.readContract({ address: c.factory, abi: PONS_ABI, functionName: "launchFee" }).catch(() => null),
  ]);
  return { chain, chainId: c.chainId, launchpad: c.launchpad, enabled: !!enabled && !!process.env.PINATA_JWT?.trim(), feeEth: fee == null ? null : Number(fee) / 1e18 };
}

export async function prepareEvmLaunch(ip: string, body: Record<string, unknown>) {
  const chain = String(body.chain ?? "") as EvmChain;
  const c = EVM_LAUNCH[chain];
  if (!c) throw new ApiError("Unknown chain");
  const creator = String(body.creator ?? "").toLowerCase();
  if (!isAddr(creator)) throw new ApiError("Connect an EVM wallet first");
  const f = parseCoin(body);
  const taxBps = Math.round(Number(body.taxBps ?? 0));
  if (![0, 100, 200].includes(taxBps)) throw new ApiError("Creator fee: 0%, 1% or 2%");
  launchLimit(ip);
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
  const mintLog = receipt.logs.find((l) => l.topics[0] === TRANSFER && l.topics[1] && BigInt(l.topics[1]) === 0n && l.address.toLowerCase() !== c.factory.toLowerCase());
  if (!mintLog) throw new ApiError("Launched, but we could not find the token address in the receipt");
  const rec: LaunchRecord = { mint: mintLog.address.toLowerCase(), name: b.name, symbol: b.symbol, image: b.image, creator: b.creator, devBuySol: 0, signature: hash, at: Date.now(), chain: b.chain };
  s.built.delete(id);
  s.done.set(hash, rec);
  saveLaunch(rec);
  scanAtBirth(rec);
  return { status: "live", mint: rec.mint, hash };
}
