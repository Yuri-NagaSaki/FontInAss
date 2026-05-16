/**
 * Programmatic font upload API for third-party clients.
 *
 * Auth:
 *   X-Upload-Token: <token>
 *   — or —
 *   Authorization: Bearer <token>
 *
 * Endpoint:
 *   POST /api/v1/upload   multipart/form-data, field "file" (one or many)
 *
 * Behaviour:
 *   - No rate limiting and no per-request size limit beyond the global
 *     200 MB body cap configured in src/index.ts.
 *   - Every accepted file is content-hashed (SHA-256). If the same hash is
 *     already present in font_files, the upload is recorded as a "duplicate"
 *     and the existing entry is reused — keeping the index immune to spam.
 *   - Otherwise the font is validated (extension + magic bytes + sfnt/TTC
 *     table structure), stored under <UPLOAD_TARGET_DIR> (default CatCat-Fonts/), and
 *     indexed into SQLite.
 *   - Each attempt (success / duplicate / rejected / error) is logged in
 *     api_upload_history for the admin dashboard.
 */

import { Hono } from "hono";
import { createHash } from "node:crypto";
import { config, log } from "../config.js";
import { getDb } from "../db.js";
import { putFile } from "../storage.js";
import { indexFont } from "../lib/font-manager.js";
import { validateFontFile } from "../lib/font-validator.js";
import {
  extractToken,
  verifyToken,
  markTokenUsed,
  recordUpload,
  type UploadHistoryStatus,
} from "../lib/api-tokens.js";

const apiUpload = new Hono();

interface ResultEntry {
  filename: string;
  status: UploadHistoryStatus;
  id: string;
  faces: number;
  size: number;
  sha256?: string;
  error?: string;
}

