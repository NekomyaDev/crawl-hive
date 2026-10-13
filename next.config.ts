import type { NextConfig } from "next";

// Заголовки безопасности. Встраивать сайт во фрейм нельзя (кликджекинг подписи и оплаты, страница OAuth),
// кроме мини-аппа /tg: веб-версия Telegram открывает его во фрейме.
const COMMON = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/((?!tg).*)", headers: [...COMMON, { key: "X-Frame-Options", value: "DENY" }, { key: "Content-Security-Policy", value: "frame-ancestors 'none'" }] },
      { source: "/tg/:path*", headers: [...COMMON, { key: "Content-Security-Policy", value: "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org" }] },
      { source: "/tg", headers: [...COMMON, { key: "Content-Security-Policy", value: "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org" }] },
    ];
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    // persist.ts читает файл состояния по пути из env — это намеренно, трассировка файлов тут не нужна.
    ignoreIssue: [{ path: "**/lib/server/persist.ts" }],
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
