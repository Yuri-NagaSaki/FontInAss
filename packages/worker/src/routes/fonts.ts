/**
 * Font management API routes.
 *
 * All routes require X-API-Key header when API_KEY secret is configured.
 *
 * GET  /api/fonts              - List indexed fonts (paginated, searchable)
 * POST /api/fonts              - Upload font file (one file per request)
 * DELETE /api/fonts/:id        - Delete a font file and all its metadata
 * DELETE /api/fonts            - Batch delete
 * GET  /api/fonts/browse       - Browse R2 bucket as a folder tree (delimiter-based)
 * GET  /api/fonts/list-keys    - Flat recursive key listing under a prefix (no font reads)
 * POST /api/fonts/index-folder - Index R2 objects by prefix or explicit keys
 */

import { Hono } from "hono";
import type { Env } from "../types.js";
import { parseFontMetadata } from "../lib/font-manager.js";

const fonts = new Hono<{ Bindings: Env }>();

// ─── Auth middleware (all font management routes) ─────────────────────────────
fonts.use("*", async (c, next) => {
  const apiKey = c.env.API_KEY;
  if (!apiKey) return next(); // no key configured = open access

  const provided =
    c.req.header("x-api-key") ??
    c.req.header("authorization")?.replace(/^Bearer\s+/i, "");

  if (provided !== apiKey) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return next();
});

// ─── Stats (requires auth) ────────────────────────────────────────────────────
fonts.get("/stats", async (c) => {
  try {
    const FOLDERS = ["CatCat-Fonts/", "FounderTypeFonts/", "Lam-Fonts/", "XZ-Fonts/"];

    const [totalResult, ...folderResults] = await Promise.all([
      c.env.DB.prepare("SELECT COUNT(*) as cnt FROM font_files").first<{ cnt: number }>(),
      ...FOLDERS.map(prefix =>
        c.env.DB.prepare(
          "SELECT COUNT(*) as cnt FROM font_files WHERE r2_key LIKE ?"
        ).bind(`${prefix}%`).first<{ cnt: number }>()
      ),
    ]);

    return c.json({
      total: totalResult?.cnt ?? 0,
      folders: FOLDERS.map((prefix, i) => ({
        prefix,
        count: folderResults[i]?.cnt ?? 0,
      })),
    });
  } catch (e) {
    return c.json({ total: 0, folders: [], error: String(e) }, 500);
  }
});

// ─── Browse R2 bucket ─────────────────────────────────────────────────────────
// Returns immediate children of a prefix using R2 delimiter listing.
// folders = sub-prefixes (directories), files = font objects at this level.

fonts.get("/browse", async (c) => {
  const { searchParams } = new URL(c.req.url);
  const prefix = searchParams.get("prefix") ?? "";
  const cursor = searchParams.get("cursor") ?? undefined;

  const listed = await c.env.FONTS_BUCKET.list({
    prefix,
    delimiter: "/",
    cursor,
    limit: 1000,
  });

  const FONT_EXTS = new Set(["ttf", "otf", "ttc", "otc"]);
  const fontObjects = listed.objects.filter((o) => {
    const ext = o.key.split(".").pop()?.toLowerCase() ?? "";
    return FONT_EXTS.has(ext);
  });

  // Batch-check which objects are already indexed in D1
  let indexedSet = new Set<string>();
  if (fontObjects.length > 0) {
    const keys = fontObjects.map((o) => o.key);
    const placeholders = keys.map(() => "?").join(",");
    const indexed = await c.env.DB.prepare(
      `SELECT r2_key FROM font_files WHERE r2_key IN (${placeholders})`
    )
      .bind(...keys)
      .all<{ r2_key: string }>();
    indexedSet = new Set((indexed.results ?? []).map((r) => r.r2_key));
  }

  return c.json({
    folders: listed.delimitedPrefixes ?? [],
    files: fontObjects.map((o) => ({
      key: o.key,
      name: o.key.split("/").pop() ?? o.key,
      size: o.size,
      indexed: indexedSet.has(o.key),
    })),
    cursor: listed.truncated ? (listed as unknown as { cursor: string }).cursor : null,
    done: !listed.truncated,
  });
});

// ─── Flat recursive key listing ───────────────────────────────────────────────
// Lists ALL font file keys under a prefix without downloading files.
// Used by the frontend to enumerate all keys before batched indexing.
// Returns up to `limit` (max 500) keys per call.

fonts.get("/list-keys", async (c) => {
  const { searchParams } = new URL(c.req.url);
  const prefix = searchParams.get("prefix") ?? "";
  const cursor = searchParams.get("cursor") ?? undefined;
  const limit = Math.min(500, Math.max(1, parseInt(searchParams.get("limit") ?? "500", 10)));

  const FONT_EXTS = new Set(["ttf", "otf", "ttc", "otc"]);

  const listed = await c.env.FONTS_BUCKET.list({
    prefix,
    cursor,
    limit,
    // No delimiter — flat recursive listing of all objects under prefix
  });

  const keys = listed.objects
    .filter((o) => FONT_EXTS.has(o.key.split(".").pop()?.toLowerCase() ?? ""))
    .map((o) => ({ key: o.key, size: o.size }));

  const nextCursor = listed.truncated
    ? (listed as unknown as { cursor: string }).cursor ?? null
    : null;

  return c.json({
    keys,
    nextCursor,
    done: !listed.truncated,
  });
});

