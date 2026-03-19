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
    const buf = fontBytes.buffer.slice(
      fontBytes.byteOffset,
      fontBytes.byteOffset + fontBytes.byteLength,
    ) as ArrayBuffer;

    // Parse the face — TTC files need an explicit offset
    let orig: opentype.Font;
    if (isTTC(fontBytes)) {
      orig = parseTTCFace(buf, faceIndex);
    } else {
      orig = opentype.parse(buf);
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

    // Filter out basic ASCII punctuation from the missing glyph report
    const PUNCT_SKIP = new Set([0x20, ...Array.from({ length: 0x20 }, (_, i) => i)]);
    const reportedMissing = missing.filter(c => {
      const cp = c.codePointAt(0)!;
      return !PUNCT_SKIP.has(cp) && cp > 0x20;
    });

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

function parseTTCFace(buf: ArrayBuffer, faceIndex: number): opentype.Font {
  const view = new DataView(buf);
  const numFonts = view.getUint32(8, false);
  const idx = Math.min(faceIndex, numFonts - 1);
  const offset = view.getUint32(12 + idx * 4, false);
  return (opentype as unknown as { parse(buf: ArrayBuffer, opts?: unknown, offset?: number): opentype.Font })
    .parse(buf, {}, offset);
}

