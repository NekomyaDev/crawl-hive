import type { NextRequest } from "next/server";
import { body, handle, walletFrom } from "@/lib/server/http";
import { createListing, listListings } from "@/lib/server/store";

export async function GET() {
  return handle(() => listListings());
}

export async function POST(req: NextRequest) {
  return handle(async () =>
    createListing(walletFrom(req), await body<{ crawlerId: string; type: "sale" | "rent"; price: number; rentDays?: number }>(req)),
  );
}
