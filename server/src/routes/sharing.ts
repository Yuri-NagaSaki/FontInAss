/**
 * Subtitle sharing API routes.
 *
 * GET  /api/sharing/archives           - List all published archives (public)
 * GET  /api/sharing/archives/:id/download - Get download URL (public)
 * POST /api/sharing/upload             - Admin upload (API Key)
 * POST /api/sharing/contribute         - Community upload (rate-limited)
 * GET  /api/sharing/pending            - List pending archives (API Key)
 * POST /api/sharing/archives/:id/approve - Approve pending (API Key)
 * POST /api/sharing/archives/:id/reject  - Reject pending (API Key)
 * POST /api/sharing/import-index       - Import from AnimeSub repo (API Key, SSE)
 */

import { Hono } from "hono";
import { config, log } from "../config.js";
import { getDb } from "../db.js";
import { r2Upload, r2Delete, isR2Configured } from "../lib/r2-storage.js";
import { createHash } from "node:crypto";
import { mkdirSync, existsSync, unlinkSync, rmdirSync, readFileSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { streamSSE } from "hono/streaming";

const sharing = new Hono();

// ─── Types ────────────────────────────────────────────────────────────────────

interface SharedArchiveRow {
  id: string;
  name_cn: string;
  letter: string;
  season: string;
  sub_group: string;
  languages: string;
  subtitle_format: string;
  episode_count: number;
  has_fonts: number;
  filename: string;
  r2_key: string | null;
  file_size: number;
  file_count: number;
  download_url: string | null;
  local_path: string | null;
  status: string;
  contributor: string | null;
  sub_entries: string | null;
  created_at: string;
  updated_at: string;
}

// ─── In-memory cache ──────────────────────────────────────────────────────────

let _archivesCache: { data: SharedArchiveRow[]; etag: string; ts: number } | null = null;

function invalidateCache() {
  _archivesCache = null;
}

function getCachedArchives(): { data: SharedArchiveRow[]; etag: string } {
  const now = Date.now();
  if (_archivesCache && now - _archivesCache.ts < config.sharingCacheTtl * 1000) {
    return { data: _archivesCache.data, etag: _archivesCache.etag };
  }
  const db = getDb();
  const rows = db
    .prepare<SharedArchiveRow, []>(
      "SELECT * FROM shared_archives WHERE status = 'published' ORDER BY letter, name_cn, season"
    )
    .all();
  const etag = createHash("sha256").update(JSON.stringify(rows)).digest("hex").slice(0, 16);
  _archivesCache = { data: rows, etag, ts: now };
  return { data: rows, etag };
}

// ─── Auth middleware helper ───────────────────────────────────────────────────

function checkApiKey(c: any): boolean {
  if (!config.apiKey) return true;
  const provided =
    c.req.header("x-api-key") ??
    c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  return provided === config.apiKey;
}

// ─── Helper: generate nanoid-like ID ──────────────────────────────────────────

function nanoid(size = 21): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return Array.from(bytes, (b) => chars[b & 63]).join("");
}

// ─── Helper: validate zip file ────────────────────────────────────────────────

const BLOCKED_EXTENSIONS = new Set([
  ".exe", ".sh", ".bat", ".cmd", ".ps1", ".js", ".py",
  ".dll", ".so", ".dylib", ".msi", ".com", ".scr",
]);

const SUBTITLE_EXTENSIONS = new Set([".ass", ".ssa", ".srt"]);

