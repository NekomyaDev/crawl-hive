import type { NextRequest } from "next/server";
import { handle, isAddress } from "@/lib/server/http";
import { issueNonce } from "@/lib/server/auth";
import { ApiError } from "@/lib/server/store";

export async function GET(req: NextRequest) {
  return handle(() => {
    const address = req.nextUrl.searchParams.get("address") ?? "";
    if (!isAddress(address)) throw new ApiError("Bad wallet address");
    return issueNonce(address);
  });
}