// ─── Index R2 objects ─────────────────────────────────────────────────────────
// Index fonts in a prefix (folder) batch-by-batch, or a specific list of keys.
// Call repeatedly with `cursor` until `done: true`.

fonts.post("/index-folder", async (c) => {
  let body: { prefix?: string; cursor?: string; r2Keys?: string[]; batchSize?: number };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Expected JSON body" }, 400);
  }

  const { prefix, cursor, r2Keys, batchSize = 10 } = body;

  const FONT_EXTS = new Set(["ttf", "otf", "ttc", "otc"]);
  let objectsToProcess: { key: string; size: number }[] = [];
  let nextCursor: string | null = null;
  let done = true;

  if (r2Keys && r2Keys.length > 0) {
    // Explicit key list — index these specific files (max 50 per call)
    objectsToProcess = r2Keys
      .slice(0, 50)
      .filter((k) => FONT_EXTS.has(k.split(".").pop()?.toLowerCase() ?? ""))
      .map((k) => ({ key: k, size: 0 }));
  } else if (prefix !== undefined) {
    // List R2 objects under prefix (flat — no delimiter)
    const listed = await c.env.FONTS_BUCKET.list({
      prefix,
      cursor,
      limit: Math.min(Math.max(1, batchSize), 50),
    });
    objectsToProcess = listed.objects
      .filter((o) => FONT_EXTS.has(o.key.split(".").pop()?.toLowerCase() ?? ""))
      .map((o) => ({ key: o.key, size: o.size }));
    done = !listed.truncated;
    if (!done) {
      nextCursor = (listed as unknown as { cursor: string }).cursor ?? null;
    }
  } else {
    return c.json({ error: "Provide prefix or r2Keys" }, 400);
  }

  // Skip already-indexed keys
  let alreadyIndexed = new Set<string>();
  if (objectsToProcess.length > 0) {
    const keys = objectsToProcess.map((o) => o.key);
    const placeholders = keys.map(() => "?").join(",");
    const existing = await c.env.DB.prepare(
      `SELECT r2_key FROM font_files WHERE r2_key IN (${placeholders})`
    )
      .bind(...keys)
      .all<{ r2_key: string }>();
    alreadyIndexed = new Set((existing.results ?? []).map((r) => r.r2_key));
  }

  const toIndex = objectsToProcess.filter((o) => !alreadyIndexed.has(o.key));
  const skipped = objectsToProcess.length - toIndex.length;
  let indexed = 0;
  const errors: string[] = [];

  // Process in parallel with concurrency limit of 10
  const CONCURRENCY = 10;
  for (let i = 0; i < toIndex.length; i += CONCURRENCY) {
    const chunk = toIndex.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(async (obj) => {
        const r2Obj = await c.env.FONTS_BUCKET.get(obj.key);
        if (!r2Obj) throw new Error(`not found in R2`);
        const bytes = new Uint8Array(await r2Obj.arrayBuffer());
        const filename = obj.key.split("/").pop() ?? obj.key;
        await indexFont(c.env, filename, bytes, obj.key);
      })
    );
    for (let j = 0; j < results.length; j++) {
      if (results[j].status === "fulfilled") {
        indexed++;
      } else {
        const err = (results[j] as PromiseRejectedResult).reason;
        errors.push(`${chunk[j].key}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return c.json({ indexed, skipped, errors, nextCursor, done });
});

// ─── List indexed fonts ───────────────────────────────────────────────────────

fonts.get("/", async (c) => {
  const { searchParams } = new URL(c.req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10)));
  const search = searchParams.get("search")?.trim().toLowerCase() ?? "";
  const offset = (page - 1) * limit;

  let rows: unknown[];
  let total: number;

  if (search) {
    const countResult = await c.env.DB.prepare(`
      SELECT COUNT(DISTINCT ff.id) as cnt
      FROM font_files ff
      JOIN font_info fi ON fi.file_id = ff.id
      JOIN font_names fn ON fn.font_info_id = fi.id
      WHERE fn.name_lower LIKE ?
    `).bind(`%${search}%`).first<{ cnt: number }>();
    total = countResult?.cnt ?? 0;

    rows = await c.env.DB.prepare(`
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
    `).bind(`%${search}%`, limit, offset).all().then(r => r.results);
  } else {
    const countResult = await c.env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM font_files"
    ).first<{ cnt: number }>();
    total = countResult?.cnt ?? 0;

    rows = await c.env.DB.prepare(`
      SELECT ff.id, ff.filename, ff.size, ff.created_at,
             GROUP_CONCAT(DISTINCT fn.name_lower) as names,
             fi.weight, fi.bold, fi.italic
      FROM font_files ff
      LEFT JOIN font_info fi ON fi.file_id = ff.id
      LEFT JOIN font_names fn ON fn.font_info_id = fi.id
      GROUP BY ff.id, fi.id
      ORDER BY ff.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(limit, offset).all().then(r => r.results);
  }

  return c.json({ total, page, limit, data: rows }, 200, {
    "Cache-Control": "public, max-age=10, stale-while-revalidate=30",
  });
});

// ─── Upload font (single file per request) ────────────────────────────────────

fonts.post("/", async (c) => {
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

      // Reject oversized font files before parsing
      const MAX_FONT_BYTES = 60 * 1024 * 1024; // 60 MB
      if (bytes.length > MAX_FONT_BYTES) {
        results.push({ filename, id: "", faces: 0, error: "File too large (max 60 MB)" });
        continue;
      }

      // Sanitize X-Target-Dir: strip leading slashes, block parent traversal,
      // ensure it stays within the expected R2 key namespace.
      const rawDir = c.req.header("x-target-dir") ?? "";
      const sanitizedDir = rawDir
        .replace(/\\/g, "/")           // normalise backslashes
        .replace(/\.\.+/g, "")         // remove any .. sequences
        .replace(/^\/+/, "")           // strip leading slashes
        .replace(/\/{2,}/g, "/");      // collapse double-slashes
      const r2KeyOverride = sanitizedDir ? `${sanitizedDir}${filename}` : undefined;

      results.push(await indexFont(c.env, filename, bytes, r2KeyOverride));
    } catch (e) {
      results.push({
        filename,
        id: "",
        faces: 0,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const hasSuccess = results.some(r => !r.error);
  return c.json({ results }, hasSuccess ? 200 : 400);
});

// ─── Delete single font ───────────────────────────────────────────────────────

fonts.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    "SELECT r2_key FROM font_files WHERE id = ?"
  ).bind(id).first<{ r2_key: string }>();

  if (!row) return c.json({ error: "Font not found" }, 404);

  await c.env.FONTS_BUCKET.delete(row.r2_key);
  await c.env.DB.prepare("DELETE FROM font_files WHERE id = ?").bind(id).run();
  await c.env.CACHE.delete(`font:meta:${row.r2_key}`);

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

  const placeholders = ids.map(() => "?").join(",");
  const rows = await c.env.DB.prepare(
    `SELECT id, r2_key FROM font_files WHERE id IN (${placeholders})`
  ).bind(...ids).all<{ id: string; r2_key: string }>();

  const found = rows.results ?? [];

  await Promise.all(found.map(r => c.env.FONTS_BUCKET.delete(r.r2_key)));
  await Promise.all(found.map(r => c.env.CACHE.delete(`font:meta:${r.r2_key}`)));

  if (found.length > 0) {
    const foundIds = found.map(r => r.id);
    const fp = foundIds.map(() => "?").join(",");
    await c.env.DB.prepare(`DELETE FROM font_files WHERE id IN (${fp})`).bind(...foundIds).run();
  }

  return c.json({ deleted: found.length });
});

