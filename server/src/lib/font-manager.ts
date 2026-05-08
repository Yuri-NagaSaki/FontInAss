/**
 * Font manager for local deployment.
 *
 * Adapted from the Cloudflare Worker version:
 * - D1 env.DB → bun:sqlite via db.ts helpers
 * - R2 env.FONTS_BUCKET → local filesystem via storage.ts
 * - KV env.CACHE → in-memory LRU via cache.ts
 *
 * Public API is identical to the Worker version so routes need minimal changes.
 */

import * as opentype from "opentype.js";
import { getDb, lookupFontsByNames, runBatch, type FontLookupRow } from "../db.js";
import { getFile, putFile } from "../storage.js";
import { log } from "../config.js";

// ─── Font lookup ──────────────────────────────────────────────────────────────

export interface FontLookupResult {
  r2Key: string;
  fontIndex: number;
  weight: number;
  italic: boolean;
}

// Weight suffix → numeric weight mapping (longest/most-specific first)
const WEIGHT_SUFFIXES: Array<[string, number]> = [
  ["extra light",  200], ["extra-light",  200], ["ultra light", 200], ["ultra-light", 200],
  ["semi bold",    600], ["semi-bold",    600], ["demi bold",   600], ["demi-bold",   600],
  ["extra bold",   800], ["extra-bold",   800], ["ultra bold",  800], ["ultra-bold",  800],
  ["extralight",   200], ["ultralight",   200],
  ["semibold",     600], ["demibold",     600],
  ["extrabold",    800], ["ultrabold",    800],
  ["hairline",     100], ["thin",         100],
  ["light",        300],
  ["regular",      400], ["normal",       400], ["book",        400],
  ["medium",       500],
  ["bold",         700],
  ["black",        900], ["heavy",        900],
];

/**
 * Try to strip a known weight suffix from a lowercased font name.
 * Returns the base family name + inferred weight, or null if no suffix matched.
 * e.g. "source han sans tc medium" → { base: "source han sans tc", weight: 500 }
 */
function stripWeightSuffix(nameLower: string): { base: string; weight: number } | null {
  for (const [suffix, weight] of WEIGHT_SUFFIXES) {
    if (nameLower.endsWith(" " + suffix)) {
      const base = nameLower.slice(0, nameLower.length - suffix.length - 1).trimEnd();
      if (base.length > 0) return { base, weight };
    }
  }
  return null;
}

function pickBest(
  variants: FontLookupRow[],
  targetWeight: number,
  targetItalic: boolean,
): FontLookupResult {
  const targetBold = targetWeight >= 600 ? 1 : 0;
  const italicInt = targetItalic ? 1 : 0;

  const exact = variants.find(v => v.bold === targetBold && v.italic === italicInt);
  const best = exact ?? [...variants].sort((a, b) => {
    const score = (v: FontLookupRow) =>
      Math.abs(v.bold - targetBold) * 200 +
      Math.abs(v.italic - italicInt) * 100 +
      Math.abs(v.weight - targetWeight);
    return score(a) - score(b);
  })[0];

  return {
    r2Key: best.r2_key,
    fontIndex: best.font_index,
    weight: best.weight,
    italic: best.italic === 1,
  };
}

/**
 * Batch-lookup fonts — single DB call for all needed names.
 * First attempts exact name match; falls back to stripping weight suffixes
 * (e.g. "source han sans tc medium" → "source han sans tc" w/ weight=500)
 * so ASS files using weight-in-name style still find indexed fonts.
 */
