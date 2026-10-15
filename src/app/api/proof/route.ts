// Onchain Proof: GET /api/proof — сводка и последние корни; ?q=<id сигнала | адрес токена> — лист с путём
// до корня; ?batch=<from, unix мс> — окно целиком со всеми листьями, чтобы пересобрать корень самому.
import { ApiError } from "@/lib/server/store";
import { handle } from "@/lib/server/http";
import { findProof, proofBatch, proofSummary, proofTxLogs } from "@/lib/server/proof";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const q = u.searchParams.get("q");
  const batch = u.searchParams.get("batch");
  const tx = u.searchParams.get("tx");
  return handle(async () => {
    if (tx) {
      if (!/^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(tx)) throw new ApiError("tx must be a Solana signature", 400);
      return { logs: await proofTxLogs(tx) };
    }
    if (batch) {
      const b = proofBatch(Number(batch));
      if (!b) throw new ApiError("No proof window starts at this time", 404);
      return b;
    }
    if (q != null) {
      if (q.length > 100) throw new ApiError("Query is too long", 400);
      return { matches: findProof(q) };
    }
    return proofSummary();
  });
}
