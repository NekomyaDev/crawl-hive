// Подтверждение домена для официального MCP Registry (registry.modelcontextprotocol.io): публичный ключ
// Ed25519, которым подписана публикация сервера xyz.crawlhive/crawlhive. Ключ публичный, секрета тут нет.
export function GET() {
  return new Response("v=MCPv1; k=ed25519; p=8ZgcnffSgZSf1q4t0yqbEKxqkQzAXFv4t+7oWaM5KMc=\n", { headers: { "Content-Type": "text/plain" } });
}