// ─── Helper: index a font file into D1 + KV meta cache ───────────────────────

async function indexFont(
  env: Env,
  filename: string,
  bytes: Uint8Array,
  existingR2Key?: string,
): Promise<{ filename: string; id: string; faces: number; error?: string }> {
  const faces = parseFontMetadata(bytes);
  if (faces.length === 0) {
    return { filename, id: "", faces: 0, error: "Could not parse font metadata" };
  }

  const fileId = crypto.randomUUID();
  const r2Key = existingR2Key ?? `fonts/${fileId}/${filename}`;

  if (!existingR2Key) {
    await env.FONTS_BUCKET.put(r2Key, bytes, {
      httpMetadata: { contentType: "font/" + (filename.endsWith(".otf") ? "otf" : "ttf") },
    });
  }

  const stmts: D1PreparedStatement[] = [];

  stmts.push(
    env.DB.prepare(
      "INSERT OR IGNORE INTO font_files (id, filename, r2_key, size) VALUES (?, ?, ?, ?)"
    ).bind(fileId, filename, r2Key, bytes.length)
  );

  for (const face of faces) {
    const faceId = crypto.randomUUID();
    stmts.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO font_info (id, file_id, font_index, weight, bold, italic) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(faceId, fileId, face.index, face.weight, face.bold ? 1 : 0, face.italic ? 1 : 0)
    );
    for (const name of face.familyNames) {
      stmts.push(
        env.DB.prepare(
          "INSERT OR IGNORE INTO font_names (name_lower, font_info_id) VALUES (?, ?)"
        ).bind(name.toLowerCase(), faceId)
      );
    }
  }

  await env.DB.batch(stmts);

  // Cache font metadata in KV for fast lookup during subsetting
  const metaList = faces.map(f => ({
    names: f.familyNames.map(n => n.toLowerCase()),
    weight: f.weight,
    bold: f.bold,
    italic: f.italic,
    index: f.index,
  }));
  await env.CACHE.put(`font:meta:${r2Key}`, JSON.stringify(metaList), {
    expirationTtl: 86400 * 30,
  });

  return { filename, id: fileId, faces: faces.length };
}

export default fonts;