apiUpload.post("/upload", async (c) => {
  const token = extractToken(c.req.header("x-upload-token"), c.req.header("authorization"));
  if (!token) {
    return c.json({ error: "Missing upload token (X-Upload-Token or Authorization: Bearer)" }, 401);
  }

  const tokenRow = verifyToken(token);
  if (!tokenRow) {
    return c.json({ error: "Invalid or disabled token" }, 401);
  }

  const clientIp =
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    null;
  const userAgent = c.req.header("user-agent") ?? null;

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json({ error: "Expected multipart/form-data" }, 400);
  }

  const files = formData.getAll("file");
  if (files.length === 0) {
    return c.json({ error: "No files provided. Use field name 'file'" }, 400);
  }

  const results: ResultEntry[] = [];
  const db = getDb();
  let acceptedBytes = 0;

  for (const entry of files) {
    if (typeof entry === "string") continue;
    const fileEntry = entry as File;
    const filename = fileEntry.name;

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await fileEntry.arrayBuffer());
    } catch (e) {
      const msg = `Failed to read upload: ${e instanceof Error ? e.message : String(e)}`;
      results.push({ filename, status: "error", id: "", faces: 0, size: 0, error: msg });
      recordUpload({
        tokenId: tokenRow.id,
        fontFileId: null,
        filename,
        size: 0,
        sha256: null,
        status: "error",
        error: msg,
        clientIp,
        userAgent,
      });
      continue;
    }

    // Validate (extension + magic bytes + sfnt/TTC table structure)
    const validation = validateFontFile(filename, bytes);
    if (!validation.valid) {
      results.push({
        filename,
        status: "rejected",
        id: "",
        faces: 0,
        size: bytes.length,
        error: validation.error,
      });
      recordUpload({
        tokenId: tokenRow.id,
        fontFileId: null,
        filename,
        size: bytes.length,
        sha256: null,
        status: "rejected",
        error: validation.error,
        clientIp,
        userAgent,
      });
      log("warn", `[api-upload] rejected ${filename} from token ${tokenRow.prefix}: ${validation.error}`);
      continue;
    }

    const sha256 = createHash("sha256").update(bytes).digest("hex");

    // Hash-based dedup: reuse existing entry instead of writing a new file
    const existing = db
      .prepare<{ id: string; faces: number }, [string]>(
        `SELECT ff.id as id,
                (SELECT COUNT(*) FROM font_info fi WHERE fi.file_id = ff.id) as faces
           FROM font_files ff
          WHERE ff.sha256 = ?
          LIMIT 1`,
      )
      .get(sha256);

    if (existing) {
      results.push({
        filename,
        status: "duplicate",
        id: existing.id,
        faces: existing.faces,
        size: bytes.length,
        sha256,
      });
      recordUpload({
        tokenId: tokenRow.id,
        fontFileId: existing.id,
        filename,
        size: bytes.length,
        sha256,
        status: "duplicate",
        clientIp,
        userAgent,
      });
      acceptedBytes += bytes.length;
      log("info", `[api-upload] dedup hit for ${filename} (token ${tokenRow.prefix}) → ${existing.id}`);
      continue;
    }

    // Brand-new file → write under <upload-target>/<safe-filename>  (CatCat-Fonts/)
    const safeName = filename.replace(/[/\\]/g, "_");
    const baseKey = `${config.uploadTargetDir}${safeName}`;
    let r2Key = baseKey;

    // Avoid overwriting an existing file with a different hash by suffixing.
    const existingByKey = db
      .prepare<{ id: string }, [string]>("SELECT id FROM font_files WHERE r2_key = ?")
      .get(r2Key);
    if (existingByKey) {
      const dot = safeName.lastIndexOf(".");
      const stem = dot > 0 ? safeName.slice(0, dot) : safeName;
      const ext = dot > 0 ? safeName.slice(dot) : "";
      r2Key = `${config.uploadTargetDir}${stem}-${sha256.slice(0, 8)}${ext}`;
    }

    try {
      await putFile(r2Key, bytes);
      const indexed = await indexFont(filename, bytes, r2Key);
      if (indexed.error || !indexed.id) {
        const errMsg = indexed.error ?? "Failed to index font";
        results.push({ filename, status: "error", id: "", faces: 0, size: bytes.length, sha256, error: errMsg });
        recordUpload({
          tokenId: tokenRow.id,
          fontFileId: null,
          filename,
          size: bytes.length,
          sha256,
          status: "error",
          error: errMsg,
          clientIp,
          userAgent,
        });
        continue;
      }

      // Persist sha256 on the new font_files row so future dedup is instant.
      db.prepare("UPDATE font_files SET sha256 = ? WHERE id = ?").run(sha256, indexed.id);

      results.push({
        filename,
        status: "success",
        id: indexed.id,
        faces: indexed.faces,
        size: bytes.length,
        sha256,
      });
      recordUpload({
        tokenId: tokenRow.id,
        fontFileId: indexed.id,
        filename,
        size: bytes.length,
        sha256,
        status: "success",
        clientIp,
        userAgent,
      });
      acceptedBytes += bytes.length;
      log("info", `[api-upload] accepted ${filename} (${(bytes.length / 1024).toFixed(1)} KB, token ${tokenRow.prefix})`);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      results.push({ filename, status: "error", id: "", faces: 0, size: bytes.length, sha256, error: errMsg });
      recordUpload({
        tokenId: tokenRow.id,
        fontFileId: null,
        filename,
        size: bytes.length,
        sha256,
        status: "error",
        error: errMsg,
        clientIp,
        userAgent,
      });
      log("error", `[api-upload] failed processing ${filename}:`, e);
    }
  }

  // Bump the token counters once per request — count both fresh and dedup
  // accepts, but skip purely rejected/errored requests.
  if (acceptedBytes > 0 || results.some(r => r.status === "success" || r.status === "duplicate")) {
    markTokenUsed(tokenRow.id, acceptedBytes, clientIp);
  }

  const summary = {
    accepted: results.filter(r => r.status === "success").length,
    duplicate: results.filter(r => r.status === "duplicate").length,
    rejected: results.filter(r => r.status === "rejected").length,
    error: results.filter(r => r.status === "error").length,
  };

  const statusCode = results.some(r => r.status === "success" || r.status === "duplicate")
    ? 200
    : results.some(r => r.status === "rejected")
      ? 400
      : 500;

  return c.json({ summary, results }, statusCode);
});

// Lightweight token verification endpoint — useful for clients to test creds.
apiUpload.get("/whoami", (c) => {
  const token = extractToken(c.req.header("x-upload-token"), c.req.header("authorization"));
  if (!token) return c.json({ error: "Missing token" }, 401);
  const row = verifyToken(token);
  if (!row) return c.json({ error: "Invalid or disabled token" }, 401);
  return c.json({
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    upload_count: row.upload_count,
    total_bytes: row.total_bytes,
    last_used_at: row.last_used_at,
  });
});

export default apiUpload;
