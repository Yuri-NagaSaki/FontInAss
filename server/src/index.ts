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

// HTTP request logger — active in debug mode
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  log("debug", `${c.req.method} ${c.req.path} → ${c.res.status} (${Date.now() - start}ms)`);
});

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
    return c.json({ status: "ok", db: result?.ok === 1, version: "1.0.0" }, 200, {
      "Cache-Control": "public, max-age=30",
    });
  } catch (e) {
    return c.json({ status: "error", error: String(e) }, 500);
  }
});

// Cache-Control: hashed assets are immutable (Vite embeds content hash in filename)
app.use("/assets/*", async (c, next) => {
  await next();
  c.res.headers.set("Cache-Control", "public, max-age=31536000, immutable");
});

// Cache-Control: stable static files — 1 day
app.use("/favicon.svg", async (c, next) => {
  await next();
  c.res.headers.set("Cache-Control", "public, max-age=86400");
});
app.use("/robots.txt", async (c, next) => {
  await next();
  c.res.headers.set("Cache-Control", "public, max-age=86400");
});
app.use("/sitemap.xml", async (c, next) => {
  await next();
  c.res.headers.set("Cache-Control", "public, max-age=86400");
});

// Cache-Control: SPA HTML.
// `public, max-age=0, s-maxage=300` lets Cloudflare edge-cache the HTML for 5 minutes
// (reducing origin hits) while forcing browsers to always revalidate via ETag.
// Risk: up to 5 min of stale HTML after a Docker rebuild — purge CF cache after deploys.
app.use("*", async (c, next) => {
  await next();
  if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/assets/")) return;
  const ct = c.res.headers.get("content-type") ?? "";
  if (ct.startsWith("text/html") && !c.res.headers.has("Cache-Control")) {
    c.res.headers.set("Cache-Control", "public, max-age=0, s-maxage=300");
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
