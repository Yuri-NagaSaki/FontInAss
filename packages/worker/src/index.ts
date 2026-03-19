/**
 * Cloudflare Worker entry point.
 * Hono app with font management and subtitle subsetting routes.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types.js";
import fontsRoute from "./routes/fonts.js";
import subsetRoute from "./routes/subset.js";

const app = new Hono<{ Bindings: Env }>();

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use("*", async (c, next) => {
  const origin = c.env.CORS_ORIGIN || "*";
  return cors({ origin, allowHeaders: ["*"], allowMethods: ["*"], exposeHeaders: ["X-Code", "X-Message"] })(c, next);
});

// ─── Routes ───────────────────────────────────────────────────────────────────
// Auth is enforced inside fontsRoute for all /api/fonts/* endpoints.
// Subset processing (/api/subset/*) is intentionally public.
app.route("/api/fonts", fontsRoute);
app.route("/api/subset", subsetRoute);

// ─── Health check (public) ────────────────────────────────────────────────────
app.get("/api/health", async (c) => {
  const result = await c.env.DB.prepare("SELECT 1 as ok").first<{ ok: number }>();
  return c.json({ status: "ok", d1: result?.ok === 1 });
});

// ─── Static assets + SPA fallback ────────────────────────────────────────────
app.all("*", (c) => {
  if (c.req.path.startsWith("/api/")) {
    return c.json({ error: "Not found" }, 404);
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
