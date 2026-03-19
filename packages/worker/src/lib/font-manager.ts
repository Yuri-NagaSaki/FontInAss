/**
 * Font manager: look up fonts in D1 and load bytes from R2.
 * Implements the same lookup logic as fontInAss/src/fontmanager.py.
 */

import type { Env } from "../types.js";

export interface FontLookupResult {
  r2Key: string;
  fontIndex: number;
  weight: number;
  italic: boolean;
}

/**
 * Find a font in D1 by name, weight, and italic, returning R2 key and face index.
 * Uses case-insensitive name lookup and fuzzy weight/style fallback.
 */
export async function lookupFont(
  env: Env,
  fontName: string,
  targetWeight: number,
  targetItalic: boolean,
): Promise<FontLookupResult | null> {
  const nameLower = fontName.trim().toLowerCase();
  const targetBold = targetWeight >= 600 ? 1 : 0;
  const italicInt = targetItalic ? 1 : 0;

  // Exact match: name + bold + italic
  const exactResult = await env.DB.prepare(`
    SELECT fi.id, fi.font_index, fi.weight, fi.bold, fi.italic, ff.r2_key
    FROM font_names fn
    JOIN font_info fi ON fn.font_info_id = fi.id
    JOIN font_files ff ON fi.file_id = ff.id
    WHERE fn.name_lower = ?
      AND fi.bold = ?
      AND fi.italic = ?
    LIMIT 1
  `).bind(nameLower, targetBold, italicInt).first<{
    id: string; font_index: number; weight: number;
    bold: number; italic: number; r2_key: string;
  }>();

  if (exactResult) {
    return {
      r2Key: exactResult.r2_key,
      fontIndex: exactResult.font_index,
      weight: exactResult.weight,
      italic: exactResult.italic === 1,
    };
  }

  // Fuzzy fallback: any variant of the same family
  const fuzzyResult = await env.DB.prepare(`
    SELECT fi.id, fi.font_index, fi.weight, fi.bold, fi.italic, ff.r2_key
    FROM font_names fn
    JOIN font_info fi ON fn.font_info_id = fi.id
    JOIN font_files ff ON fi.file_id = ff.id
    WHERE fn.name_lower = ?
    ORDER BY
      ABS(fi.bold - ?) ASC,
      ABS(fi.italic - ?) ASC,
      ABS(fi.weight - ?) ASC
    LIMIT 1
  `).bind(nameLower, targetBold, italicInt, targetWeight).first<{
    id: string; font_index: number; weight: number;
    bold: number; italic: number; r2_key: string;
  }>();

  if (fuzzyResult) {
    return {
      r2Key: fuzzyResult.r2_key,
      fontIndex: fuzzyResult.font_index,
      weight: fuzzyResult.weight,
      italic: fuzzyResult.italic === 1,
    };
  }

  return null;
}

/**
 * Load raw font bytes from R2.
 */
export async function loadFontBytes(env: Env, r2Key: string): Promise<Uint8Array | null> {
  const obj = await env.FONTS_BUCKET.get(r2Key);
  if (!obj) return null;
  const buf = await obj.arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Parse font metadata from raw font bytes.
 * Reads the 'name' table to extract family name, full name, postscript name,
 * and the OS/2 table for weight/bold/italic info.
 *
 * Returns an array of face descriptors (multiple for TTC).
 */
export interface FontFaceInfo {
  index: number;
  familyNames: string[];  // all searchable names
  weight: number;
  bold: boolean;
  italic: boolean;
}

export function parseFontMetadata(fontBytes: Uint8Array): FontFaceInfo[] {
  const view = new DataView(fontBytes.buffer, fontBytes.byteOffset, fontBytes.byteLength);

  const readUint16 = (offset: number) => view.getUint16(offset, false);
  const readUint32 = (offset: number) => view.getUint32(offset, false);
  const readTag = (offset: number) =>
    String.fromCharCode(fontBytes[offset], fontBytes[offset + 1], fontBytes[offset + 2], fontBytes[offset + 3]);

  // Detect TTC
  const tag = readTag(0);
  if (tag === "ttcf") {
    // TTC header
    const numFonts = readUint32(8);
    const faces: FontFaceInfo[] = [];
    for (let i = 0; i < numFonts; i++) {
      const offset = readUint32(12 + i * 4);
      const info = parseSingleFace(fontBytes, view, offset, i);
      if (info) faces.push(info);
    }
    return faces;
  }

  // Single face
  const info = parseSingleFace(fontBytes, view, 0, 0);
  return info ? [info] : [];
}

function parseSingleFace(
  fontBytes: Uint8Array,
  view: DataView,
  faceOffset: number,
  index: number,
): FontFaceInfo | null {
  try {
    const readUint16At = (off: number) => view.getUint16(off, false);
    const readUint32At = (off: number) => view.getUint32(off, false);

    // Offset table
    const numTables = readUint16At(faceOffset + 4);

    // Build table directory
    const tables: Record<string, number> = {};
    for (let i = 0; i < numTables; i++) {
      const entryOffset = faceOffset + 12 + i * 16;
      const tableTag =
        String.fromCharCode(
          fontBytes[entryOffset],
          fontBytes[entryOffset + 1],
          fontBytes[entryOffset + 2],
          fontBytes[entryOffset + 3],
        );
      tables[tableTag] = readUint32At(entryOffset + 8); // table offset
    }

    const names = parseNameTable(fontBytes, view, tables["name"] ?? 0);
    const { weight, bold, italic } = parseOS2Table(fontBytes, view, tables["OS/2"] ?? 0);

    if (names.length === 0) return null;

    return { index, familyNames: names, weight, bold, italic };
  } catch {
    return null;
  }
}

function parseNameTable(fontBytes: Uint8Array, view: DataView, nameOffset: number): string[] {
  if (!nameOffset) return [];
  try {
    const count = view.getUint16(nameOffset + 2, false);
    const stringOffset = view.getUint16(nameOffset + 4, false);
    const names = new Set<string>();

    for (let i = 0; i < count; i++) {
      const recOffset = nameOffset + 6 + i * 12;
      const platformId = view.getUint16(recOffset, false);
      const nameId = view.getUint16(recOffset + 6, false);
      const length = view.getUint16(recOffset + 8, false);
      const strOff = view.getUint16(recOffset + 10, false);

      // nameId: 1=family, 4=fullname, 6=postscript, 16=typographic family
      if (![1, 4, 6, 16].includes(nameId)) continue;

      const start = nameOffset + stringOffset + strOff;
      const strBytes = fontBytes.slice(start, start + length);

      let decoded: string;
      if (platformId === 3 || platformId === 0) {
        // Windows / Unicode — UTF-16 BE
        decoded = new TextDecoder("utf-16be").decode(strBytes);
      } else {
        // Mac — ASCII / Latin
        decoded = new TextDecoder("latin1").decode(strBytes);
      }

      const cleaned = decoded.trim();
      if (cleaned) names.add(cleaned);
    }

    return Array.from(names);
  } catch {
    return [];
  }
}

function parseOS2Table(
  _fontBytes: Uint8Array,
  view: DataView,
  os2Offset: number,
): { weight: number; bold: boolean; italic: boolean } {
  if (!os2Offset) return { weight: 400, bold: false, italic: false };
  try {
    const weight = view.getUint16(os2Offset + 4, false); // usWeightClass
    const fsSelection = view.getUint16(os2Offset + 62, false);
    const bold = (fsSelection & 0x20) !== 0;
    const italic = (fsSelection & 0x01) !== 0;
    return { weight, bold, italic };
  } catch {
    return { weight: 400, bold: false, italic: false };
  }
}
