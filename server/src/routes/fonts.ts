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
 * POST /api/fonts/repair-keys  - Fix stale DB entries (e.g. migrated from R2 with r2/ prefix)
 * GET  /api/fonts/stats        - Index statistics
 */

import { Hono } from "hono";
import { config, log } from "../config.js";
import { getDb, deleteFontsByIds, findExistingKeys } from "../db.js";
import { browseLevel, listAllKeys, scanAllFonts, getFile, fileExists, deleteFile, putFile } from "../storage.js";
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

    // Count indexed fonts per top-level folder from DB
    const allRows = db.prepare<{ r2_key: string }, []>("SELECT r2_key FROM font_files").all();
    const folderCounts: Record<string, number> = {};
    for (const row of allRows) {
      const parts = row.r2_key.split("/");
      const folder = parts.length > 1 ? parts[0] + "/" : "(root)/";
      folderCounts[folder] = (folderCounts[folder] ?? 0) + 1;
    }

    // Merge in filesystem directories so empty dirs (e.g. FounderTypeFonts with no binaries yet)
    // are still visible in the stats with count=0
    const { folders: fsDirs } = browseLevel("");
    for (const dir of fsDirs) {
      if (!(dir in folderCounts)) {
        folderCounts[dir] = 0;
      }
    }

    const folders = Object.entries(folderCounts)
      .map(([prefix, count]) => ({ prefix, count }))
      .sort((a, b) => b.count - a.count);

    return c.json({ total, folders }, 200, {
      // Browser caches 60 s — reduces repeat fetches on the font management page.
      // CF bypasses this endpoint anyway (Authorization header present).
      "Cache-Control": "public, max-age=60",
    });
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
    }, 200, {
      // Short browser cache — directory listings change rarely; reduces refetches on navigation.
      "Cache-Control": "public, max-age=30",
    });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

// ─── Flat recursive key listing ───────────────────────────────────────────────

fonts.get("/list-keys", (c) => {
  const prefix = c.req.query("prefix") ?? "";
  const limit = Math.min(5000, parseInt(c.req.query("limit") ?? "5000", 10));
  const offset = Math.max(0, parseInt(c.req.query("cursor") ?? "0", 10));

  try {
    const allKeys = listAllKeys(prefix);
    const page = allKeys.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    const done = nextOffset >= allKeys.length;
    return c.json({ keys: page, nextCursor: done ? null : String(nextOffset), done }, 200, {
      "Cache-Control": "no-cache, no-store",
    });
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
        const result = await indexFont(filename, bytes, obj.key);
        if (result.error) throw new Error(result.error);
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
          const result = await indexFont(filename, bytes, obj.key);
          // indexFont returns {error} instead of throwing on soft failures
          if (result.error) throw new Error(result.error);
        })
      );
      for (let j = 0; j < results.length; j++) {
        if (results[j].status === "fulfilled") indexed++;
        else errors.push(`${chunk[j].key}: ${(results[j] as PromiseRejectedResult).reason}`);
      }
    }

    // Purge orphaned DB entries — files that no longer exist on disk
    const currentKeys = new Set(allFonts.map(f => f.key));
    const db = getDb();
    const allDbRows = db.prepare<{ id: string; r2_key: string }, []>(
      "SELECT id, r2_key FROM font_files"
    ).all();
    const orphanIds = allDbRows
      .filter(row => !currentKeys.has(row.r2_key))
      .map(row => row.id);
    if (orphanIds.length > 0) {
      deleteFontsByIds(orphanIds);
      log("info", `[scan-local] purged ${orphanIds.length} orphaned DB entries`);
    }

    return c.json({
      total: allFonts.length,
      indexed,
      skipped,
      purged: orphanIds.length,
      errors: errors.slice(0, 100),
    });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

// ─── Repair stale DB keys (e.g. migrated from Cloudflare R2) ─────────────────
//
// Fixes entries whose r2_key no longer resolves to a real file.
// Tries stripping known legacy prefixes (r2/, fonts/<uuid>/) then searches
// fontDir for a matching filename.  Updates the DB in-place; truly lost
// entries are deleted so they don't pollute font-name lookups.

