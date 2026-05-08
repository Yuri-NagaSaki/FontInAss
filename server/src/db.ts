/**
 * SQLite database layer using Bun's built-in bun:sqlite module.
 *
 * Schema is identical to Cloudflare D1 schema — zero migration cost.
 * Query helpers mirror the D1 binding API shape so route code is easy to adapt.
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config, log } from "./config.js";

// ─── Schema ───────────────────────────────────────────────────────────────────

const SCHEMA = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS font_files (
  id          TEXT PRIMARY KEY,
  filename    TEXT NOT NULL,
  r2_key      TEXT NOT NULL UNIQUE,
  size        INTEGER NOT NULL DEFAULT 0,
  sha256      TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- API upload tokens — third-party programmatic font uploads
CREATE TABLE IF NOT EXISTS api_upload_tokens (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  prefix        TEXT NOT NULL UNIQUE,
  token_hash    TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1,
  note          TEXT,
  upload_count  INTEGER NOT NULL DEFAULT 0,
  total_bytes   INTEGER NOT NULL DEFAULT 0,
  last_used_at  TEXT,
  last_used_ip  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_prefix ON api_upload_tokens(prefix);

-- Per-upload audit log for API uploads
CREATE TABLE IF NOT EXISTS api_upload_history (
  id            TEXT PRIMARY KEY,
  token_id      TEXT NOT NULL REFERENCES api_upload_tokens(id) ON DELETE CASCADE,
  font_file_id  TEXT,
  filename      TEXT NOT NULL,
  size          INTEGER NOT NULL DEFAULT 0,
  sha256        TEXT,
  status        TEXT NOT NULL,
  error         TEXT,
  client_ip     TEXT,
  user_agent    TEXT,
  uploaded_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_api_history_token ON api_upload_history(token_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_history_status ON api_upload_history(status);

CREATE TABLE IF NOT EXISTS font_info (
  id          TEXT PRIMARY KEY,
  file_id     TEXT NOT NULL REFERENCES font_files(id) ON DELETE CASCADE,
  font_index  INTEGER NOT NULL DEFAULT 0,
  weight      INTEGER NOT NULL DEFAULT 400,
  bold        INTEGER NOT NULL DEFAULT 0,
  italic      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS font_names (
  name_lower    TEXT NOT NULL,
  font_info_id  TEXT NOT NULL REFERENCES font_info(id) ON DELETE CASCADE,
  PRIMARY KEY (name_lower, font_info_id)
);

CREATE INDEX IF NOT EXISTS idx_font_names_lower ON font_names(name_lower);
CREATE INDEX IF NOT EXISTS idx_font_info_file_id ON font_info(file_id);
CREATE INDEX IF NOT EXISTS idx_font_files_r2_key ON font_files(r2_key);

-- Shared subtitle archives
CREATE TABLE IF NOT EXISTS shared_archives (
  id              TEXT PRIMARY KEY,
  name_cn         TEXT NOT NULL,
  letter          TEXT NOT NULL,
  season          TEXT NOT NULL,
  sub_group       TEXT NOT NULL,
  languages       TEXT NOT NULL DEFAULT '[]',
  subtitle_format TEXT NOT NULL DEFAULT '[]',
  episode_count   INTEGER DEFAULT 0,
  has_fonts       INTEGER DEFAULT 0,
  filename        TEXT NOT NULL,
  r2_key          TEXT UNIQUE,
  file_size       INTEGER NOT NULL DEFAULT 0,
  file_count      INTEGER DEFAULT 0,
  download_url    TEXT,
  local_path      TEXT,
  status          TEXT NOT NULL DEFAULT 'published',
  contributor     TEXT,
  sub_entries     TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_archives_status ON shared_archives(status);
CREATE INDEX IF NOT EXISTS idx_archives_letter ON shared_archives(letter);

-- IP rate limiting for community uploads
CREATE TABLE IF NOT EXISTS upload_rate_limit (
  ip_hash     TEXT NOT NULL,
  upload_date TEXT NOT NULL,
  count       INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (ip_hash, upload_date)
);

-- Processing logs for subset requests
CREATE TABLE IF NOT EXISTS processing_logs (
  id            TEXT PRIMARY KEY,
  filename      TEXT NOT NULL,
  client_ip     TEXT,
  code          INTEGER NOT NULL,
  messages      TEXT,
  missing_fonts TEXT,
  font_count    INTEGER DEFAULT 0,
  file_size     INTEGER DEFAULT 0,
  elapsed_ms    INTEGER DEFAULT 0,
  processed_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_processing_logs_date ON processing_logs(processed_at);
CREATE INDEX IF NOT EXISTS idx_processing_logs_code ON processing_logs(code);

-- Track resolved (uploaded) missing fonts
CREATE TABLE IF NOT EXISTS resolved_fonts (
  font_name   TEXT PRIMARY KEY,
  resolved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
`;

// ─── DB singleton ─────────────────────────────────────────────────────────────

let _db: Database | null = null;

export function getDb(): Database {
  if (_db) return _db;

  // Ensure data directory exists
  mkdirSync(dirname(config.dbPath), { recursive: true });

  _db = new Database(config.dbPath, { create: true });
  _db.run(SCHEMA);

  // ── Idempotent column migrations (for DBs created before sha256 was added) ──
  try {
    const cols = _db
      .prepare<{ name: string }, []>("PRAGMA table_info(font_files)")
      .all()
      .map(r => r.name);
    if (!cols.includes("sha256")) {
      _db.run("ALTER TABLE font_files ADD COLUMN sha256 TEXT");
      log("info", "[db] migrated: added font_files.sha256 column");
    }
    _db.run("CREATE INDEX IF NOT EXISTS idx_font_files_sha256 ON font_files(sha256)");
  } catch (e) {
    log("warn", "[db] sha256 column migration check failed:", e);
  }

  log("info", `[db] opened at ${config.dbPath}`);
  return _db;
}

// ─── Row types ────────────────────────────────────────────────────────────────

export interface FontFileRow {
  id: string;
  filename: string;
  r2_key: string;
  size: number;
  created_at: string;
}

export interface FontInfoRow {
  id: string;
  file_id: string;
  font_index: number;
  weight: number;
  bold: number;
  italic: number;
}

export interface FontNameRow {
  name_lower: string;
  font_info_id: string;
}

export interface FontLookupRow {
  name_lower: string;
  font_index: number;
  weight: number;
  bold: number;
  italic: number;
  r2_key: string;
}

// ─── Query helpers ────────────────────────────────────────────────────────────

/** Run multiple statements in a single transaction for performance. */
export function runBatch(statements: Array<{ sql: string; params: unknown[] }>): void {
  const db = getDb();
  const tx = db.transaction(() => {
    for (const { sql, params } of statements) {
      db.prepare(sql).run(...params);
    }
  });
  tx();
}