export function lookupFontsBatch(
  requests: Array<{ key: string; nameLower: string; targetWeight: number; targetItalic: boolean }>,
): Map<string, FontLookupResult | null> {
  const resultMap = new Map<string, FontLookupResult | null>();
  if (requests.length === 0) return resultMap;

  // ── Pass 1: exact name lookup ─────────────────────────────────────────────
  const uniqueNames = [...new Set(requests.map(r => r.nameLower))];
  const rows = lookupFontsByNames(uniqueNames);

  const byName = new Map<string, FontLookupRow[]>();
  for (const row of rows) {
    const arr = byName.get(row.name_lower) ?? [];
    arr.push(row);
    byName.set(row.name_lower, arr);
  }

  for (const req of requests) {
    const variants = byName.get(req.nameLower);
    resultMap.set(req.key, variants?.length
      ? pickBest(variants, req.targetWeight, req.targetItalic)
      : null,
    );
  }

  // ── Pass 2: weight-suffix fallback for unmatched names ────────────────────
  const unmatched = requests.filter(r => resultMap.get(r.key) === null);
  if (unmatched.length > 0) {
    const fallbackLookup = new Map<string, { base: string; weight: number }>();
    const fallbackNames: string[] = [];

    for (const req of unmatched) {
      const stripped = stripWeightSuffix(req.nameLower);
      if (stripped && !fallbackLookup.has(req.nameLower)) {
        fallbackLookup.set(req.nameLower, stripped);
        fallbackNames.push(stripped.base);
      }
    }

    if (fallbackNames.length > 0) {
      const fbRows = lookupFontsByNames([...new Set(fallbackNames)]);
      const fbByName = new Map<string, FontLookupRow[]>();
      for (const row of fbRows) {
        const arr = fbByName.get(row.name_lower) ?? [];
        arr.push(row);
        fbByName.set(row.name_lower, arr);
      }

      for (const req of unmatched) {
        const stripped = fallbackLookup.get(req.nameLower);
        if (!stripped) continue;
        const variants = fbByName.get(stripped.base);
        if (variants?.length) {
          // Use inferred weight from suffix rather than ASS style weight
          resultMap.set(req.key, pickBest(variants, stripped.weight, req.targetItalic));
        }
      }
    }
  }

  return resultMap;
}

/**
 * Load font bytes from local filesystem.
 * Falls back to stripping a leading "r2/" prefix for databases migrated
 * from the Cloudflare R2 version where keys had that prefix.
 */
export async function loadFontBytes(key: string): Promise<{ bytes: Uint8Array; resolvedKey: string } | null> {
  let bytes = await getFile(key);
  if (bytes) return { bytes, resolvedKey: key };

  // Migration fallback: strip "r2/" prefix (keys from CF R2 version)
  if (key.startsWith("r2/")) {
    const candidate = key.slice(3);
    bytes = await getFile(candidate);
    if (bytes) return { bytes, resolvedKey: candidate };
  }

  return null;
}

// ─── Font metadata parsing ─────────────────────────────────────────────────────

export interface FontFace {
  index: number;
  familyNames: string[];
  weight: number;
  bold: boolean;
  italic: boolean;
}

function isTTC(data: Uint8Array): boolean {
  return data[0] === 0x74 && data[1] === 0x74 && data[2] === 0x63 && data[3] === 0x66;
}

function parseSingleFace(buf: ArrayBuffer, opts?: { lowMemory?: boolean }): opentype.Font | null {
  try {
    return opentype.parse(buf, opts);
  } catch {
    return null;
  }
}

function getNames(font: opentype.Font): string[] {
  const names = new Set<string>();
  const nameTable = font.tables?.name as Record<string, unknown> | undefined;
  if (!nameTable) return [];

  // opentype.js 1.3.4 exposes a flat shape:
  //   { fontFamily: { en: "Arial" }, preferredFamily: {...}, ... }
  // opentype.js 1.3.5 nests by platform:
  //   { windows: { fontFamily: { en: "Arial" }, ... }, macintosh: { ... } }
  // Handle both so a runtime upgrade doesn't silently break indexing.
  const candidateBuckets: Array<Record<string, Record<string, string>>> = [];
  for (const platform of ["windows", "macintosh", "unicode"] as const) {
    const bucket = nameTable[platform];
    if (bucket && typeof bucket === "object") {
      candidateBuckets.push(bucket as Record<string, Record<string, string>>);
    }
  }
  // Always include the flat shape too (1.3.4 + opentype.js fallback)
  candidateBuckets.push(nameTable as Record<string, Record<string, string>>);

  for (const bucket of candidateBuckets) {
    for (const field of ["fontFamily", "preferredFamily", "fullName"] as const) {
      const entry = bucket[field];
      if (entry && typeof entry === "object") {
        for (const val of Object.values(entry)) {
          if (val && typeof val === "string") names.add(val.trim());
        }
      }
    }
  }
  return [...names].filter(Boolean);
}

export function parseFontMetadata(bytes: Uint8Array): FontFace[] {
  const buf = (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength)
    ? bytes.buffer as ArrayBuffer
    : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

  if (isTTC(bytes)) {
    return parseTTCMetadata(bytes, buf);
  }

  const font = parseSingleFace(buf, { lowMemory: true });
  if (!font) return [];

  const os2 = font.tables?.os2 as { usWeightClass?: number; fsSelection?: number } | undefined;
  const weight = os2?.usWeightClass ?? 400;
  const fsSelection = os2?.fsSelection ?? 0;
  const bold = !!(fsSelection & 0x20);
  const italic = !!(font.tables?.head as { macStyle?: number } | undefined)?.macStyle
    ? !!((font.tables.head as { macStyle: number }).macStyle & 0x02)
    : !!(fsSelection & 0x01);

  return [{
    index: 0,
    familyNames: getNames(font),
    weight,
    bold,
    italic,
  }];
}