fonts.post("/repair-keys", async (c) => {
  const db = getDb();
  const allRows = db.prepare<{ id: string; r2_key: string }, []>(
    "SELECT id, r2_key FROM font_files"
  ).all();

  let ok = 0;
  let updated = 0;
  let deleted = 0;

  // Build a map of basename → [key] from current fontDir for fallback search
  const allLocalFonts = scanAllFonts();
  const byBasename = new Map<string, string[]>();
  for (const { key } of allLocalFonts) {
    const base = key.split("/").pop()!.toLowerCase();
    const arr = byBasename.get(base) ?? [];
    arr.push(key);
    byBasename.set(base, arr);
  }

  const updateStmt = db.prepare<unknown, [string, string]>(
    "UPDATE font_files SET r2_key = ? WHERE id = ?"
  );
  const deleteStmt = db.prepare<unknown, [string]>(
    "DELETE FROM font_files WHERE id = ?"
  );
  const existsStmt = db.prepare<{ cnt: number }, [string]>(
    "SELECT COUNT(*) as cnt FROM font_files WHERE r2_key = ?"
  );

  const tx = db.transaction(() => {
    for (const { id, r2_key } of allRows) {
      // Already valid
      if (fileExists(r2_key)) { ok++; continue; }

      // Try known legacy prefix stripping
      const candidates: string[] = [];

      // Strip r2/ prefix (Cloudflare R2 migration)
      if (r2_key.startsWith("r2/")) candidates.push(r2_key.slice(3));

      // Strip fonts/<uuid>/ prefix (old upload path)
      const uploadMatch = r2_key.match(/^fonts\/[0-9a-f-]{36}\/(.+)$/i);
      if (uploadMatch) candidates.push(uploadMatch[1]);

      // Search by filename anywhere under fontDir
      const basename = r2_key.split("/").pop()!.toLowerCase();
      const byName = byBasename.get(basename) ?? [];
      candidates.push(...byName);

      // Use the first candidate that resolves to a real file
      const newKey = candidates.find(c => fileExists(c));
      if (newKey && newKey !== r2_key) {
        // If target key already exists in DB (e.g. scan-local already re-indexed it),
        // just delete the stale entry rather than causing a UNIQUE conflict
        const alreadyExists = (existsStmt.get(newKey)?.cnt ?? 0) > 0;
        if (alreadyExists) {
          deleteStmt.run(id);
          log("info", `[repair-keys] removed duplicate stale entry: ${r2_key} (${newKey} already indexed)`);
          deleted++;
        } else {
          updateStmt.run(newKey, id);
          log("info", `[repair-keys] ${r2_key} → ${newKey}`);
          updated++;
        }
      } else {
        // Truly orphaned — delete so lookups don't return broken paths
        deleteStmt.run(id);
        log("warn", `[repair-keys] deleted orphan: ${r2_key}`);
        deleted++;
      }
    }
  });
  tx();

  return c.json({
    total: allRows.length,
    ok,
    updated,
    deleted,
  });
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
      const pat = `%${search}%`;
      // Search font family names AND filename — GROUP BY ff.id avoids duplicates for multi-face fonts
      total = db.prepare<{ cnt: number }, [string, string]>(`
        SELECT COUNT(DISTINCT ff.id) as cnt
        FROM font_files ff
        LEFT JOIN font_info fi ON fi.file_id = ff.id
        LEFT JOIN font_names fn ON fn.font_info_id = fi.id
        WHERE fn.name_lower LIKE ? OR LOWER(ff.filename) LIKE ?
      `).get(pat, pat)?.cnt ?? 0;

      rows = db.prepare(`
        SELECT ff.id, ff.filename, ff.size, ff.created_at,
               GROUP_CONCAT(DISTINCT fn.name_lower) as names,
               MIN(fi.weight) as weight, MAX(fi.bold) as bold, MAX(fi.italic) as italic
        FROM font_files ff
        LEFT JOIN font_info fi ON fi.file_id = ff.id
        LEFT JOIN font_names fn ON fn.font_info_id = fi.id
        WHERE fn.name_lower LIKE ? OR LOWER(ff.filename) LIKE ?
        GROUP BY ff.id
        ORDER BY ff.created_at DESC
        LIMIT ? OFFSET ?
      `).all(pat, pat, limit, offset);
    } else {
      total = db.prepare<{ cnt: number }, []>("SELECT COUNT(*) as cnt FROM font_files").get()?.cnt ?? 0;

      rows = db.prepare(`
        SELECT ff.id, ff.filename, ff.size, ff.created_at,
               GROUP_CONCAT(DISTINCT fn.name_lower) as names,
               MIN(fi.weight) as weight, MAX(fi.bold) as bold, MAX(fi.italic) as italic
        FROM font_files ff
        LEFT JOIN font_info fi ON fi.file_id = ff.id
        LEFT JOIN font_names fn ON fn.font_info_id = fi.id
        GROUP BY ff.id
        ORDER BY ff.created_at DESC
        LIMIT ? OFFSET ?
      `).all(limit, offset);
    }

    // Font list is live data — never cache; uploaded fonts must appear immediately
    return c.json({ total, page, limit, data: rows }, 200, {
      "Cache-Control": "no-cache, no-store",
    });
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

      // Compute the storage key upfront so we can write the file to disk.
      // When no target dir is given, indexFont will generate its own key.
      let r2KeyOverride: string | undefined;
      if (sanitizedDir) {
        r2KeyOverride = `${sanitizedDir}${filename}`;
        // If this key already exists in the DB, remove the old entry first so the
        // re-upload is a clean replace (INSERT OR IGNORE would silently fail otherwise).
        const existing = getDb()
          .prepare<{ id: string }, [string]>("SELECT id FROM font_files WHERE r2_key = ?")
          .get(r2KeyOverride);
        if (existing) {
          deleteFontsByIds([existing.id]);
          log("debug", `[upload] replaced existing entry for ${r2KeyOverride}`);
        }
        // Write file to disk — indexFont skips putFile when existingKey is provided
        await putFile(r2KeyOverride, bytes);
      }

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
