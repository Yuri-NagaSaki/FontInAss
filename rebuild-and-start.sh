#!/usr/bin/env bash
# rebuild-and-start.sh
# Rebuild the Docker image and restart the container via docker compose.
# Usage: ./rebuild-and-start.sh

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# ── Stop existing container ───────────────────────────────────────────────────
echo "⏹  Stopping container…"
docker compose down

# ── Rebuild image and start ───────────────────────────────────────────────────
echo "🔨 Building Docker image…"
docker compose build --no-cache

echo "🚀 Starting container…"
docker compose up -d

# ── Confirm it's healthy ──────────────────────────────────────────────────────
echo "⏳ Waiting for health check…"
sleep 3
if docker compose ps | grep -q "running\|Up"; then
  echo "✅ Container is up — http://localhost:3300"
  docker compose ps
else
  echo "❌ Container failed to start" >&2
  docker compose logs --tail=30
  exit 1
fi
