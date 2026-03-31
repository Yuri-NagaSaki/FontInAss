# ─── Build stage: frontend ────────────────────────────────────────────────────
FROM oven/bun:1 AS web-builder

WORKDIR /build/web
COPY web/package.json ./
RUN bun install

COPY web/ .
# Skip vue-tsc type-checking in Docker (checked locally); just bundle
RUN bun run vite build

# ─── Runtime stage ────────────────────────────────────────────────────────────
FROM oven/bun:1 AS runtime

WORKDIR /app/server

# Install server dependencies
COPY server/package.json ./
RUN bun install

# Copy server source
COPY server/src ./src

# Copy built frontend from web-builder
COPY --from=web-builder /build/web/dist ../web/dist

# Create default directories
RUN mkdir -p /app/fonts /app/data

# Environment defaults (override via docker-compose or --env-file)
ENV PORT=3000 \
    FONT_DIR=/app/fonts \
    DB_PATH=/app/data/fonts.db \
    CORS_ORIGIN=* \
    SUBSET_CONCURRENCY=5 \
    CACHE_MAX_ENTRIES=500 \
    LOG_LEVEL=info

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD bun -e "const h=process.env.API_KEY?{'X-API-Key':process.env.API_KEY}:{};const r=await fetch('http://localhost:3000/api/health',{headers:h});if(!r.ok)process.exit(1)" || exit 1

CMD ["bun", "src/index.ts"]