function parseTTCMetadata(bytes: Uint8Array, buf: ArrayBuffer): FontFace[] {
  const view = new DataView(buf);
  const numFonts = view.getUint32(8, false);
  if (numFonts === 0 || numFonts > 256) return [];

  const faces: FontFace[] = [];
  for (let i = 0; i < numFonts; i++) {
    try {
      const faceOffset = view.getUint32(12 + i * 4, false);
      if (faceOffset >= buf.byteLength) continue;

      const faceBuf = extractTTCFace(buf, i);
      const font = parseSingleFace(faceBuf, { lowMemory: true });
      if (!font) continue;

      const os2 = font.tables?.os2 as { usWeightClass?: number; fsSelection?: number } | undefined;
      const weight = os2?.usWeightClass ?? 400;
      const fsSelection = os2?.fsSelection ?? 0;
      const bold = !!(fsSelection & 0x20);
      const italic = !!(fsSelection & 0x01);

      faces.push({ index: i, familyNames: getNames(font), weight, bold, italic });
    } catch {
      // skip invalid faces
    }
  }
  return faces;
}

function extractTTCFace(ttcBuf: ArrayBuffer, faceIndex: number): ArrayBuffer {
  const view = new DataView(ttcBuf);
  const numFonts = view.getUint32(8, false);
  const safeIndex = Math.min(faceIndex, numFonts - 1);
  const faceOffset = view.getUint32(12 + safeIndex * 4, false);
  const numTables = view.getUint16(faceOffset + 4, false);
  const sfVersion = view.getUint32(faceOffset, false);

  interface TableRec { tag: string; checksum: number; offset: number; length: number }
  const tables: TableRec[] = [];
  for (let i = 0; i < numTables; i++) {
    const r = faceOffset + 12 + i * 16;
    tables.push({
      tag: String.fromCharCode(
        view.getUint8(r), view.getUint8(r+1), view.getUint8(r+2), view.getUint8(r+3),
      ),
      checksum: view.getUint32(r + 4, false),
      offset: view.getUint32(r + 8, false),
      length: view.getUint32(r + 12, false),
    });
  }

  const headerSize = 12 + numTables * 16;
  const newOffsets: number[] = [];
  let cursor = headerSize;
  for (const t of tables) {
    newOffsets.push(cursor);
    cursor += (t.length + 3) & ~3;
  }

  const result = new ArrayBuffer(cursor);
  const out = new Uint8Array(result);
  const outView = new DataView(result);

  outView.setUint32(0, sfVersion, false);
  outView.setUint16(4, numTables, false);
  const maxPow = Math.floor(Math.log2(numTables));
  outView.setUint16(6, (1 << maxPow) * 16, false);
  outView.setUint16(8, maxPow, false);
  outView.setUint16(10, numTables * 16 - (1 << maxPow) * 16, false);

  const src = new Uint8Array(ttcBuf);
  for (let i = 0; i < tables.length; i++) {
    const t = tables[i];
    const r = 12 + i * 16;
    for (let j = 0; j < 4; j++) out[r + j] = t.tag.charCodeAt(j);
    outView.setUint32(r + 4, t.checksum, false);
    outView.setUint32(r + 8, newOffsets[i], false);
    outView.setUint32(r + 12, t.length, false);
    const end = Math.min(t.offset + t.length, src.length);
    out.set(src.subarray(t.offset, end), newOffsets[i]);
  }

  return result;
}

// ─── Index a font file into SQLite ────────────────────────────────────────────

export interface IndexResult {
  filename: string;
  id: string;
  faces: number;
  error?: string;
}

/**
 * Index a font file — write bytes to storage and insert DB rows.
 * If existingKey is provided, only DB rows are written (file already on disk).
 * If the font cannot be parsed by opentype.js (e.g. old cmap format),
 * a fallback face using the filename as family name is used so the entry
 * still lands in the DB and won't be re-attempted on every scan.
 */
