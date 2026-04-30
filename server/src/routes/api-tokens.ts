/**
 * Admin API for managing programmatic upload tokens.
 *
 * All endpoints require the master API_KEY (X-API-Key or Authorization: Bearer).
 *
 * GET    /api/api-tokens              List tokens (no plaintext)
 * POST   /api/api-tokens              Create a token — plaintext returned ONCE
 * PATCH  /api/api-tokens/:id          Update name/note/enabled
 * DELETE /api/api-tokens/:id          Revoke + delete (cascades history)
 * GET    /api/api-tokens/stats        Aggregate counters across all tokens
 * GET    /api/api-tokens/history      Cross-token upload history (filterable)
 * GET    /api/api-tokens/:id/history  Per-token upload history
 */

import { Hono } from "hono";
import { requireApiKey, log } from "../config.js";
import {
  listTokens,
  getTokenById,
  createToken,
  updateToken,
  deleteToken,
  listHistory,
  getStats,
  type UploadHistoryStatus,
} from "../lib/api-tokens.js";

const adminTokens = new Hono();

adminTokens.use("*", requireApiKey);

adminTokens.get("/", (c) => {
  return c.json({ data: listTokens() }, 200, { "Cache-Control": "no-cache, no-store" });
});

adminTokens.get("/stats", (c) => {
  return c.json(getStats(), 200, { "Cache-Control": "no-cache, no-store" });
});

adminTokens.post("/", async (c) => {
  let body: { name?: string; note?: string; enabled?: boolean };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Expected JSON body" }, 400);
  }
  const name = (body.name ?? "").trim();
  if (!name) return c.json({ error: "name is required" }, 400);
  if (name.length > 100) return c.json({ error: "name too long (max 100)" }, 400);

  try {
    const { token, plaintext } = createToken({
      name,
      note: body.note,
      enabled: body.enabled !== false,
    });
    return c.json({ token, plaintext }, 201);
  } catch (e) {
    log("error", "[api-tokens] create failed:", e);
    return c.json({ error: "Failed to create token" }, 500);
  }
});

adminTokens.patch("/:id", async (c) => {
  const id = c.req.param("id");
  let body: { name?: string; note?: string | null; enabled?: boolean };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Expected JSON body" }, 400);
  }
  const updated = updateToken(id, body);
  if (!updated) return c.json({ error: "Token not found" }, 404);
  return c.json({ token: updated });
});

adminTokens.delete("/:id", (c) => {
  const id = c.req.param("id");
  const ok = deleteToken(id);
  if (!ok) return c.json({ error: "Token not found" }, 404);
  log("info", `[api-tokens] revoked token ${id}`);
  return c.json({ ok: true });
});

function parseStatus(s: string | undefined): UploadHistoryStatus | undefined {
  return s === "success" || s === "duplicate" || s === "rejected" || s === "error" ? s : undefined;
}

adminTokens.get("/history", (c) => {
  const page = parseInt(c.req.query("page") ?? "1", 10);
  const limit = parseInt(c.req.query("limit") ?? "50", 10);
  const status = parseStatus(c.req.query("status"));
  const tokenId = c.req.query("tokenId") || undefined;
  const result = listHistory({ page, limit, status, tokenId });
  return c.json(result, 200, { "Cache-Control": "no-cache, no-store" });
});

adminTokens.get("/:id/history", (c) => {
  const id = c.req.param("id");
  const token = getTokenById(id);
  if (!token) return c.json({ error: "Token not found" }, 404);
  const page = parseInt(c.req.query("page") ?? "1", 10);
  const limit = parseInt(c.req.query("limit") ?? "50", 10);
  const status = parseStatus(c.req.query("status"));
  const result = listHistory({ tokenId: id, page, limit, status });
  return c.json({ token, ...result }, 200, { "Cache-Control": "no-cache, no-store" });
});

export default adminTokens;
