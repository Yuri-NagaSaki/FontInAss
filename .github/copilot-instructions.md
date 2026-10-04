# FontInAss contributor instructions

- Runtime: Bun 1.4.2. Keep `.bun-version`, `packageManager`, `engines.bun`, Docker stages and Bun type dependencies aligned. CI reads `.bun-version`.
- Workspaces: `packages/*`, `server`, `web`. Backend: Bun + Hono + SQLite. Frontend: Vue + Vite. CLI: Rust.
- `packages/subtitle-processing` analyses ASS/SSA/SRT and invokes HarfBuzz + FontTools through a bounded Python worker pool. Preserve original glyph outlines, positioning, vertical layout, aliases and strict missing-glyph behaviour.
- `packages/font-catalog` owns font matching and metadata. `packages/persistence` owns SQL. `packages/storage` owns validated filesystem paths and R2 access. Native font workers may receive only validated local paths, never raw client paths.
- `server/src/container.ts` owns lifecycle and dependencies. Shutdown must drain HTTP requests, stop workers and close SQLite.
- Run `bun install --frozen-lockfile`, `bun run check`, and relevant Rust tests. Root typecheck includes backend packages, server tests and benchmark scripts; Vue has its own checker.
- Validate performance in isolated Docker containers with a private SQLite snapshot and a read-only font mount. Keep the same client runtime, corpus, resource limits and warm-up for comparisons. Distinguish result-cache hits from uncached font processing. Never benchmark destructive operations against production.
- `scripts/run-performance.py` and `scripts/benchmark-performance.ts` provide the repeatable HTTP workload. `scripts/verify-shaping.py` compares subset glyph positions and outlines with original fonts.
- Keep secrets, local fonts, databases and build artifacts out of Git. Do not print `.env` or container credentials.
- Commit before production deployment. Use `./rebuild-and-start.sh`: build with cache while serving, back up SQLite, recreate, verify health and the image revision, roll back on failure. It does not stop the service during compilation.
- A deployment is complete only after checking the actual running Bun/image version and representative local and public API requests.