/** Batch-lookup font rows by name_lower (any count — chunked internally). */
/** Build "?,?,?,..." with N placeholders. Asserts N matches the value count to
 *  prevent any future divergence between placeholders and bound parameters. */
function inClause(values: readonly unknown[]): string {
  const placeholders = values.map(() => "?").join(",");
  // Defensive: ensure placeholder count matches the array length we'll spread.
  if (placeholders.split(",").length !== values.length) {
    throw new Error(`inClause length mismatch: ${placeholders.split(",").length} vs ${values.length}`);
  }
  return placeholders;
}

export function lookupFontsByNames(names: string[]): FontLookupRow[] {
  if (names.length === 0) return [];
  const db = getDb();
  const CHUNK = 500;
  const rows: FontLookupRow[] = [];
  for (let i = 0; i < names.length; i += CHUNK) {
    const chunk = names.slice(i, i + CHUNK);
    const placeholders = inClause(chunk);
    const partial = db.prepare<FontLookupRow, unknown[]>(`
      SELECT fn.name_lower, fi.font_index, fi.weight, fi.bold, fi.italic, ff.r2_key
      FROM font_names fn
      JOIN font_info fi ON fn.font_info_id = fi.id
      JOIN font_files ff ON fi.file_id = ff.id
      WHERE fn.name_lower IN (${placeholders})
    `).all(...chunk);
    rows.push(...partial);
  }
  return rows;
}

/** Check which r2_keys already exist in font_files (chunked). */
export function findExistingKeys(keys: string[]): Set<string> {
  if (keys.length === 0) return new Set();
  const db = getDb();
  const CHUNK = 500;
  const found = new Set<string>();
  for (let i = 0; i < keys.length; i += CHUNK) {
    const chunk = keys.slice(i, i + CHUNK);
    const placeholders = inClause(chunk);
    const rows = db.prepare<{ r2_key: string }, unknown[]>(
      `SELECT r2_key FROM font_files WHERE r2_key IN (${placeholders})`
    ).all(...chunk);
    for (const r of rows) found.add(r.r2_key);
  }
  return found;
}

/** Delete font_files rows by IDs (chunked). Returns r2_keys of deleted rows. */
export function deleteFontsByIds(ids: string[]): string[] {
  if (ids.length === 0) return [];
  const db = getDb();
  const CHUNK = 500;
  const r2Keys: string[] = [];
  const tx = db.transaction(() => {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const placeholders = inClause(chunk);
      const rows = db.prepare<{ r2_key: string }, unknown[]>(
        `SELECT r2_key FROM font_files WHERE id IN (${placeholders})`
      ).all(...chunk);
      for (const r of rows) r2Keys.push(r.r2_key);
      db.prepare(`DELETE FROM font_files WHERE id IN (${placeholders})`).run(...chunk);
    }
  });
  tx();
  return r2Keys;
}

/** Return all font_files rows (id + r2_key) for repair operations. */
export function getAllFontFileEntries(): { id: string; r2_key: string }[] {
  return getDb()
    .prepare<{ id: string; r2_key: string }, []>("SELECT id, r2_key FROM font_files")
    .all();
}

/** Update a single font_files r2_key by id. Returns true if row was updated. */
export function updateFontFileKey(id: string, newKey: string): boolean {
  const result = getDb()
    .prepare("UPDATE font_files SET r2_key = ? WHERE id = ?")
    .run(newKey, id);
  return (result.changes ?? 0) > 0;
}
