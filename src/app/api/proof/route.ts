// Onchain Proof: GET /api/proof — сводка и последние корни; ?q=<id сигнала | адрес токена> — лист с путём
// до корня; ?batch=<from, unix мс> — окно целиком со всеми листьями, чтобы пересобрать корень самому.
import { ApiError } from "@/lib/server/store";
import { handle } from "@/lib/server/http";
import { findProof, proofBatch, proofSummary } from "@/lib/server/proof";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const q = u.searchParams.get("q");
  const batch = u.searchParams.get("batch");
  return handle(async () => {
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
