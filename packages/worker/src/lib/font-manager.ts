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

type FontRow = {
  name_lower: string;
  font_index: number;
  weight: number;
  bold: number;
  italic: number;
  r2_key: string;
};

/** Pick the best matching variant from a group of DB rows for one font name. */
function pickBest(
  variants: FontRow[],
  targetWeight: number,
  targetItalic: boolean,
): FontLookupResult {
  const targetBold = targetWeight >= 600 ? 1 : 0;
  const italicInt = targetItalic ? 1 : 0;

  // Exact match first
  const exact = variants.find(v => v.bold === targetBold && v.italic === italicInt);
  const best = exact ?? [...variants].sort((a, b) => {
    const score = (v: FontRow) =>
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
 * Batch-lookup fonts in D1 — single query for all needed names.
 * Keys in the returned map match the input keys array (index-aligned).
 * Each entry is `nameLower|weightStr|italicInt` for deduplication.
 */
export async function lookupFontsBatch(
  env: Env,
  requests: Array<{ key: string; nameLower: string; targetWeight: number; targetItalic: boolean }>,
): Promise<Map<string, FontLookupResult | null>> {
  const resultMap = new Map<string, FontLookupResult | null>();
  if (requests.length === 0) return resultMap;

  const uniqueNames = [...new Set(requests.map(r => r.nameLower))];
  const placeholders = uniqueNames.map(() => "?").join(",");

  const { results } = await env.DB.prepare(`
    SELECT fn.name_lower, fi.font_index, fi.weight, fi.bold, fi.italic, ff.r2_key
    FROM font_names fn
    JOIN font_info fi ON fn.font_info_id = fi.id
    JOIN font_files ff ON fi.file_id = ff.id
    WHERE fn.name_lower IN (${placeholders})
  `).bind(...uniqueNames).all<FontRow>();

  // Group by name_lower
  const byName = new Map<string, FontRow[]>();
  for (const row of results) {
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
 * Single-font lookup kept for compatibility (fonts route still uses it).
 */
export async function lookupFont(
  env: Env,
  fontName: string,
  targetWeight: number,
  targetItalic: boolean,
): Promise<FontLookupResult | null> {
  const m = await lookupFontsBatch(env, [{
    key: "single",
    nameLower: fontName.trim().toLowerCase(),
    targetWeight,
    targetItalic,
  }]);
  return m.get("single") ?? null;
}

/** Internal cache URL prefix — any valid HTTPS URL works as a CF Cache API key. */
const FONT_CACHE_BASE = "https://fontinass-font-bytes-v1.internal/";

/**
 * Load raw font bytes from R2, backed by the Workers Cache API.
 * Warm cache hit: ~0ms (edge memory). Cold miss: R2 read + async cache populate.
 */
export async function loadFontBytes(env: Env, r2Key: string): Promise<Uint8Array | null> {
  const cacheUrl = FONT_CACHE_BASE + encodeURIComponent(r2Key);
  const cacheReq = new Request(cacheUrl);

  // Try Cache API first
  const cached = await caches.default.match(cacheReq);
  if (cached) {
    return new Uint8Array(await cached.arrayBuffer());
  }

  // Miss — read from R2
  const obj = await env.FONTS_BUCKET.get(r2Key);
  if (!obj) return null;
  const buf = await obj.arrayBuffer();

  // Populate cache asynchronously (don't block response)
  const cacheResp = new Response(buf.slice(0), {
    headers: { "Cache-Control": "public, max-age=604800" },
  });
  caches.default.put(cacheReq, cacheResp).catch(() => {});

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
