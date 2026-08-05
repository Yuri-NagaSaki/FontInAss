FROM oven/bun:1.3.14 AS builder

WORKDIR /build
COPY package.json bun.lock ./
COPY packages ./packages
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN bun install --frozen-lockfile

COPY server ./server
COPY web ./web
RUN bun run --cwd web build
RUN bun run --cwd server build

FROM oven/bun:1.3.14 AS runtime

RUN apt-get update -qq \
  && apt-get install -y --no-install-recommends p7zip-full \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app/server
COPY --from=builder /build/server/dist ./dist
COPY --from=builder /build/web/dist /app/web/dist
RUN mkdir -p /app/fonts /app/data

ENV PORT=3000 \
    FONT_DIR=/app/fonts \
    DB_PATH=/app/data/fontinass-v2.db \
    PENDING_DIR=/app/data/pending-v2 \
    LOG_DIR=/app/data/logs \
    CORS_ORIGIN=* \
    SUBSET_CONCURRENCY=5 \
    CACHE_MAX_ENTRIES=500 \
    PUBLIC_UPLOAD_MAX_FILES=20 \
    PUBLIC_UPLOAD_MAX_FILE_SIZE=104857600 \
    PUBLIC_UPLOAD_MAX_BATCH_SIZE=209715200 \
    PUBLIC_UPLOAD_REQUESTS_PER_MINUTE=30 \
    TOKEN_APPLICATION_DAILY_LIMIT=3 \
    LOG_LEVEL=info

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD bun -e "const h=process.env.API_KEY?{'X-API-Key':process.env.API_KEY}:{};const r=await fetch('http://localhost:3000/api/health',{headers:h});if(!r.ok)process.exit(1);const j=await r.json();if(j.version!==2)process.exit(1)" || exit 1

CMD ["bun", "dist/index.js"]
