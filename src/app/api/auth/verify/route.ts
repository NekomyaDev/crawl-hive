import type { NextRequest } from "next/server";
import { body, handle } from "@/lib/server/http";
import { verifySignIn } from "@/lib/server/auth";
import { noteSignIn } from "@/lib/server/referrals";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await body<{ address: string; nonce: string; issuedAt: string; signature: string }>(req);
    const r = verifySignIn(String(b.address), String(b.nonce), String(b.issuedAt), String(b.signature));
    noteSignIn(String(b.address)); // рефералка: когда кошелёк впервые вошёл
    return r;
  });
}
