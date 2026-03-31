/**
 * FontInAss Local — Bun + Hono server entry point.
 *
 * Serves both the API and the built Vue frontend from a single process.
 * Run: bun src/index.ts  (or: bun --hot src/index.ts for dev)
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { compress } from "hono/compress";
import { serveStatic } from "hono/bun";
import { config, log, checkApiKey, pruneOldLogs } from "./config.js";
import { ensureFontDir } from "./storage.js";
import { getDb } from "./db.js";
import fontsRoute from "./routes/fonts.js";
import subsetRoute from "./routes/subset.js";
import sharingRoute from "./routes/sharing.js";
import logsRoute from "./routes/logs.js";
import uploadRoute from "./routes/upload.js";
import { startScheduler, stopScheduler } from "./lib/scheduler.js";

// ─── Bootstrap ────────────────────────────────────────────────────────────────

ensureFontDir();
getDb(); // Initialize DB and run migrations
pruneOldLogs(); // Clean up logs older than 30 days

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

// Gzip / Brotli response compression (API JSON, HTML, JS, CSS, ASS files)
app.use("*", compress());

// Global request timeout (5 min — generous for batch subset operations)
app.use("/api/*", async (c, next) => {
  const timeoutMs = 5 * 60 * 1000;
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Request timeout")), timeoutMs);
  });
  try {
    await Promise.race([next(), timeout]);
  } catch (e: unknown) {
    if (e instanceof Error && e.message === "Request timeout") {
      return c.json({ error: "Request timeout" }, 504);
    }
    throw e;
  } finally {
    clearTimeout(timer!);
  }
});

// Routes
app.route("/api/fonts", fontsRoute);
app.route("/api/subset", subsetRoute);
app.route("/api/sharing", sharingRoute);
app.route("/api/upload", uploadRoute);
app.route("/api/logs", logsRoute);

// Health check — requires API key when configured
app.get("/api/health", (c) => {
  if (!checkApiKey(c)) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  try {
    const db = getDb();
    db.prepare<{ ok: number }, []>("SELECT 1 as ok").get();
    return c.json({ status: "ok" }, 200, {
      "Cache-Control": "no-store",
    });
  } catch (e) {
    log("error", "[health] check failed:", e);
    return c.json({ status: "error" }, 500);
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
    return c.text("Not found", 404);
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

log("info", `FontInAss Local starting on port ${config.port}`);
log("info", `Font directory: ${config.fontDir}`);
log("info", `Database: ${config.dbPath}`);
log("info", `API key: ${config.apiKey ? "configured" : "NONE (open access)"}`);

// Start periodic auto-index + auto-dedup scheduler
startScheduler();

// ─── Graceful shutdown ────────────────────────────────────────────────────────

function shutdown(signal: string) {
  log("info", `Received ${signal}, shutting down...`);
  stopScheduler();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default {
  port: config.port,
  fetch: app.fetch,
  maxRequestBodySize: 200 * 1024 * 1024, // 200 MB
};
