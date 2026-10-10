import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
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
