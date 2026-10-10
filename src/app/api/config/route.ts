import { handle } from "@/lib/server/http";
import { publicConfig } from "@/lib/server/solana";

export async function GET() {
  return handle(() => publicConfig());
}
