/**
 * Font management API routes — local deployment version.
 *
 * Replaces R2/D1/KV with local filesystem + SQLite + in-memory cache.
 * All endpoints require X-API-Key authentication when API_KEY is configured.
 *
 * GET  /api/fonts              - List indexed fonts (paginated, searchable)
 * POST /api/fonts              - Upload font file(s)
 * DELETE /api/fonts/:id        - Delete single font
 * DELETE /api/fonts            - Batch delete
 * GET  /api/fonts/browse       - Browse local font directory tree
 * GET  /api/fonts/list-keys    - Recursive flat key listing
 * POST /api/fonts/index-folder - Index fonts in a path
 * POST /api/fonts/scan-local   - Scan entire FONT_DIR and index all fonts (local-only)
 * GET  /api/fonts/stats        - Index statistics
 */

import { Hono } from "hono";
import { config } from "../config.js";
import { getDb, deleteFontsByIds, findExistingKeys } from "../db.js";
import { browseLevel, listAllKeys, scanAllFonts, getFile, deleteFile } from "../storage.js";
import { indexFont, parseFontMetadata } from "../lib/font-manager.js";

const fonts = new Hono();

// ─── Auth middleware ───────────────────────────────────────────────────────────

fonts.use("*", async (c, next) => {
  if (!config.apiKey) return next(); // open access if not configured

  const provided =
    c.req.header("x-api-key") ??
    c.req.header("authorization")?.replace(/^Bearer\s+/i, "");

  if (provided !== config.apiKey) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return next();
});

// ─── Stats ────────────────────────────────────────────────────────────────────

fonts.get("/stats", (c) => {
  try {
    const db = getDb();
    const total = (db.prepare<{ cnt: number }, []>("SELECT COUNT(*) as cnt FROM font_files").get())?.cnt ?? 0;

    const allRows = db.prepare<{ r2_key: string }, []>("SELECT r2_key FROM font_files").all();
    const folderCounts: Record<string, number> = {};
    for (const row of allRows) {
      const parts = row.r2_key.split("/");
      const folder = parts.length > 1 ? parts[0] + "/" : "(root)/";
      folderCounts[folder] = (folderCounts[folder] ?? 0) + 1;
    }

    const folders = Object.entries(folderCounts)
      .map(([prefix, count]) => ({ prefix, count }))
      .sort((a, b) => b.count - a.count);

    return c.json({ total, folders });
  } catch (e) {
    return c.json({ total: 0, folders: [], error: String(e) }, 500);
  }
});

// ─── Browse directory tree ────────────────────────────────────────────────────

