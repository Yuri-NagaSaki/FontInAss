/**
 * FontInAss Local — Bun + Hono server entry point.
 *
 * Serves both the API and the built Vue frontend from a single process.
 * Run: bun src/index.ts  (or: bun --hot src/index.ts for dev)
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { config, log } from "./config.js";
import { ensureFontDir } from "./storage.js";
import { getDb } from "./db.js";
import fontsRoute from "./routes/fonts.js";
import subsetRoute from "./routes/subset.js";

// ─── Bootstrap ────────────────────────────────────────────────────────────────

ensureFontDir();
getDb(); // Initialize DB and run migrations

// ─── App ──────────────────────────────────────────────────────────────────────

const app = new Hono();

// CORS
app.use("*", async (c, next) => {
  return cors({
    origin: config.corsOrigin,
    allowHeaders: ["*"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["X-Code", "X-Message"],
  })(c, next);
});

// Routes
app.route("/api/fonts", fontsRoute);
app.route("/api/subset", subsetRoute);

// Health check
app.get("/api/health", (c) => {
  try {
    const db = getDb();
    const result = db.prepare<{ ok: number }, []>("SELECT 1 as ok").get();
    return c.json({ status: "ok", db: result?.ok === 1, version: "1.0.0" });
  } catch (e) {
    return c.json({ status: "error", error: String(e) }, 500);
  }
});

// Serve Vue frontend static files (from ../web/dist after build)
app.use("/*", serveStatic({ root: "../web/dist" }));

// SPA fallback — serve index.html for all non-API routes
app.get("*", (c) => {
  if (c.req.path.startsWith("/api/")) {
    return c.json({ error: "Not found" }, 404);
  }
  return serveStatic({ path: "../web/dist/index.html" })(c, async () => {
    return c.text("Frontend not built. Run: bun run --cwd ../web build", 404);
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

log("info", `FontInAss Local starting on port ${config.port}`);
log("info", `Font directory: ${config.fontDir}`);
log("info", `Database: ${config.dbPath}`);
log("info", `API key: ${config.apiKey ? "configured" : "NONE (open access)"}`);

export default {
  port: config.port,
  fetch: app.fetch,
  maxRequestBodySize: 200 * 1024 * 1024, // 200 MB
};
