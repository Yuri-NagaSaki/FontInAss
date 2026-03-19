-- Migration: 0001_init
-- Font file records (one row per uploaded file)
CREATE TABLE IF NOT EXISTS font_files (
  id         TEXT PRIMARY KEY,
  filename   TEXT NOT NULL,
  r2_key     TEXT NOT NULL UNIQUE,
  size       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Per-face metadata (a TTC file can contain multiple faces)
CREATE TABLE IF NOT EXISTS font_info (
  id         TEXT PRIMARY KEY,
  file_id    TEXT NOT NULL REFERENCES font_files(id) ON DELETE CASCADE,
  font_index INTEGER NOT NULL DEFAULT 0,
  weight     INTEGER NOT NULL DEFAULT 400,
  bold       INTEGER NOT NULL DEFAULT 0,
  italic     INTEGER NOT NULL DEFAULT 0
);

-- All searchable names for a face (family, fullName, postscriptName) stored lowercase
CREATE TABLE IF NOT EXISTS font_names (
  name_lower     TEXT NOT NULL,
  font_info_id   TEXT NOT NULL REFERENCES font_info(id) ON DELETE CASCADE,
  PRIMARY KEY (name_lower, font_info_id)
);

CREATE INDEX IF NOT EXISTS idx_font_names ON font_names(name_lower);
CREATE INDEX IF NOT EXISTS idx_font_info_file ON font_info(file_id);
