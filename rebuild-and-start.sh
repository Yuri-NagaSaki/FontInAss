#!/usr/bin/env bash
# Build while serving, back up SQLite, then switch to a revision-labelled image.
set -Eeuo pipefail
cd "$(dirname "$0")"
mkdir -p data/backups
exec 9>data/.deploy.lock
flock -n 9 || { echo "Another deployment is running" >&2; exit 1; }
export BUILD_REVISION="$(git rev-parse HEAD)"
export FONTINASS_IMAGE_TAG="$BUILD_REVISION"
if ! git diff --quiet HEAD; then
  echo "Commit tracked changes before deployment so the image revision is reproducible" >&2
  exit 1
fi

previous="$(docker inspect --format '{{.Image}}' fontinass-local 2>/dev/null || true)"
echo "Building $BUILD_REVISION"
docker compose build

if [ -n "$previous" ]; then
  docker tag "$previous" fontinass-local:rollback
  docker exec fontinass-local bun -e 'import { Database } from "bun:sqlite"; import { mkdirSync } from "node:fs"; const dir="/app/data/backups";mkdirSync(dir,{recursive:true});const path=dir+"/fontinass-"+Date.now()+".db";const db=new Database(process.env.DB_PATH);db.run("VACUUM INTO ?",[path]);db.close();console.log("Backup: "+path);'
fi

healthy() {
  for _ in $(seq 1 24); do
    local status
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' fontinass-local 2>/dev/null || true)"
    if [ "$status" = healthy ]; then
      docker exec fontinass-local bun -e 'const r=await fetch("http://127.0.0.1:3000/api/health");const j=await r.json();if(!r.ok||j.status!=="ok"||j.version!==2)process.exit(1);'
      return $?
    fi
    if [ "$status" = unhealthy ] || [ "$status" = exited ]; then return 1; fi
    sleep 5
  done
  return 1
}

if docker compose up -d --no-build --force-recreate && healthy; then
  actual="$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' fontinass-local)"
  [ "$actual" = "$BUILD_REVISION" ] || { echo "Running revision mismatch" >&2; exit 1; }
  echo "Healthy: $actual — http://localhost:3300"
  docker compose ps
else
  docker compose logs --tail=60
  if [ -n "$previous" ]; then
    echo "Deployment failed; restoring previous image" >&2
    FONTINASS_IMAGE_TAG=rollback docker compose up -d --no-build --force-recreate
    healthy || echo "Rollback health check failed; inspect container logs" >&2
  fi
  exit 1
fi