export async function indexFont(
  filename: string,
  bytes: Uint8Array,
  existingKey?: string,
): Promise<IndexResult> {
  let faces = parseFontMetadata(bytes);

  if (faces.length === 0) {
    // Fallback: use filename (without extension) as the family name.
    // This ensures unparseable fonts are still stored and searchable by filename.
    const baseName = filename.replace(/\.(ttf|otf|ttc|otc)$/i, "").trim();
    if (!baseName) {
      return { filename, id: "", faces: 0, error: "Could not parse font metadata" };
    }
    log("warn", `[indexFont] ${filename}: parse failed, indexing with filename as family name`);
    faces = [{ index: 0, familyNames: [baseName], weight: 400, bold: false, italic: false }];
  }

  const fileId = crypto.randomUUID();
  const r2Key = existingKey ?? `fonts/${fileId}/${filename}`;

  // Write bytes to disk only if not already there (scan-local passes existingKey since file IS on disk)
  if (!existingKey) {
    await putFile(r2Key, bytes);
  }

  const db = getDb();
  const stmts: { sql: string; params: unknown[] }[] = [];

  stmts.push({
    sql: "INSERT OR IGNORE INTO font_files (id, filename, r2_key, size) VALUES (?, ?, ?, ?)",
    params: [fileId, filename, r2Key, bytes.length],
  });

  for (const face of faces) {
    const faceId = crypto.randomUUID();
    stmts.push({
      sql: "INSERT OR IGNORE INTO font_info (id, file_id, font_index, weight, bold, italic) VALUES (?, ?, ?, ?, ?, ?)",
      params: [faceId, fileId, face.index, face.weight, face.bold ? 1 : 0, face.italic ? 1 : 0],
    });
    for (const name of face.familyNames) {
      stmts.push({
        sql: "INSERT OR IGNORE INTO font_names (name_lower, font_info_id) VALUES (?, ?)",
        params: [name.toLowerCase(), faceId],
      });
    }
  }

  runBatch(stmts);

  return { filename, id: fileId, faces: faces.length };
}

/**
 * One-shot repair: re-index any font_files rows that have no usable font_names
 * link. This is needed after the opentype.js 1.3.5 regression silently produced
 * empty `familyNames` for uploads, leaving rows in `font_files` (+ possibly
 * `font_info`) but no `font_names` for lookup. Safe to run repeatedly.
 */
export async function repairUnnamedFonts(): Promise<{ attempted: number; repaired: number; failed: number }> {
  const db = getDb();
  const broken = db.prepare<{ id: string; r2_key: string; filename: string }, []>(`
    SELECT ff.id, ff.r2_key, ff.filename
    FROM font_files ff
    WHERE NOT EXISTS (
      SELECT 1 FROM font_info fi
      JOIN font_names fn ON fn.font_info_id = fi.id
      WHERE fi.file_id = ff.id
    )
  `).all();

  if (broken.length === 0) return { attempted: 0, repaired: 0, failed: 0 };

  log("info", `[repair] Found ${broken.length} font_files with no name index — re-parsing`);
  let repaired = 0;
  let failed = 0;

  for (const row of broken) {
    try {
      const bytes = await getFile(row.r2_key);
      if (!bytes) { failed++; continue; }
      const faces = parseFontMetadata(bytes);
      if (faces.length === 0 || faces.every(f => f.familyNames.length === 0)) {
        log("warn", `[repair] ${row.filename}: still no names after re-parse`);
        failed++;
        continue;
      }
      const stmts: { sql: string; params: unknown[] }[] = [];
      // Drop any previously-inserted font_info rows so we can reinsert cleanly.
      // font_names rows are only attached to the new font_info ids we generate.
      stmts.push({ sql: "DELETE FROM font_info WHERE file_id = ?", params: [row.id] });
      for (const face of faces) {
        const faceId = crypto.randomUUID();
        stmts.push({
          sql: "INSERT OR IGNORE INTO font_info (id, file_id, font_index, weight, bold, italic) VALUES (?, ?, ?, ?, ?, ?)",
          params: [faceId, row.id, face.index, face.weight, face.bold ? 1 : 0, face.italic ? 1 : 0],
        });
        for (const name of face.familyNames) {
          stmts.push({
            sql: "INSERT OR IGNORE INTO font_names (name_lower, font_info_id) VALUES (?, ?)",
            params: [name.toLowerCase(), faceId],
          });
        }
      }
      runBatch(stmts);
      repaired++;
    } catch (e) {
      log("warn", `[repair] ${row.filename}: ${e instanceof Error ? e.message : String(e)}`);
      failed++;
    }
  }

  log("info", `[repair] Done: ${repaired}/${broken.length} repaired, ${failed} failed`);
  return { attempted: broken.length, repaired, failed };
}
