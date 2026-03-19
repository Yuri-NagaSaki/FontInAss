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
import { getFile } from "../storage.js";

// ─── Font lookup ──────────────────────────────────────────────────────────────

export interface FontLookupResult {
  r2Key: string;
  fontIndex: number;
  weight: number;
  italic: boolean;
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
 * Same signature as the Worker version for drop-in compatibility.
 */
export function lookupFontsBatch(
  requests: Array<{ key: string; nameLower: string; targetWeight: number; targetItalic: boolean }>,
): Map<string, FontLookupResult | null> {
  const resultMap = new Map<string, FontLookupResult | null>();
  if (requests.length === 0) return resultMap;

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

  return resultMap;
}

/**
 * Load font bytes from local filesystem.
 * key = relative path within fontDir (same concept as R2 key).
 */
export async function loadFontBytes(key: string): Promise<Uint8Array | null> {
  return getFile(key);
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
  const nameTable = font.tables?.name as Record<string, Record<string, string>> | undefined;
  if (!nameTable) return [];

  for (const field of ["fontFamily", "preferredFamily", "fullName"] as const) {
    const entry = nameTable[field];
    if (entry) {
      for (const val of Object.values(entry)) {
        if (val && typeof val === "string") names.add(val.trim());
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
 */
export async function indexFont(
  filename: string,
  bytes: Uint8Array,
  existingKey?: string,
): Promise<IndexResult> {
  const faces = parseFontMetadata(bytes);
  if (faces.length === 0) {
    return { filename, id: "", faces: 0, error: "Could not parse font metadata" };
  }

  const fileId = crypto.randomUUID();
  const r2Key = existingKey ?? `fonts/${fileId}/${filename}`;

  // Write bytes to disk only if not already there
  if (!existingKey) {
    const { putFile } = await import("../storage.js");
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
