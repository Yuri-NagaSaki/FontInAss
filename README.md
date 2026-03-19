# FontInAss — ASS Subtitle Font Subsetting Service

> Upload ASS/SRT subtitles → subset only the required glyphs from fonts stored in Cloudflare R2 → download font-embedded subtitle files.  
> Everything runs from a **single Cloudflare Worker** — frontend static assets are bundled alongside the API.

---

## Architecture

```
Browser
    │
    └─► Cloudflare Worker  (https://fontinass-worker.<account>.workers.dev)
            ├── Static assets (Vue 3 SPA, served directly from CF edge)
            ├── /api/*        (Hono v4 + TypeScript API)
            │     ├── opentype.js   — font subsetting (pure JS)
            │     ├── ASS parser    — TypeScript port of analyseAss
            │     └── UUencode      — TypeScript port of Cython impl
            ├── R2            — font file storage
            ├── D1            — font metadata (SQLite)
            └── KV            — processed subtitle cache (7-day TTL)
```

A single `wrangler deploy` deploys both the API Worker code and the static frontend assets — no separate Cloudflare Pages project needed.

---

## Project Structure

```
FontInAss/
├── packages/
│   ├── worker/          # Cloudflare Worker (API + static asset host)
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── routes/
│   │   │   │   ├── fonts.ts    # Font CRUD
│   │   │   │   └── subset.ts   # Subtitle processing
│   │   │   └── lib/
│   │   │       ├── ass-parser.ts
│   │   │       ├── subsetter.ts
│   │   │       ├── font-manager.ts
│   │   │       ├── uuencode.ts
│   │   │       └── cache.ts
│   │   ├── migrations/
│   │   │   └── 0001_init.sql
│   │   └── wrangler.toml       # [assets] points to ../web/dist
│   └── web/             # Vue 3 frontend (built into packages/web/dist)
│       └── src/
│           ├── views/
│           │   ├── FontsView.vue   # Font management
│           │   └── SubsetView.vue  # Subtitle processing
│           └── api/client.ts
└── package.json         # Root: pnpm deploy = build web + wrangler deploy
```

---

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 9+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm i -g wrangler`)
- A Cloudflare account with Workers, R2, D1, and KV access

### 1 — Clone & install

```bash
git clone <repo>
cd FontInAss
pnpm install
```

### 2 — Create Cloudflare resources (first time only)

```bash
# R2 bucket
wrangler r2 bucket create fontinass-r2

# D1 database
wrangler d1 create fontinass-d1

# KV namespace
wrangler kv:namespace create CACHE
```

### 3 — Update wrangler.toml

Edit `packages/worker/wrangler.toml`, replacing the placeholder IDs with your real ones:

```toml
[[d1_databases]]
database_id = "YOUR_REAL_D1_ID"

[[kv_namespaces]]
id = "YOUR_REAL_KV_ID"
```

### 4 — Run D1 migration

```bash
# Production
wrangler d1 execute fontinass-d1 --remote --file=packages/worker/migrations/0001_init.sql
```

### 5 — Local development

```bash
# One command: Worker + static assets on http://localhost:8787
pnpm dev

# Or run the Vite dev server in parallel (hot-reload frontend, proxy API to :8787)
pnpm dev:web   # http://localhost:5173
pnpm dev       # http://localhost:8787 (in another terminal)
```

### 6 — Deploy (single command)

```bash
pnpm run release
# = pnpm build (Vite) + wrangler deploy (Worker + bundled frontend assets)
```

> ⚠️ Use `pnpm run release`, not `pnpm release` — pnpm treats bare `pnpm deploy` as a built-in workspace command.

Your site will be live at `https://fontinass-worker.<your-account>.workers.dev/`.

---

## API Reference

### Font Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/fonts` | List fonts (`?page=&limit=&search=`) |
| `POST` | `/api/fonts` | Upload font files (multipart, batch) |
| `DELETE` | `/api/fonts/:id` | Delete one font |
| `DELETE` | `/api/fonts` | Batch delete (`{ids: string[]}`) |
| `GET` | `/api/fonts/presign` | Presign R2 URL for large files |
| `POST` | `/api/fonts/index` | Index a pre-uploaded R2 object |

### Subtitle Processing

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/subset` | Process one or more subtitle files |

Request headers:

| Header | Values | Default | Description |
|--------|--------|---------|-------------|
| `X-Fonts-Check` | `true/false` | `false` | Error on missing fonts |
| `X-Clear-Fonts` | `true/false` | `false` | Remove existing embedded fonts |
| `X-Srt-Format` | `true/false` | `false` | Convert SRT→ASS before processing |
| `X-Srt-Style` | style JSON | — | Custom style for SRT conversion |
| `X-Filename` | filename | `subtitle.ass` | Used for raw body (non-multipart) |

Response headers: `X-Code` (0=OK, 1=warn, ≥500=error), `X-Message` (base64-encoded JSON array).

---

## Optional: API Key Auth

```bash
wrangler secret put API_KEY
```

All requests then require `Authorization: Bearer <key>` or `X-API-Key: <key>`.

---

## Performance Notes

- **Single Worker**: No cross-origin requests — frontend and API share the same origin.
- **Static assets served from CF edge**: `run_worker_first = false` (default) means static files bypass the Worker entirely for zero-latency delivery.
- **opentype.js**: Pure JS subsetter — no WASM, no cold-start overhead.
- **KV cache**: Identical subtitle+options combinations return cached bytes instantly (7-day TTL).
- **Parallel R2 loads**: Multiple fonts per subtitle are fetched concurrently with `Promise.all`.

