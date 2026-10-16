// Лаунчпад, шаг 1: картинка и метаданные в IPFS, неподписанная транзакция create_v2 (плюс первая покупка автора).
// Картинка до 2 МБ в base64, поэтому лимит тела свой, больше общего.
import { ApiError } from "@/lib/server/store";
import { clientIp, handle } from "@/lib/server/http";
import { prepareLaunch } from "@/lib/server/launch";

const MAX = 3_000_000;

export async function POST(req: Request) {
  return handle(async () => {
    if (Number(req.headers.get("content-length") ?? 0) > MAX) throw new ApiError("Request body too large", 413);
    const text = await req.text();
    if (text.length > MAX) throw new ApiError("Request body too large", 413);
    let b: Record<string, unknown>;
    try {
      b = JSON.parse(text);
    } catch {
      throw new ApiError("Body must be JSON");
    }
    return prepareLaunch(clientIp(req), b ?? {});
  });
}
