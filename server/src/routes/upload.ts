/**
 * Public font upload route — no API key required.
 *
 * POST /api/upload  — accepts multipart/form-data with field "file"
 *
 * Strict validation ensures only genuine font files are accepted:
 *  1. Extension whitelist (.ttf/.otf/.ttc/.otc)
 *  2. Magic-byte signature check
 *  3. File size limit (default 30 MB)
 *  4. opentype.js structural parse
 *
 * Accepted fonts are stored under UPLOAD_TARGET_DIR (default "CatCat-Fonts/")
 * inside FONT_DIR and indexed into SQLite.
 */

import { Hono } from "hono";
import { config, log } from "../config.js";
import { getDb, deleteFontsByIds } from "../db.js";
import { putFile } from "../storage.js";
import { indexFont } from "../lib/font-manager.js";
import { validateFontFile } from "../lib/font-validator.js";

const upload = new Hono();

upload.post("/", async (c) => {
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

    try {
      const bytes = new Uint8Array(await fileEntry.arrayBuffer());

      // ── Multi-layer validation ──────────────────────────────────────────
      const validation = validateFontFile(filename, bytes, config.uploadMaxFileSize);
      if (!validation.valid) {
        log("warn", `[upload] rejected ${filename}: ${validation.error}`);
        results.push({ filename, id: "", faces: 0, error: validation.error });
        continue;
      }

      // ── Store & index ───────────────────────────────────────────────────
      const r2Key = `${config.uploadTargetDir}${filename}`;

      // If this key already exists, replace it cleanly
      const existing = getDb()
        .prepare<{ id: string }, [string]>("SELECT id FROM font_files WHERE r2_key = ?")
        .get(r2Key);
      if (existing) {
        deleteFontsByIds([existing.id]);
        log("debug", `[upload] replaced existing entry for ${r2Key}`);
      }

      await putFile(r2Key, bytes);
      const result = await indexFont(filename, bytes, r2Key);

      if (result.error) {
        // Should not happen after validation, but handle gracefully
        log("warn", `[upload] index warning for ${filename}: ${result.error}`);
      }

      results.push(result);
      log("info", `[upload] accepted ${filename} (${(bytes.length / 1024).toFixed(1)} KB, ${result.faces} face(s))`);
    } catch (e) {
      log("error", `[upload] error processing ${filename}:`, e);
      results.push({ filename, id: "", faces: 0, error: "Failed to process font" });
    }
  }

  const hasSuccess = results.some(r => !r.error);
  return c.json({ results }, hasSuccess ? 200 : 400);
});

export default upload;
