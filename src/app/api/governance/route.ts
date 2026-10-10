import type { NextRequest } from "next/server";
import { body, handle, walletFrom } from "@/lib/server/http";
import { createProposal, listProposals } from "@/lib/server/store";
import type { Proposal } from "@/lib/types";

export async function GET(req: NextRequest) {
  return handle(() => listProposals(walletFrom(req, false) || undefined));
}

export async function POST(req: NextRequest) {
  return handle(async () =>
    createProposal(
      walletFrom(req),
      await body<{ title: string; description: string; kind: Proposal["kind"]; options: string[]; days: number }>(req),
    ),
  );
}