async function validateZipContents(
  buf: Buffer,
): Promise<{ valid: boolean; error?: string; fileCount: number; episodeCount: number; subtitleFormats: string[] }> {
  // Check zip magic bytes
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b || buf[2] !== 0x03 || buf[3] !== 0x04) {
    return { valid: false, error: "Not a valid ZIP file", fileCount: 0, episodeCount: 0, subtitleFormats: [] };
  }

  // We do a simple scan of the zip central directory for filenames
  // For a more robust approach we'd use jszip, but we keep deps minimal on server
  const names = extractZipFilenames(buf);
  if (names.length === 0) {
    return { valid: false, error: "ZIP file appears empty", fileCount: 0, episodeCount: 0, subtitleFormats: [] };
  }

  let hasSubtitle = false;
  const formats = new Set<string>();
  let episodeCount = 0;

  for (const name of names) {
    // Path traversal check
    if (name.includes("..")) {
      return { valid: false, error: `Path traversal detected: ${name}`, fileCount: 0, episodeCount: 0, subtitleFormats: [] };
    }

    const ext = name.slice(name.lastIndexOf(".")).toLowerCase();

    // Block dangerous files
    if (BLOCKED_EXTENSIONS.has(ext)) {
      return { valid: false, error: `Blocked file type: ${ext} (${name})`, fileCount: 0, episodeCount: 0, subtitleFormats: [] };
    }

    if (SUBTITLE_EXTENSIONS.has(ext)) {
      hasSubtitle = true;
      formats.add(ext.slice(1)); // remove dot
      episodeCount++;
    }
  }

  if (!hasSubtitle) {
    return { valid: false, error: "ZIP must contain at least one subtitle file (.ass/.ssa/.srt)", fileCount: 0, episodeCount: 0, subtitleFormats: [] };
  }

  return { valid: true, fileCount: names.length, episodeCount, subtitleFormats: [...formats] };
}

