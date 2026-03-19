/**
 * Font subsetter using opentype.js — pure JS, no WASM dependencies.
 *
 * Algorithm mirrors the frontend approach in ass-subset/index.html:
 *  1. Parse source font (TTF/OTF, or a specific face within TTC)
 *  2. Build a new Font with only the glyphs needed (+ .notdef)
 *  3. Preserve family/subfamily names and os2/name tables
 *  4. Encode result with UUencode for embedding in ASS [Fonts] section
 */

import * as opentype from "opentype.js";
import { uuencode } from "./uuencode.js";

export interface FontSubsetResult {
  /** UUencoded subset font data, ready to embed in ASS [Fonts] section */
  encoded: string;
  /** Characters not present in the font (empty = all found) */
  missingGlyphs: string;
  error: string | null;
}

/**
 * Subset a font to only include the given Unicode codepoints.
 *
 * @param fontBytes - Raw font file bytes (TTF/OTF or TTC)
 * @param faceIndex - Face index within TTC (0 for single-face fonts)
 * @param fontName  - Family name used for the output filename tag
 * @param weight    - Font weight (400/700/etc.)
 * @param italic    - Whether the font is italic
 * @param unicodes  - Set of Unicode codepoints to include
 */
export async function subsetFont(
  fontBytes: Uint8Array,
  faceIndex: number,
  fontName: string,
  weight: number,
  italic: boolean,
  unicodes: Set<number>,
): Promise<FontSubsetResult> {
  try {
    // Avoid copying the buffer when possible (saves 20-30 MB per CJK font)
    const buf = (fontBytes.byteOffset === 0 && fontBytes.byteLength === fontBytes.buffer.byteLength)
      ? fontBytes.buffer as ArrayBuffer
      : fontBytes.buffer.slice(
          fontBytes.byteOffset,
          fontBytes.byteOffset + fontBytes.byteLength,
        ) as ArrayBuffer;

    // Parse the face — TTC files need an explicit offset.
    // lowMemory: true defers glyph parsing until each glyph is accessed —
    // critical for CJK fonts which have 20,000–70,000 glyphs. Without this,
    // opentype.js eagerly creates JS objects for every glyph (~100 MB peak).
    let orig: opentype.Font;
    if (isTTC(fontBytes)) {
      orig = parseTTCFace(buf, faceIndex);
    } else {
      orig = opentype.parse(buf, { lowMemory: true });
    }

    // Build subset glyphs: .notdef first, then requested codepoints
    const origNotdef = orig.glyphs.get(0);
    const notdef = new opentype.Glyph({
      name: ".notdef",
      unicode: 0,
      advanceWidth: origNotdef?.advanceWidth ?? 500,
      path: new opentype.Path(),
    });

    const glyphs: opentype.Glyph[] = [notdef];
    const seen = new Set<number>([0]);
    const missing: string[] = [];

    for (const cp of unicodes) {
      if (seen.has(cp)) continue;
      const char = String.fromCodePoint(cp);
      const origGlyph = orig.charToGlyph(char);

      if (!origGlyph || origGlyph.index === 0) {
        missing.push(char);
        continue;
      }

      // Render the glyph path through opentype.js layout engine
      // (handles composite glyphs, hinting references, etc.)
      const rendered = orig.getPath(char, 0, 0, orig.unitsPerEm);
      const newPath = new opentype.Path();

      for (const cmd of rendered.commands) {
        switch (cmd.type) {
          case "M": newPath.moveTo(cmd.x, -cmd.y); break;
          case "L": newPath.lineTo(cmd.x, -cmd.y); break;
          case "C": newPath.curveTo(cmd.x1!, -cmd.y1!, cmd.x2!, -cmd.y2!, cmd.x, -cmd.y); break;
          case "Q": newPath.quadraticCurveTo(cmd.x1!, -cmd.y1!, cmd.x, -cmd.y); break;
          case "Z": newPath.close(); break;
        }
      }

      glyphs.push(new opentype.Glyph({
        name: origGlyph.name || `glyph_${cp}`,
        unicode: cp,
        advanceWidth: origGlyph.advanceWidth,
        path: newPath,
      }));
      seen.add(cp);
    }

    // Resolve family/style names from the original font
    const getName = (id: string | number) => {
      const entry = orig.names[id as keyof typeof orig.names] as
        | Record<string, string>
        | undefined;
      if (!entry) return null;
      return entry["en"] ?? entry["en-US"] ?? Object.values(entry)[0] ?? null;
    };

    const familyName = (getName("fontFamily") as string | null) ?? fontName;
    const styleName = (getName("fontSubfamily") as string | null) ?? "Regular";

    const newFont = new opentype.Font({
      familyName,
      styleName,
      unitsPerEm: orig.unitsPerEm,
      ascender: orig.ascender,
      descender: orig.descender,
      glyphs,
    });

    // Preserve original name + os2 tables so the font remains identifiable
    if (orig.tables?.name) newFont.tables.name = orig.tables.name;
    if (orig.tables?.os2) newFont.tables.os2 = { ...orig.tables.os2 };

    const subsetBytes = new Uint8Array(newFont.toArrayBuffer());
    const encoded = uuencode(subsetBytes);

    // Build the ASS [Fonts] header line: fontname:<name>_<B><I>0.ttf
    const bTag = weight > 400 ? "B" : "";
    const iTag = italic ? "I" : "";
    const header = `fontname:${fontName}_${bTag}${iTag}0.ttf\n`;

    // Filter out characters that are commonly absent from fonts and not worth warning about:
    // - ASCII control/space (0x00-0x20)
    // - General Punctuation block (U+2000-U+206F): ⁉ ‼ ⁈ etc.
    // - Supplemental Punctuation (U+2E00-U+2E7F)
    // - Various arrows / math operators / box drawing / block elements / geometric shapes
    const SUPPRESS_RANGES: Array<[number, number]> = [
      [0x0000, 0x001F], // C0 controls
      [0x007F, 0x009F], // DEL + C1 controls
      [0x2000, 0x206F], // General Punctuation (⁉ ‼ ⁈ … — etc.)
      [0x2070, 0x209F], // Superscripts and Subscripts
      [0x20A0, 0x20CF], // Currency Symbols
      [0x2100, 0x214F], // Letterlike Symbols
      [0x2150, 0x218F], // Number Forms
      [0x2190, 0x21FF], // Arrows
      [0x2200, 0x22FF], // Mathematical Operators
      [0x2300, 0x23FF], // Miscellaneous Technical
      [0x2400, 0x243F], // Control Pictures
      [0x2440, 0x245F], // OCR
      [0x2460, 0x24FF], // Enclosed Alphanumerics
      [0x2500, 0x25FF], // Box Drawing + Block Elements
      [0x2600, 0x26FF], // Miscellaneous Symbols ☆ ★ etc.
      [0x2700, 0x27BF], // Dingbats ✓ ✗ etc.
      [0xFE00, 0xFE0F], // Variation Selectors
      [0xFFF0, 0xFFFF], // Specials
    ];
    const isSuppressed = (cp: number) =>
      cp <= 0x20 || SUPPRESS_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);
    const reportedMissing = missing.filter(c => !isSuppressed(c.codePointAt(0)!));

    return {
      encoded: header + encoded + "\n",
      missingGlyphs: reportedMissing.join(""),
      error: null,
    };
  } catch (e) {
    return {
      encoded: "",
      missingGlyphs: "",
      error: `Subsetting error [${fontName}]: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

// ─── TTC helpers ─────────────────────────────────────────────────────────────

function isTTC(data: Uint8Array): boolean {
  return (
    data[0] === 0x74 && data[1] === 0x74 && data[2] === 0x63 && data[3] === 0x66
  ); // "ttcf"
}

/**
 * Extract a single face from a TTC file as a standalone TTF ArrayBuffer.
 *
 * opentype.js v1.3.4 has no TTC support (throws on "ttcf" signature).
 * This function reads the face's OffsetTable from TTC-absolute offset, then
 * copies each table's bytes and rebuilds a proper single-face TTF with
 * updated (local) table offsets, so opentype.js can parse it normally.
 */
function extractTTCFace(ttcBuf: ArrayBuffer, faceIndex: number): ArrayBuffer {
  const view = new DataView(ttcBuf);
  const numFonts = view.getUint32(8, false);
  const faceOffset = view.getUint32(12 + Math.min(faceIndex, numFonts - 1) * 4, false);

  // OffsetTable at faceOffset: sfVersion(4) numTables(2) searchRange(2) entrySelector(2) rangeShift(2)
  const numTables = view.getUint16(faceOffset + 4, false);
  const sfVersion = view.getUint32(faceOffset, false);

  // Read TableDirectory entries (each 16 bytes: tag checksum offset length)
  interface TableRec { tag: string; checksum: number; offset: number; length: number }
  const tables: TableRec[] = [];
  for (let i = 0; i < numTables; i++) {
    const r = faceOffset + 12 + i * 16;
    tables.push({
      tag: String.fromCharCode(view.getUint8(r), view.getUint8(r+1), view.getUint8(r+2), view.getUint8(r+3)),
      checksum: view.getUint32(r + 4, false),
      offset:   view.getUint32(r + 8, false), // TTC-absolute offset
      length:   view.getUint32(r + 12, false),
    });
  }

  // Calculate new table offsets in the standalone TTF
  // Header: OffsetTable(12) + TableDirectory(numTables * 16)
  const headerSize = 12 + numTables * 16;
  const newOffsets: number[] = [];
  let cursor = headerSize;
  for (const t of tables) {
    newOffsets.push(cursor);
    cursor += (t.length + 3) & ~3; // align to 4 bytes
  }

  const result = new ArrayBuffer(cursor);
  const out = new Uint8Array(result);
  const outView = new DataView(result);

  // Write OffsetTable
  outView.setUint32(0, sfVersion, false);
  outView.setUint16(4, numTables, false);
  const maxPow = Math.floor(Math.log2(numTables));
  outView.setUint16(6, (1 << maxPow) * 16, false); // searchRange
  outView.setUint16(8, maxPow, false);              // entrySelector
  outView.setUint16(10, numTables * 16 - (1 << maxPow) * 16, false); // rangeShift

  // Write TableDirectory with new (local) offsets
  const src = new Uint8Array(ttcBuf);
  for (let i = 0; i < tables.length; i++) {
    const t = tables[i];
    const r = 12 + i * 16;
    for (let j = 0; j < 4; j++) out[r + j] = t.tag.charCodeAt(j);
    outView.setUint32(r + 4, t.checksum, false);
    outView.setUint32(r + 8, newOffsets[i], false);
    outView.setUint32(r + 12, t.length, false);
    // Copy table data from TTC-absolute position
    out.set(src.subarray(t.offset, t.offset + t.length), newOffsets[i]);
  }

  return result;
}

function parseTTCFace(buf: ArrayBuffer, faceIndex: number): opentype.Font {
  return opentype.parse(extractTTCFace(buf, faceIndex), { lowMemory: true });
}

