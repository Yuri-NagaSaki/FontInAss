/**
 * Archive utility — unified ZIP and 7z support.
 *
 * ZIP:  Parsed in-process with a minimal central-directory scanner (no deps).
 * 7z:   Listed via the `7z l` CLI command (p7zip-full installed in Docker).
 */

import { config, log } from "../config.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const BLOCKED_EXTENSIONS = new Set([
  ".exe", ".sh", ".bat", ".cmd", ".ps1", ".js", ".py",
  ".dll", ".so", ".dylib", ".msi", ".com", ".scr",
]);

export const SUBTITLE_EXTENSIONS = new Set([".ass", ".ssa", ".srt"]);

export type ArchiveType = "zip" | "7z" | null;

export interface ArchiveValidation {
  valid: boolean;
  error?: string;
  fileCount: number;
  episodeCount: number;
  subtitleFormats: string[];
}

// ─── Archive type detection ───────────────────────────────────────────────────

/** Detect archive format from magic bytes. */
export function detectArchiveType(buf: Buffer | Uint8Array): ArchiveType {
  if (buf.length < 6) return null;
  // ZIP: PK\x03\x04
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return "zip";
  // 7z: 7z\xBC\xAF\x27\x1C
  if (buf[0] === 0x37 && buf[1] === 0x7a && buf[2] === 0xbc && buf[3] === 0xaf && buf[4] === 0x27 && buf[5] === 0x1c) return "7z";
  return null;
}

/** Get the MIME type for the archive. */
export function archiveMimeType(type: ArchiveType): string {
  if (type === "7z") return "application/x-7z-compressed";
  return "application/zip";
}

// ─── Filename extraction ──────────────────────────────────────────────────────

/** Extract filenames from a ZIP central directory (minimal in-process parser). */
function extractZipFilenames(buf: Buffer): string[] {
  const names: string[] = [];
  const MAX_UNCOMPRESSED = config.archiveMaxUncompressed;
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
  let totalUncompressed = 0;

  for (let i = 0; i < cdEntries && pos < buf.length - 46; i++) {
    if (buf[pos] !== 0x50 || buf[pos + 1] !== 0x4b || buf[pos + 2] !== 0x01 || buf[pos + 3] !== 0x02) break;
    const uncompressedSize = buf.readUInt32LE(pos + 24);
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_UNCOMPRESSED) {
      throw new Error("ZIP uncompressed size exceeds 500MB limit (possible zip bomb)");
    }
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const name = buf.subarray(pos + 46, pos + 46 + nameLen).toString("utf-8");
    if (!name.endsWith("/")) names.push(name);
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

/**
 * Extract filenames from a 7z archive using the `7z l` CLI.
 * Writes buf to a temp file, runs `7z l`, parses the tabular output.
 */
async function extract7zFilenames(buf: Buffer): Promise<string[]> {
  const tmpPath = `/tmp/_7z_list_${Date.now()}_${Math.random().toString(36).slice(2)}.7z`;
  try {
    await Bun.write(tmpPath, buf);
    const proc = Bun.spawn(["7z", "l", "-slt", tmpPath], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      log("warn", `[archive] 7z l failed (exit ${exitCode}): ${stderr.slice(0, 200)}`);
      return [];
    }

    // -slt output: blocks separated by blank lines, each block has "Key = Value" lines.
    // The first block with "Path = ..." is the archive itself (no "Size" key for files) — skip it.
    // File entry blocks have both "Path = " and "Size = " lines.
    const names: string[] = [];
    const blocks = stdout.split(/\n\n+/);
    const MAX_UNCOMPRESSED = config.archiveMaxUncompressed;
    let totalUncompressed = 0;
    for (const block of blocks) {
      const lines = block.split("\n").map(l => l.trim());
      const pathLine = lines.find(l => l.startsWith("Path = "));
      const sizeLine = lines.find(l => l.startsWith("Size = "));
      const folderLine = lines.find(l => l.startsWith("Folder = "));
      if (!pathLine || !sizeLine) continue; // skip archive header (no Size line)
      const isFolder = folderLine?.endsWith("= +");
      if (isFolder) continue;
      const sz = Number(sizeLine.slice("Size = ".length).trim());
      if (Number.isFinite(sz) && sz > 0) {
        totalUncompressed += sz;
        if (totalUncompressed > MAX_UNCOMPRESSED) {
          throw new Error("7z uncompressed size exceeds limit (possible 7z bomb)");
        }
      }
      const name = pathLine.slice("Path = ".length);
      if (name && !name.includes("..")) names.push(name);
    }
    return names;
  } finally {
    try { const { unlinkSync } = await import("node:fs"); unlinkSync(tmpPath); } catch { /* ok */ }
  }
}

/**
 * Extract filenames from any supported archive.
 * Returns empty array if format is unrecognized.
 */
export async function extractArchiveFilenames(buf: Buffer): Promise<string[]> {
  const type = detectArchiveType(buf);
  if (type === "zip") return extractZipFilenames(buf);
  if (type === "7z") return extract7zFilenames(buf);
  return [];
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validate archive contents — works for both ZIP and 7z.
 * Checks: recognized format, non-empty, no path traversal,
 * no blocked file types, at least one subtitle file.
 */
export async function validateArchiveContents(buf: Buffer): Promise<ArchiveValidation> {
  const type = detectArchiveType(buf);
  if (!type) {
    return { valid: false, error: "Not a valid archive (expected ZIP or 7z)", fileCount: 0, episodeCount: 0, subtitleFormats: [] };
  }

  const names = await extractArchiveFilenames(buf);
  if (names.length === 0) {
    return { valid: false, error: "Archive appears empty or unreadable", fileCount: 0, episodeCount: 0, subtitleFormats: [] };
  }

  let hasSubtitle = false;
  const formats = new Set<string>();
  let episodeCount = 0;

  for (const name of names) {
    if (name.includes("..")) {
      return { valid: false, error: `Path traversal detected: ${name}`, fileCount: 0, episodeCount: 0, subtitleFormats: [] };
    }

    const ext = name.slice(name.lastIndexOf(".")).toLowerCase();

    if (BLOCKED_EXTENSIONS.has(ext)) {
      return { valid: false, error: `Blocked file type: ${ext} (${name})`, fileCount: 0, episodeCount: 0, subtitleFormats: [] };
    }

    if (SUBTITLE_EXTENSIONS.has(ext)) {
      hasSubtitle = true;
      formats.add(ext.slice(1));
      episodeCount++;
    }
  }

  if (!hasSubtitle) {
    return { valid: false, error: "Archive must contain at least one subtitle file (.ass/.ssa/.srt)", fileCount: 0, episodeCount: 0, subtitleFormats: [] };
  }

  return { valid: true, fileCount: names.length, episodeCount, subtitleFormats: [...formats] };
}
