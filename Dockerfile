# CrawlHive: одна стадия — next start читает next.config.ts, поэтому нужны и dev-зависимости.
FROM node:22-bookworm-slim
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