/** Extract filenames from a ZIP central directory (minimal parser). */
function extractZipFilenames(buf: Buffer): string[] {
  const names: string[] = [];
  // Find End of Central Directory record (last 65KB)
  const searchStart = Math.max(0, buf.length - 65536);
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= searchStart; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) return names;

  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  const cdEntries = buf.readUInt16LE(eocdOffset + 10);
  let pos = cdOffset;

  for (let i = 0; i < cdEntries && pos < buf.length - 46; i++) {
    if (buf[pos] !== 0x50 || buf[pos + 1] !== 0x4b || buf[pos + 2] !== 0x01 || buf[pos + 3] !== 0x02) break;
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const name = buf.subarray(pos + 46, pos + 46 + nameLen).toString("utf-8");
    if (!name.endsWith("/")) names.push(name);
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

// ─── Helper: expire old pending uploads ───────────────────────────────────────

function cleanupExpiredPending() {
  const db = getDb();
  const expired = db
    .prepare<{ id: string; local_path: string | null }, []>(
      "SELECT id, local_path FROM shared_archives WHERE status = 'pending' AND created_at < datetime('now', '-7 days')"
    )
    .all();

  for (const row of expired) {
    if (row.local_path) {
      try {
        if (existsSync(row.local_path)) unlinkSync(row.local_path);
        const dir = resolve(row.local_path, "..");
        try { rmdirSync(dir); } catch { /* not empty, ok */ }
      } catch (e) {
        log("warn", `[sharing] failed to delete expired file ${row.local_path}:`, e);
      }
    }
  }

  if (expired.length > 0) {
    db.prepare("UPDATE shared_archives SET status = 'expired', local_path = NULL WHERE status = 'pending' AND created_at < datetime('now', '-7 days')").run();
    log("info", `[sharing] expired ${expired.length} pending upload(s)`);
  }
}

// ─── Rate limiting ────────────────────────────────────────────────────────────

function checkRateLimit(ipHash: string): boolean {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const row = db
    .prepare<{ count: number }, [string, string]>(
      "SELECT count FROM upload_rate_limit WHERE ip_hash = ? AND upload_date = ?"
    )
    .get(ipHash, today);

  if (row && row.count >= config.sharingRateLimit) return false;

  db.prepare(
    "INSERT INTO upload_rate_limit (ip_hash, upload_date, count) VALUES (?, ?, 1) ON CONFLICT(ip_hash, upload_date) DO UPDATE SET count = count + 1"
  ).run(ipHash, today);

  return true;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Public endpoints
// ═══════════════════════════════════════════════════════════════════════════════

/** GET /archives — list all published archives (public, cached). */
sharing.get("/archives", (c) => {
  const { data, etag } = getCachedArchives();

  // ETag support
  const ifNoneMatch = c.req.header("if-none-match");
  if (ifNoneMatch === `"${etag}"`) {
    return new Response(null, { status: 304 });
  }

  return c.json(data, 200, {
    "Cache-Control": "public, max-age=60",
    ETag: `"${etag}"`,
  });
});

/** GET /archives/:id/download — redirect to R2 CDN download URL. */
sharing.get("/archives/:id/download", (c) => {
  const db = getDb();
  const row = db
    .prepare<{ download_url: string | null; status: string }, [string]>(
      "SELECT download_url, status FROM shared_archives WHERE id = ?"
    )
    .get(c.req.param("id"));

  if (!row || row.status !== "published" || !row.download_url) {
    return c.json({ error: "Not found" }, 404);
  }

  return c.redirect(row.download_url, 302);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Admin endpoints (API Key required)
// ═══════════════════════════════════════════════════════════════════════════════

/** POST /upload — admin direct upload + publish. */
sharing.post("/upload", async (c) => {
  if (!checkApiKey(c)) return c.json({ error: "Unauthorized" }, 401);
  if (!isR2Configured()) return c.json({ error: "R2 not configured" }, 500);

  const form = await c.req.formData();
  const file = form.get("file") as File | null;
  const metaStr = form.get("metadata") as string | null;

  if (!file || !metaStr) return c.json({ error: "Missing file or metadata" }, 400);
  if (file.size > config.sharingMaxFileSize) {
    return c.json({ error: `File too large (max ${Math.round(config.sharingMaxFileSize / 1024 / 1024)}MB)` }, 400);
  }

  const meta = JSON.parse(metaStr) as {
    name_cn: string;
    letter: string;
    season: string;
    sub_group: string;
    languages: string[];
    has_fonts: boolean;
  };

  if (!meta.name_cn || !meta.letter || !meta.season || !meta.sub_group || !meta.languages?.length) {
    return c.json({ error: "Missing required metadata fields" }, 400);
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const { valid, error, fileCount, episodeCount, subtitleFormats } = await validateZipContents(buf);
  if (!valid) return c.json({ error: `Invalid zip: ${error}` }, 400);

  const id = nanoid();
  const r2Key = `${meta.letter}/${meta.name_cn}/${meta.season}/${file.name}`;
  const downloadUrl = config.r2PublicUrl ? `${config.r2PublicUrl}/${r2Key}` : null;

  // Upload to R2
  await r2Upload(r2Key, buf, "application/zip", buf.length);

  // Insert into DB
  const db = getDb();
  db.prepare(`
    INSERT INTO shared_archives (id, name_cn, letter, season, sub_group, languages, subtitle_format,
      episode_count, has_fonts, filename, r2_key, file_size, file_count, download_url, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published')
  `).run(
    id, meta.name_cn, meta.letter, meta.season, meta.sub_group,
    JSON.stringify(meta.languages), JSON.stringify(subtitleFormats),
    episodeCount, meta.has_fonts ? 1 : 0, file.name, r2Key, file.size, fileCount, downloadUrl,
  );

  invalidateCache();
  log("info", `[sharing] admin uploaded: ${file.name} → ${r2Key}`);

  return c.json({ id, download_url: downloadUrl, filename: file.name, status: "published" });
});

/** GET /pending — list pending archives (admin only). */
sharing.get("/pending", (c) => {
  if (!checkApiKey(c)) return c.json({ error: "Unauthorized" }, 401);

  const db = getDb();
  const rows = db
    .prepare<SharedArchiveRow, []>(
      "SELECT * FROM shared_archives WHERE status = 'pending' ORDER BY created_at DESC"
    )
    .all();

  return c.json(rows);
});

/** POST /archives/:id/approve — approve a pending upload. */
sharing.post("/archives/:id/approve", async (c) => {
  if (!checkApiKey(c)) return c.json({ error: "Unauthorized" }, 401);
  if (!isR2Configured()) return c.json({ error: "R2 not configured" }, 500);

  const db = getDb();
  const row = db
    .prepare<SharedArchiveRow, [string]>(
      "SELECT * FROM shared_archives WHERE id = ? AND status = 'pending'"
    )
    .get(c.req.param("id"));

  if (!row) return c.json({ error: "Archive not found or not pending" }, 404);

  // Read local file
  if (!row.local_path || !existsSync(row.local_path)) {
    return c.json({ error: "Local file not found — may have expired" }, 404);
  }

  const fileBuf = readFileSync(row.local_path);
  const r2Key = `${row.letter}/${row.name_cn}/${row.season}/${row.filename}`;
  const downloadUrl = config.r2PublicUrl ? `${config.r2PublicUrl}/${r2Key}` : null;

  // Upload to R2
  await r2Upload(r2Key, fileBuf, "application/zip", fileBuf.length);

  // Update DB
  db.prepare(`
    UPDATE shared_archives
    SET status = 'published', r2_key = ?, download_url = ?, local_path = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
    WHERE id = ?
  `).run(r2Key, downloadUrl, row.id);

  // Delete local file
  try {
    unlinkSync(row.local_path);
    const dir = resolve(row.local_path, "..");
    try { rmdirSync(dir); } catch { /* not empty */ }
  } catch { /* already gone */ }

  invalidateCache();
  log("info", `[sharing] approved: ${row.filename} → ${r2Key}`);

  return c.json({ id: row.id, status: "published", download_url: downloadUrl });
});

/** POST /archives/:id/reject — reject a pending upload. */
sharing.post("/archives/:id/reject", (c) => {
  if (!checkApiKey(c)) return c.json({ error: "Unauthorized" }, 401);

  const db = getDb();
  const row = db
    .prepare<{ id: string; local_path: string | null }, [string]>(
      "SELECT id, local_path FROM shared_archives WHERE id = ? AND status = 'pending'"
    )
    .get(c.req.param("id"));

  if (!row) return c.json({ error: "Archive not found or not pending" }, 404);

  // Delete local file
  if (row.local_path) {
    try {
      if (existsSync(row.local_path)) unlinkSync(row.local_path);
      const dir = resolve(row.local_path, "..");
      try { rmdirSync(dir); } catch { /* not empty */ }
    } catch { /* already gone */ }
  }

  db.prepare(
    "UPDATE shared_archives SET status = 'rejected', local_path = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?"
  ).run(row.id);

  invalidateCache();
  log("info", `[sharing] rejected: ${row.id}`);

  return c.json({ id: row.id, status: "rejected" });
});

/** DELETE /archives/:id — delete an archive (admin). */
sharing.delete("/archives/:id", async (c) => {
  if (!checkApiKey(c)) return c.json({ error: "Unauthorized" }, 401);

  const db = getDb();
  const row = db
    .prepare<{ id: string; r2_key: string | null; local_path: string | null; status: string }, [string]>(
      "SELECT id, r2_key, local_path, status FROM shared_archives WHERE id = ?"
    )
    .get(c.req.param("id"));

  if (!row) return c.json({ error: "Not found" }, 404);

  // Delete from R2 if published
  if (row.r2_key && isR2Configured()) {
    try { await r2Delete(row.r2_key); } catch (e) { log("warn", `[sharing] R2 delete failed:`, e); }
  }

  // Delete local file if pending
  if (row.local_path && existsSync(row.local_path)) {
    try {
      unlinkSync(row.local_path);
      const dir = resolve(row.local_path, "..");
      try { rmdirSync(dir); } catch { /* not empty */ }
    } catch { /* ok */ }
  }

  db.prepare("DELETE FROM shared_archives WHERE id = ?").run(row.id);

  invalidateCache();
  log("info", `[sharing] deleted: ${row.id}`);

  return c.json({ deleted: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Community contribute (rate-limited, no auth)
// ═══════════════════════════════════════════════════════════════════════════════

sharing.post("/contribute", async (c) => {
  // Rate limiting
  const clientIp = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "unknown";
  const ipHash = createHash("sha256").update(clientIp).digest("hex");

  // Cleanup expired pending on each contribute (lazy)
  cleanupExpiredPending();

  if (!checkRateLimit(ipHash)) {
    return c.json({ error: `Rate limit exceeded (max ${config.sharingRateLimit} uploads/day)` }, 429);
  }

  const form = await c.req.formData();
  const file = form.get("file") as File | null;
  const metaStr = form.get("metadata") as string | null;

  if (!file || !metaStr) return c.json({ error: "Missing file or metadata" }, 400);
  if (file.size > config.sharingMaxFileSize) {
    return c.json({ error: `File too large (max ${Math.round(config.sharingMaxFileSize / 1024 / 1024)}MB)` }, 400);
  }

  const meta = JSON.parse(metaStr) as {
    name_cn: string;
    letter: string;
    season: string;
    sub_group: string;
    languages: string[];
    has_fonts: boolean;
    contributor?: string;
  };

  if (!meta.name_cn || !meta.letter || !meta.season || !meta.sub_group || !meta.languages?.length) {
    return c.json({ error: "Missing required metadata fields" }, 400);
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const { valid, error, fileCount, episodeCount, subtitleFormats } = await validateZipContents(buf);
  if (!valid) return c.json({ error: `Invalid zip: ${error}` }, 400);

  // Save to local pending directory
  const id = nanoid();
  const pendingDir = join(config.pendingDir, id);
  mkdirSync(pendingDir, { recursive: true });
  const localPath = join(pendingDir, file.name);
  await Bun.write(localPath, buf);

  // Insert into DB
  const db = getDb();
  db.prepare(`
    INSERT INTO shared_archives (id, name_cn, letter, season, sub_group, languages, subtitle_format,
      episode_count, has_fonts, filename, file_size, file_count, local_path, status, contributor)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(
    id, meta.name_cn, meta.letter, meta.season, meta.sub_group,
    JSON.stringify(meta.languages), JSON.stringify(subtitleFormats),
    episodeCount, meta.has_fonts ? 1 : 0, file.name, file.size, fileCount,
    localPath, meta.contributor || "anonymous",
  );

  log("info", `[sharing] community contribution: ${file.name} from ${meta.contributor || "anonymous"}`);

  return c.json({ id, status: "pending", message: "Submitted for review" });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Import from AnimeSub repo (SSE)
// ═══════════════════════════════════════════════════════════════════════════════

sharing.post("/import-index", (c) => {
  if (!checkApiKey(c)) return c.json({ error: "Unauthorized" }, 401);
  if (!isR2Configured()) return c.json({ error: "R2 not configured" }, 500);

  return streamSSE(c, async (stream) => {
    const db = getDb();
    let imported = 0;
    let skipped = 0;
    let errors = 0;
    const startTime = Date.now();

    try {
      // Phase 1: Fetch root index
      await stream.writeSSE({ data: JSON.stringify({ phase: "index", message: "Fetching index.json..." }) });
      const indexRes = await fetch("https://raw.githubusercontent.com/Yuri-NagaSaki/AnimeSub/main/index.json");
      if (!indexRes.ok) throw new Error(`Failed to fetch index.json: ${indexRes.status}`);
      const index = (await indexRes.json()) as {
        total_anime: number;
        total_archives: number;
        entries: Array<{
          name_cn: string;
          letter: string;
          path: string;
          seasons: string[];
          sub_groups: string[];
          languages: string[];
          sub_entries?: string[];
        }>;
      };

      await stream.writeSSE({
        data: JSON.stringify({ phase: "index", message: `Index loaded: ${index.total_anime} anime, ${index.total_archives} archives` }),
      });

      const total = index.total_archives;

      // Phase 2: Process each entry
      for (const entry of index.entries) {
        for (const season of entry.seasons) {
          try {
            const metaUrl = `https://raw.githubusercontent.com/Yuri-NagaSaki/AnimeSub/main/${entry.path}/${season}/metadata.json`;
            const metaRes = await fetch(metaUrl);
            if (!metaRes.ok) {
              log("warn", `[sharing] metadata fetch failed: ${metaUrl} → ${metaRes.status}`);
              errors++;
              continue;
            }

            const meta = (await metaRes.json()) as {
              name_cn: string;
              letter: string;
              season: string;
              sub_groups: string[];
              subtitle_format: string[];
              languages: string[];
              episode_count: number;
              has_fonts: boolean;
              archives: Array<{
                filename: string;
                size_bytes: number;
                file_count: number;
                languages: string[];
              }>;
            };

            for (const archive of meta.archives) {
              // Check if already imported
              const existing = db
                .prepare<{ id: string }, [string, string, string]>(
                  "SELECT id FROM shared_archives WHERE name_cn = ? AND season = ? AND filename = ?"
                )
                .get(meta.name_cn, season, archive.filename);

              if (existing) {
                skipped++;
                continue;
              }

              // Extract sub_group from filename: [SubGroup] ...
              let subGroup = "Unknown";
              const match = archive.filename.match(/^\[([^\]]+)\]/);
              if (match) subGroup = match[1];

              // Download zip and stream to R2
              const zipUrl = `https://raw.githubusercontent.com/Yuri-NagaSaki/AnimeSub/main/${entry.path}/${season}/${encodeURIComponent(archive.filename)}`;
              try {
                const zipRes = await fetch(zipUrl);
                if (!zipRes.ok) {
                  log("warn", `[sharing] zip download failed: ${zipUrl} → ${zipRes.status}`);
                  errors++;
                  continue;
                }

                const r2Key = `${entry.letter}/${meta.name_cn}/${season}/${archive.filename}`;
                const zipBuf = Buffer.from(await zipRes.arrayBuffer());
                await r2Upload(r2Key, zipBuf, "application/zip", zipBuf.length);

                const downloadUrl = config.r2PublicUrl ? `${config.r2PublicUrl}/${r2Key}` : null;
                const id = nanoid();

                db.prepare(`
                  INSERT INTO shared_archives (id, name_cn, letter, season, sub_group, languages, subtitle_format,
                    episode_count, has_fonts, filename, r2_key, file_size, file_count, download_url, status, sub_entries)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?)
                `).run(
                  id, meta.name_cn, entry.letter, season, subGroup,
                  JSON.stringify(archive.languages ?? meta.languages),
                  JSON.stringify(meta.subtitle_format ?? []),
                  meta.episode_count, meta.has_fonts ? 1 : 0,
                  archive.filename, r2Key, archive.size_bytes, archive.file_count,
                  downloadUrl, entry.sub_entries ? JSON.stringify(entry.sub_entries) : null,
                );

                imported++;
                await stream.writeSSE({
                  data: JSON.stringify({
                    phase: "upload",
                    current: imported + skipped,
                    total,
                    name: `${meta.name_cn} ${season}`,
                    filename: archive.filename,
                    size: formatBytes(archive.size_bytes),
                  }),
                });
              } catch (e) {
                log("error", `[sharing] import error for ${archive.filename}:`, e);
                errors++;
              }
            }
          } catch (e) {
            log("error", `[sharing] metadata error for ${entry.name_cn}/${season}:`, e);
            errors++;
          }
        }
      }

      invalidateCache();

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      await stream.writeSSE({
        data: JSON.stringify({
          phase: "done",
          imported,
          skipped,
          errors,
          elapsed: `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`,
        }),
      });
    } catch (e) {
      log("error", "[sharing] import failed:", e);
      await stream.writeSSE({
        data: JSON.stringify({ phase: "error", message: String(e) }),
      });
    }
  });
});

// ─── Helper ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export default sharing;
