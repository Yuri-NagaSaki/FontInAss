/**
 * Local filesystem storage abstraction.
 *
 * Replaces Cloudflare R2 bucket API with equivalent local FS operations.
 * All paths are relative to config.fontDir (the "bucket root").
 * The "key" concept maps directly to relative file paths within fontDir.
 */

import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, readFileSync } from "node:fs";
import { writeFile, readFile, unlink } from "node:fs/promises";
import { join, dirname, relative, sep, posix } from "node:path";
import { config, log } from "./config.js";

const FONT_EXTS = new Set(["ttf", "otf", "ttc", "otc"]);

function toNativeKey(key: string): string {
  // Convert forward-slash key to OS-native path separator
  return key.split("/").join(sep);
}

function toKey(nativePath: string): string {
  // Convert OS-native path to forward-slash key
  return nativePath.split(sep).join("/");
}

function absolutePath(key: string): string {
  const native = toNativeKey(key);
  // Security: block directory traversal
  const abs = join(config.fontDir, native);
  if (!abs.startsWith(config.fontDir)) {
    throw new Error(`Path traversal blocked: ${key}`);
  }
  return abs;
}

function ensureDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

// ─── Ensure font directory exists ─────────────────────────────────────────────

export function ensureFontDir(): void {
  mkdirSync(config.fontDir, { recursive: true });
  log("info", `[storage] font dir: ${config.fontDir}`);
}

// ─── CRUD operations ──────────────────────────────────────────────────────────

export async function getFile(key: string): Promise<Uint8Array | null> {
  try {
    const buf = await readFile(absolutePath(key));
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

export async function putFile(key: string, data: Uint8Array): Promise<void> {
  const abs = absolutePath(key);
  ensureDir(abs);
  await writeFile(abs, data);
}

export async function deleteFile(key: string): Promise<void> {
  try {
    await unlink(absolutePath(key));
  } catch {
    // Ignore if already deleted
  }
}

export function fileExists(key: string): boolean {
  try {
    return existsSync(absolutePath(key));
  } catch {
    return false;
  }
}

// ─── Directory listing (mirrors R2 bucket.list) ────────────────────────────────

export interface StorageObject {
  key: string;   // forward-slash relative path from fontDir
  size: number;
  name: string;  // basename
}

export interface BrowseResult {
  folders: string[];  // sub-prefix strings ending with "/"
  files: StorageObject[];
  done: true;
}

/**
 * Browse a single level of the fontDir (like R2 with delimiter="/").
 * prefix = "" lists root; prefix = "MyFolder/" lists that folder's direct children.
 */
export function browseLevel(prefix: string): BrowseResult {
  const dirPath = prefix
    ? join(config.fontDir, ...prefix.replace(/\/$/, "").split("/"))
    : config.fontDir;

  const folders: string[] = [];
  const files: StorageObject[] = [];

  if (!existsSync(dirPath)) {
    return { folders: [], files: [], done: true };
  }

  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      folders.push(prefix + entry.name + "/");
    } else if (entry.isFile()) {
      const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
      if (FONT_EXTS.has(ext)) {
        const key = prefix + entry.name;
        const abs = join(dirPath, entry.name);
        const size = statSync(abs).size;
        files.push({ key, size, name: entry.name });
      }
    }
  }

  return { folders, files, done: true };
}

/**
 * Recursively list all font files under a prefix.
 * Returns flat list of { key, size } — equivalent to R2 list without delimiter.
 */
export function listAllKeys(prefix: string = ""): { key: string; size: number }[] {
  const startDir = prefix
    ? join(config.fontDir, ...prefix.replace(/\/$/, "").split("/"))
    : config.fontDir;

  const results: { key: string; size: number }[] = [];

  function walk(dir: string, relPrefix: string): void {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), relPrefix + entry.name + "/");
      } else if (entry.isFile()) {
        const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
        if (FONT_EXTS.has(ext)) {
          const key = relPrefix + entry.name;
          const abs = join(dir, entry.name);
          results.push({ key, size: statSync(abs).size });
        }
      }
    }
  }

  walk(startDir, prefix);
  return results;
}

/**
 * Scan the entire fontDir recursively and return all font file keys.
 * Used by the "Scan Local" feature to mass-index pre-existing fonts.
 */
export function scanAllFonts(): { key: string; size: number }[] {
  return listAllKeys("");
}

/**
 * Read a font file by key synchronously (for indexing — needs bytes immediately).
 */
export function readFileSync_safe(key: string): Uint8Array | null {
  try {
    return new Uint8Array(readFileSync(absolutePath(key)));
  } catch {
    return null;
  }
}
