// Сквозная проверка on-chain спавна без браузера: ключ из файла играет роль Phantom.
//   node scripts/e2e-spawn.mjs <keypair.json> [baseUrl] [tier]
import { Connection, Keypair, Transaction } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { signIn, client } from "./signin.mjs";

const [keyPath, base = "http://localhost:3000", tier = "larva"] = process.argv.slice(2);
const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyPath, "utf8"))));
const wallet = kp.publicKey.toBase58();
const conn = new Connection(process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
const token = await signIn(base, kp);
const api = client(base, token);
const call = (path, body) => api(path, "POST", body);

const input = { name: "E2E Spider", source: "onchain", chain: "solana", narratives: ["ai"], targets: ["pump.fun/new"], frequencyMin: 30, tier };
const intent = await call("/api/spawn/intent", input);
console.log("intent", intent.intentId, intent.amount, intent.unit);
const tx = Transaction.from(Buffer.from(intent.transaction, "base64"));
tx.sign(kp);
const sig = await conn.sendRawTransaction(tx.serialize());
console.log("sent", sig);
const crawler = await call("/api/spawn/confirm", { intentId: intent.intentId, signature: sig });
console.log("spawned", crawler.id, crawler.payment);

// Повторное предъявление той же транзакции должно отклоняться.
try {
  await call("/api/spawn/confirm", { intentId: intent.intentId, signature: sig });
  console.log("REPLAY ACCEPTED — BUG");
} catch (e) {
  console.log("replay rejected:", e.message);
}
