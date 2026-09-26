# FontInAss-Local — Copilot Instructions

## What This Project Does

A local web service for embedding fonts into ASS/SSA/SRT subtitle files. It:
1. Parses subtitle files to extract referenced font names and used characters
2. Looks up those fonts in a local SQLite-backed index pointing to files in `./fonts/`
3. Subsets each font to only the needed glyphs using opentype.js
4. UUencodes and embeds the subsetted fonts directly into the subtitle file's `[Fonts]` section

The "Local" variant replaces a Cloudflare Worker version — there is no R2 storage, no edge limits; fonts live on local disk and the font index is SQLite.

## After Every Change

**Always rebuild and restart via Docker — do not run the project locally.** After any code modification, run:

```bash
bash rebuild-and-start.sh
```

This script runs `docker compose down`, `docker compose build --no-cache`, and `docker compose up -d`. The service is accessible at `http://localhost:3300` after restart.

## Runtime & Build Commands

**Runtime**: Bun (≥1.1). This project uses Bun workspaces — `server/` and `web/` are separate packages.

```bash
# Development (hot-reload server + Vite dev server in parallel)
bun run dev

# Production build (builds web/dist, server has no build step)
bun run build

# Start production server
bun run start

# Run server directly (from project root or server/)
bun run --cwd server dev   # server only, hot reload
bun run --cwd web dev      # web only, Vite

# Docker rebuild and restart (use after any code change)
bash rebuild-and-start.sh
```

There are **no test files** in this repository.

The app runs on port `3000` inside Docker, mapped to `localhost:3300` on the host.

## Architecture

### Request Flow

```
HTTP POST /api/subset
  └─ routes/subset.ts        # Parses multipart form, orchestrates pipeline
       ├─ ass-parser.ts       # Extracts font names + Unicode codepoints per font
       ├─ font-manager.ts     # Looks up fonts in SQLite by family name + weight/italic
       ├─ storage.ts          # Reads font file bytes from local disk (./fonts/)
       ├─ subsetter.ts        # opentype.js: subsets to needed glyphs
       ├─ uuencode.ts         # Encodes binary font for ASS [Fonts] section
       └─ cache.ts            # LRU cache keyed on (font-id, codepoint-set hash)
```

### Data Layers

- **`db.ts`** — SQLite via Bun's built-in `bun:sqlite`. Three tables: `font_files` (paths + hashes), `font_info` (faces with weight/italic), `font_names` (searchable names for lookup). Schema is created on startup with `CREATE TABLE IF NOT EXISTS`.
- **`storage.ts`** — Thin FS wrapper that mirrors the R2 API shape (`get`, `put`, `delete`, `list`). Includes path traversal protection (all paths must stay within `FONT_DIR`).
- **`cache.ts`** — In-memory LRU; keys include font DB id + the exact codepoint set. Cache is process-local (lost on restart).

### Frontend–Backend

- The Hono server (`server/src/index.ts`) serves the built Vue SPA from `../web/dist` as static files under `/`.
- API routes are all under `/api/`. The frontend's `web/src/api/client.ts` is the single place all fetch calls originate.
- API key auth (`X-API-Key` header) is optional. If `API_KEY` env var is set, it is required for font management routes and health check, but **not** for `/api/subset`.

## Key Conventions

### Environment Configuration

Config lives in `.env` (git-ignored); see `.env.example`. All values are read in `server/src/config.ts`. Key vars:

| Var | Default | Purpose |
|-----|---------|---------|
| `PORT` | `3000` | Server port |
| `API_KEY` | _(empty)_ | If set, required for font management routes |
| `FONT_DIR` | `./fonts` | Absolute or relative path to font storage |
| `DB_PATH` | `./data/fonts.db` | SQLite file path |
| `SUBSET_CONCURRENCY` | `5` | Max parallel font subset operations |
| `LOG_LEVEL` | `info` | `debug`/`info`/`warn`/`error` |

### API Response Codes

Non-HTTP status codes are signaled via `X-Code` header (for single-file subset responses) using constants from `server/src/types.ts`:

- `200` OK — all fonts embedded
- `201` WARN — partial success (some fonts missing)
- `300` MISSING_FONT — no fonts found at all
- `400` BAD_REQUEST
- `500` SERVER_ERROR

Multi-file requests return HTTP `207` with a JSON array, each item having its own `code`.

### Font Lookup Logic (`font-manager.ts`)

Font names in ASS files frequently differ from filesystem names (e.g., `Arial Bold` in script vs a font file that is `Arial` weight 700). The lookup normalises family names, strips weight/style suffixes, and matches by weight/italic flags separately. When multiple faces match, it scores by closeness to the requested weight.

### ASS Parsing (`ass-parser.ts`)

The parser handles:
- ASS override tags `{\fnFontName\b1\i1}` within dialogue lines
- Style section defaults
- SRT-to-ASS conversion (when `X-Srt-Format` header is set)
- Per-font codepoint accumulation — the subsetter receives only the exact Unicode characters that actually appear for each font face

### Frontend State Management

- Vue 3 Composition API throughout (no Pinia/Vuex)
- `useIndexState.ts` composable provides shared reactive state for indexing progress — used across `FontsView.vue` and the navbar indicator
- i18n via `vue-i18n`; locale keys live in `web/src/locales/{en-US,zh-CN}.ts`
- Tailwind CSS v4 (PostCSS-free, Vite plugin-based)
- Utility: `web/src/lib/cn.ts` wraps `clsx` + `tailwind-merge` — use `cn()` for conditional class strings

### Docker & Deployment

- Multi-stage Dockerfile: stage 1 builds `web/dist` with Bun, stage 2 copies built assets and server source into a clean Bun runtime image
- `./fonts/` and `./data/` are bind-mounted so font files and the SQLite database persist across container rebuilds
- After every code change, run `bash rebuild-and-start.sh` — it does `docker compose down`, `build --no-cache`, `up -d`
