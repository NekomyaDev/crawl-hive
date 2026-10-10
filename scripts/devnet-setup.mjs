// Разовая настройка devnet. Создаёт кошелёк-фосет (.devnet/authority.json), пробует airdrop
// и пишет .env.local (туда же кладёт секрет фосета — файл в .gitignore). Режим берётся из аргумента: sol (по умолчанию, фаза 1) или crawl (фаза 2,
// дополнительно выпускает тестовый минт $CRAWL).
//   node scripts/devnet-setup.mjs [sol|crawl]
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createMint } from "@solana/spl-token";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

const MODE = process.argv[2] === "crawl" ? "crawl" : "sol";
const RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const KEY = ".devnet/authority.json";
const DECIMALS = 6;
const conn = new Connection(RPC, "confirmed");

mkdirSync(".devnet", { recursive: true });
const authority = existsSync(KEY)
  ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(KEY, "utf8"))))
  : Keypair.generate();
if (!existsSync(KEY)) writeFileSync(KEY, JSON.stringify([...authority.secretKey]), { mode: 0o600 });
console.log("faucet wallet", authority.publicKey.toBase58());

let bal = await conn.getBalance(authority.publicKey);
for (let i = 0; bal < 1 * LAMPORTS_PER_SOL && i < 2; i++) {
  try {
    const sig = await conn.requestAirdrop(authority.publicKey, 2 * LAMPORTS_PER_SOL);
    await conn.confirmTransaction(sig, "confirmed");
  } catch (e) {
    console.log("airdrop failed:", e.message.split("\n")[0].slice(0, 120));
  }
  bal = await conn.getBalance(authority.publicKey);
}
console.log("SOL", bal / LAMPORTS_PER_SOL);

let mint = process.env.CRAWL_MINT;
if (MODE === "crawl" && !mint) {
  if (bal < 0.01 * LAMPORTS_PER_SOL) {
    console.log("Нужен SOL на создание минта. Пополни кошелёк на https://faucet.solana.com и запусти снова.");
    process.exit(1);
  }
  mint = (await createMint(conn, authority, authority.publicKey, null, DECIMALS)).toBase58();
  console.log("mint created", mint);
}

const lines = [
  "# сгенерировано scripts/devnet-setup.mjs",
  `PAYMENT_TOKEN=${MODE}`,
  "SOLANA_CLUSTER=devnet",
  `SOLANA_RPC_URL=${RPC}`,
  `DEVNET_FAUCET_SECRET=${JSON.stringify([...authority.secretKey])}`,
];
if (MODE === "crawl") lines.push(`CRAWL_MINT=${mint}`, `CRAWL_DECIMALS=${DECIMALS}`);
writeFileSync(".env.local", lines.join("\n") + "\n");
console.log("written .env.local");
if (bal < 0.5 * LAMPORTS_PER_SOL)
  console.log(`Фосет пуст: пополни ${authority.publicKey.toBase58()} на https://faucet.solana.com, иначе кнопка «Get test SOL» не сработает.`);
