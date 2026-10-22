// Какая оценка права: v1, v2 (с 22.10 публичная) и теневая v3 по закрытым записям Track Record.
import { handle } from "@/lib/server/http";
import { trackCompare } from "@/lib/server/track";

export async function GET() {
  return handle(() => trackCompare());
}
