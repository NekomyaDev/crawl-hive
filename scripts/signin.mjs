// Вход подписью для скриптов: node-аналог того, что делает кошелёк в браузере.
import { ed25519 } from "@noble/curves/ed25519";
import { Keypair } from "@solana/web3.js";

export async function signIn(base, kp) {
  const address = kp.publicKey.toBase58();
  const n = await (await fetch(`${base}/api/auth/nonce?address=${address}`)).json();
  const signature = Buffer.from(ed25519.sign(new TextEncoder().encode(n.message), kp.secretKey.slice(0, 32))).toString("base64");
  const r = await fetch(`${base}/api/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address, nonce: n.nonce, issuedAt: n.issuedAt, signature }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error);
  return j.token;
}

export function client(base, token) {
  return async (path, method = "GET", body) => {
    const r = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`${path}: ${j.error}`);
    return j;
  };
}

export const newKeypair = () => Keypair.generate();
