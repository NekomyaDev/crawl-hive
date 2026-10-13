// Токен проекта для клиентских мест (меню, мини-апп, бот): адрес публичный и не меняется.
// Серверная логика байбека берёт адрес из TOKEN_MINT, здесь — только ссылки для людей.
export const TOKEN = {
  symbol: "CRAWLHIVE",
  mint: "D4jNDQa3Cu4v8VMCAc2z7pgGGo7aGqzjXmwGR9wapump",
  buy: "https://jup.ag/swap/SOL-D4jNDQa3Cu4v8VMCAc2z7pgGGo7aGqzjXmwGR9wapump",
  pump: "https://pump.fun/coin/D4jNDQa3Cu4v8VMCAc2z7pgGGo7aGqzjXmwGR9wapump",
  chart: "https://dexscreener.com/solana/D4jNDQa3Cu4v8VMCAc2z7pgGGo7aGqzjXmwGR9wapump",
} as const;