fonts.get("/browse", (c) => {
  const prefix = c.req.query("prefix") ?? "";

  try {
    const { folders, files } = browseLevel(prefix);

    // Batch-check indexed status
    const keys = files.map(f => f.key);
    const indexed = findExistingKeys(keys);

    return c.json({
      folders,
      files: files.map(f => ({ ...f, indexed: indexed.has(f.key) })),
      cursor: null,
      done: true,
    });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

// ─── Flat recursive key listing ───────────────────────────────────────────────

fonts.get("/list-keys", (c) => {
  const prefix = c.req.query("prefix") ?? "";
  const limit = Math.min(5000, parseInt(c.req.query("limit") ?? "5000", 10));

  try {
    const keys = listAllKeys(prefix).slice(0, limit);
    return c.json({ keys, nextCursor: null, done: true });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

// ─── Index a folder (or explicit key list) ────────────────────────────────────

fonts.post("/index-folder", async (c) => {
  let body: { prefix?: string; r2Keys?: string[]; batchSize?: number };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Expected JSON body" }, 400);
  }

  const { prefix, r2Keys, batchSize = 20 } = body;

  let objectsToProcess: { key: string; size: number }[] = [];

  if (r2Keys && r2Keys.length > 0) {
    objectsToProcess = r2Keys.slice(0, 200).map(k => ({ key: k, size: 0 }));
  } else if (prefix !== undefined) {
    objectsToProcess = listAllKeys(prefix).slice(0, Math.min(200, batchSize));
  } else {
    return c.json({ error: "Provide prefix or r2Keys" }, 400);
  }

  const alreadyIndexed = findExistingKeys(objectsToProcess.map(o => o.key));
  const toIndex = objectsToProcess.filter(o => !alreadyIndexed.has(o.key));
  const skipped = objectsToProcess.length - toIndex.length;
  let indexed = 0;
  const errors: string[] = [];

  const CONCURRENCY = config.subsetConcurrency;
  for (let i = 0; i < toIndex.length; i += CONCURRENCY) {
    const chunk = toIndex.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(async (obj) => {
        const bytes = await getFile(obj.key);
        if (!bytes) throw new Error("File not found on disk");
        const filename = obj.key.split("/").pop() ?? obj.key;
        await indexFont(filename, bytes, obj.key);
      })
    );
    for (let j = 0; j < results.length; j++) {
      if (results[j].status === "fulfilled") indexed++;
      else errors.push(`${chunk[j].key}: ${(results[j] as PromiseRejectedResult).reason}`);
    }
  }

  return c.json({ indexed, skipped, errors, nextCursor: null, done: true });
});

// ─── Scan local font directory (local-only endpoint) ─────────────────────────

fonts.post("/scan-local", async (c) => {
  try {
    const allFonts = scanAllFonts();
    const alreadyIndexed = findExistingKeys(allFonts.map(f => f.key));
    const toIndex = allFonts.filter(f => !alreadyIndexed.has(f.key));

    let indexed = 0;
    let skipped = alreadyIndexed.size;
    const errors: string[] = [];

    const CONCURRENCY = config.subsetConcurrency;
    for (let i = 0; i < toIndex.length; i += CONCURRENCY) {
      const chunk = toIndex.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        chunk.map(async (obj) => {
          const bytes = await getFile(obj.key);
          if (!bytes) throw new Error("File not found");
          const filename = obj.key.split("/").pop() ?? obj.key;
          await indexFont(filename, bytes, obj.key);
        })
      );
      for (let j = 0; j < results.length; j++) {
        if (results[j].status === "fulfilled") indexed++;
        else errors.push(`${chunk[j].key}: ${(results[j] as PromiseRejectedResult).reason}`);
      }
    }

    return c.json({
      total: allFonts.length,
      indexed,
      skipped,
      errors: errors.slice(0, 100),
    });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

// ─── List indexed fonts ───────────────────────────────────────────────────────

fonts.get("/", (c) => {
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10));
  const limit = Math.min(200, Math.max(1, parseInt(c.req.query("limit") ?? "50", 10)));
  const search = (c.req.query("search") ?? "").trim().toLowerCase();
  const offset = (page - 1) * limit;

  try {
    const db = getDb();
    let total: number;
    let rows: unknown[];

    if (search) {
      total = db.prepare<{ cnt: number }, [string]>(`
        SELECT COUNT(DISTINCT ff.id) as cnt
        FROM font_files ff
        JOIN font_info fi ON fi.file_id = ff.id
        JOIN font_names fn ON fn.font_info_id = fi.id
        WHERE fn.name_lower LIKE ?
      `).get(`%${search}%`)?.cnt ?? 0;

      rows = db.prepare(`
        SELECT DISTINCT ff.id, ff.filename, ff.size, ff.created_at,
               GROUP_CONCAT(DISTINCT fn.name_lower) as names,
               fi.weight, fi.bold, fi.italic
        FROM font_files ff
        JOIN font_info fi ON fi.file_id = ff.id
        JOIN font_names fn ON fn.font_info_id = fi.id
        WHERE fn.name_lower LIKE ?
        GROUP BY ff.id, fi.id
        ORDER BY ff.created_at DESC
        LIMIT ? OFFSET ?
      `).all(`%${search}%`, limit, offset);
    } else {
      total = db.prepare<{ cnt: number }, []>("SELECT COUNT(*) as cnt FROM font_files").get()?.cnt ?? 0;

      rows = db.prepare(`
        SELECT ff.id, ff.filename, ff.size, ff.created_at,
               GROUP_CONCAT(DISTINCT fn.name_lower) as names,
               fi.weight, fi.bold, fi.italic
        FROM font_files ff
        LEFT JOIN font_info fi ON fi.file_id = ff.id
        LEFT JOIN font_names fn ON fn.font_info_id = fi.id
        GROUP BY ff.id, fi.id
        ORDER BY ff.created_at DESC
        LIMIT ? OFFSET ?
      `).all(limit, offset);
    }

    return c.json({ total, page, limit, data: rows });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

// ─── Upload font(s) ───────────────────────────────────────────────────────────

fonts.post("/", async (c) => {
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json({ error: "Expected multipart/form-data" }, 400);
  }

  const files = formData.getAll("file");
  if (files.length === 0) return c.json({ error: "No files provided. Use field name 'file'" }, 400);

  const results: { filename: string; id: string; faces: number; error?: string }[] = [];

  for (const entry of files) {
    if (typeof entry === "string") continue;
    const fileEntry = entry as File;
    const filename = fileEntry.name;
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";

    if (!["ttf", "otf", "ttc", "otc"].includes(ext)) {
      results.push({ filename, id: "", faces: 0, error: "Unsupported font format" });
      continue;
    }

    try {
      const bytes = new Uint8Array(await fileEntry.arrayBuffer());
      const rawDir = c.req.header("x-target-dir") ?? "";
      const sanitizedDir = rawDir
        .replace(/\\/g, "/")
        .replace(/\.\.+/g, "")
        .replace(/^\/+/, "")
        .replace(/\/{2,}/g, "/");
      const r2KeyOverride = sanitizedDir ? `${sanitizedDir}${filename}` : undefined;

      results.push(await indexFont(filename, bytes, r2KeyOverride));
    } catch (e) {
      results.push({ filename, id: "", faces: 0, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const hasSuccess = results.some(r => !r.error);
  return c.json({ results }, hasSuccess ? 200 : 400);
});

// ─── Delete single font ───────────────────────────────────────────────────────

fonts.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const db = getDb();
  const row = db.prepare<{ r2_key: string }, [string]>(
    "SELECT r2_key FROM font_files WHERE id = ?"
  ).get(id);

  if (!row) return c.json({ error: "Font not found" }, 404);

  await deleteFile(row.r2_key);
  db.prepare("DELETE FROM font_files WHERE id = ?").run(id);

  return c.json({ ok: true });
});

// ─── Batch delete ─────────────────────────────────────────────────────────────

fonts.delete("/", async (c) => {
  let body: { ids: string[] };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Expected JSON body with {ids: string[]}" }, 400);
  }

  const { ids } = body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return c.json({ error: "ids must be a non-empty array" }, 400);
  }

  const r2Keys = deleteFontsByIds(ids);
  await Promise.all(r2Keys.map(key => deleteFile(key)));

  return c.json({ deleted: r2Keys.length });
});

export default fonts;
