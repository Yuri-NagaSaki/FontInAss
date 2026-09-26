# AniBT 字幕工坊 — repository guidance

## Product and scope

This service belongs to the AniBT community. Its user-facing name is AniBT 字幕工坊 / AniBT Subtitle Workshop; FontInAss remains the engine, repository and CLI name. Preserve existing API routes, credential boundaries and data formats. Main-site sign-in is not workshop authentication.

Use `.impeccable.md` for design context. The shared AniBT service directory is `web/src/lib/community.ts`; community copy lives in `web/src/locales/community-{zh,en}.ts`. Update both locales. Use the day/night tokens in `web/src/style.css`, the shared controls and opaque navigation. Keep all routes reachable on mobile.

## Current implementation

- Bun 1.4.0 workspaces: `packages/*`, `server`, `web`.
- Hono composition root: `server/src/container.ts`; HTTP contracts: `packages/contracts`.
- Subtitle processing, font catalog, archive sharing, access control, font submission and activity logging are separate packages.
- SQLite persists the index and metadata in `data/fontinass-v2.db`.
- Fonts live in `fonts/`; optional Cloudflare R2 stores shared archives and manifests.
- Vue 3 + Tailwind CSS v4 + vue-i18n. The Hono runtime serves `web/dist`.
- Public processing and contribution do not require a workspace credential. Group credentials can browse, download and upload fonts. Destructive maintenance and credential administration require the administrator key.

## Validation

```bash
bun install --frozen-lockfile
bun run check
```

The check runs all workspace type checks, package/server tests and the production builds. Use a Docker runtime for browser validation. Inspect desktop/mobile, light/dark, both locales, navigation, settings and the affected workflows. Do not use public contributions or comments as test data.

## Deployment

When deployment is authorized, run:

```bash
bash rebuild-and-start.sh
```

The script builds the image before recreating `fontinass-local`, preserves the `fonts/` and `data/` mounts, and waits for the v2 health contract. The container serves port 3000, bound to `127.0.0.1:3300` on the host. Never stop the running service just to compile a new image.

After deployment, verify the running container/image, `/api/health` and the affected pages at `https://font.anibt.net`. Keep secrets out of commits, tool output and browser artifacts.
