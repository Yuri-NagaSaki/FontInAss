/**
 * Archive utility — unified ZIP and 7z support.
 *
 * Both formats are listed once via 7z with time, entry and output limits.
 */

import type { ArchiveInspection, ArchiveInspector } from "./index.js";

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

/** Use the maintained archive reader for ZIP/ZIP64 and 7z alike. Never extract. */
export async function extractArchiveFilenames(buf: Buffer, maxUncompressed = 2 * 1024 * 1024 * 1024): Promise<string[]> {
  if (!detectArchiveType(buf)) return [];
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "fontinass-archive-"));
  try {
    const path = join(directory, "input.archive");
    await writeFile(path, buf);
    const proc = Bun.spawn(["7z", "l", "-slt", "-ba", "-sccUTF-8", "--", path], {
      stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 20_000, killSignal: "SIGKILL",
    });
    const read = async (stream: ReadableStream<Uint8Array>) => {
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 4 * 1024 * 1024) { proc.kill("SIGKILL"); throw new Error("Archive listing is too large"); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      return Buffer.concat(chunks).toString("utf8");
    };
    const [stdout, , exitCode] = await Promise.all([read(proc.stdout), read(proc.stderr), proc.exited]);
    if (exitCode !== 0) throw new Error("Archive is damaged, encrypted or unreadable");
    const names: string[] = [];
    let total = 0;
    for (const block of stdout.trim().split(/\r?\n\r?\n+/)) {
      const fields = new Map<string, string>();
      for (const line of block.split(/\r?\n/)) {
        const separator = line.indexOf(" = ");
        if (separator < 1 || fields.has(line.slice(0, separator))) throw new Error("Invalid archive listing");
        fields.set(line.slice(0, separator), line.slice(separator + 3));
      }
      const name = fields.get("Path");
      if (!name) throw new Error("Archive entry has no name");
      if (fields.get("Encrypted") === "+") throw new Error("Encrypted archives are not supported");
      if (fields.has("Symbolic Link") || fields.has("Hard Link") || /(?:^|\s)l[rwx-]{9}/.test(fields.get("Attributes") ?? "")) throw new Error("Archive links are not supported");
      if (/^(?:[\\/]|[a-z]:)/i.test(name) || name.split(/[\\/]/).includes("..") || /[\x00-\x1f]/.test(name)) throw new Error("Unsafe archive path");
      const size = Number(fields.get("Size"));
      if (!Number.isSafeInteger(size) || size < 0) throw new Error("Invalid archive entry size");
      total += size;
      if (total > maxUncompressed) throw new Error("Archive uncompressed size exceeds configured limit");
      if (fields.get("Folder") !== "+" && !name.endsWith("/")) names.push(name);
      if (names.length > 10000) throw new Error("Too many archive entries (max 10000)");
    }
    return names;
  } finally { await rm(directory, { recursive: true, force: true }); }
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validate archive contents — works for both ZIP and 7z.
 * Checks: recognized format, non-empty, no path traversal,
 * no blocked file types, at least one subtitle file.
 */
export async function validateArchiveContents(buf: Buffer, maxUncompressed = 2 * 1024 * 1024 * 1024): Promise<ArchiveValidation> {
  try { return validateNames(await extractArchiveFilenames(buf, maxUncompressed)); }
  catch (error) { return { valid: false, error: error instanceof Error ? error.message : String(error), fileCount: 0, episodeCount: 0, subtitleFormats: [] }; }
}

function validateNames(names: string[]): ArchiveValidation {
  if (names.length === 0) {
    return { valid: false, error: "Archive appears empty or unreadable", fileCount: 0, episodeCount: 0, subtitleFormats: [] };
  }

  let hasSubtitle = false;
  const formats = new Set<string>();
  let episodeCount = 0;

  for (const name of names) {
    if (name.split(/[\\/]/).includes("..")) {
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

export class SystemArchiveInspector implements ArchiveInspector {
  constructor(private readonly maxUncompressed = 2 * 1024 * 1024 * 1024) {}

  async inspect(_filename: string, bytes: Uint8Array): Promise<ArchiveInspection> {
    const buffer = Buffer.from(bytes);
    const type = detectArchiveType(buffer);
    let filenames: string[];
    try { filenames = await extractArchiveFilenames(buffer, this.maxUncompressed); }
    catch (error) { return { valid: false, error: error instanceof Error ? error.message : String(error), type, filenames: [], subtitleFormats: [], subtitleCount: 0 }; }
    const validation = validateNames(filenames);
    return {
      valid: validation.valid,
      error: validation.error,
      type,
      filenames,
      subtitleFormats: validation.subtitleFormats,
      subtitleCount: validation.episodeCount,
    };
  }
}
