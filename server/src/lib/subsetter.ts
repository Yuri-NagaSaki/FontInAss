/**
 * Font subsetter using opentype.js — pure JS, no WASM dependencies.
 *
 * Local version: No Worker memory constraints (128 MB limit removed).
 * Simplified vs. the Cloudflare Worker version — no two-phase GC tricks needed.
 * opentype.js runs without lowMemory mode restrictions.
 */

import * as opentype from "opentype.js";
import { uuencode } from "./uuencode.js";
import { log } from "../config.js";

export interface FontSubsetResult {
  /** UUencoded subset font data, ready to embed in ASS [Fonts] section */
  encoded: string;
  /** Characters not present in the font (empty = all found) */
  missingGlyphs: string;
  error: string | null;
}

function toArrayBuffer(fontBytes: Uint8Array): ArrayBuffer {
  return (fontBytes.byteOffset === 0 && fontBytes.byteLength === fontBytes.buffer.byteLength)
    ? fontBytes.buffer as ArrayBuffer
    : fontBytes.buffer.slice(fontBytes.byteOffset, fontBytes.byteOffset + fontBytes.byteLength) as ArrayBuffer;
}

export function parseFontFace(fontBytes: Uint8Array, faceIndex: number): opentype.Font {
  const buf = toArrayBuffer(fontBytes);
  return isTTC(fontBytes)
    ? parseTTCFace(buf, faceIndex)
    : opentype.parse(buf, { lowMemory: true });
}

/**
 * Subset a font to only include the given Unicode codepoints.
 */
export async function subsetFont(
  fontBytes: Uint8Array,
  faceIndex: number,
  fontName: string,
  weight: number,
  italic: boolean,
  unicodes: Set<number>,
  outputFontName = fontName,
): Promise<FontSubsetResult> {
  try {
    return subsetParsedFont(parseFontFace(fontBytes, faceIndex), fontName, weight, italic, unicodes, outputFontName);
  } catch (e) {
    return {
      encoded: "",
      missingGlyphs: "",
      error: `Subsetting error [${fontName}]: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export function subsetParsedFont(
  orig: opentype.Font,
  fontName: string,
  weight: number,
  italic: boolean,
  unicodes: Set<number>,
  outputFontName = fontName,
): FontSubsetResult {
  try {
    // .notdef must always be the first glyph
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
      const glyphIndex = orig.charToGlyphIndex(char);
      const origGlyph = glyphIndex ? orig.glyphs.get(glyphIndex) : null;

      if (!origGlyph || glyphIndex === 0) {
        missing.push(char);
        continue;
      }

      const rendered = origGlyph.getPath(0, 0, orig.unitsPerEm, undefined, orig);
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

    // Pick a sensible ASCII family/style for the constructor — opentype.js uses these
    // to build a default postScriptName (which must be ASCII per spec).
    const origNames = (orig as unknown as { names?: Record<string, Record<string, string>> }).names ?? {};
    const pickName = (id: string): string | null => {
      const entry = origNames[id];
      if (!entry) return null;
      return entry["en"] ?? entry["en-US"] ?? Object.values(entry).find(v => /^[\x20-\x7E]+$/.test(v)) ?? Object.values(entry)[0] ?? null;
    };

    const outputFamilyName = outputFontName.trim() || fontName;
    const outputFamilyIsAscii = /^[\x20-\x7E]+$/.test(outputFamilyName);
    const familyName = outputFamilyIsAscii ? outputFamilyName : pickName("fontFamily") ?? fontName;
    const styleName = pickName("preferredSubfamily") ?? pickName("fontSubfamily") ?? "Regular";
    const os2Table = orig.tables?.os2 ? { ...orig.tables.os2 as Record<string, unknown> } : null;

    const newFont = new opentype.Font({
      familyName,
      styleName,
      unitsPerEm: orig.unitsPerEm,
      ascender: orig.ascender,
      descender: orig.descender,
      glyphs,
    });

    // CRITICAL: opentype.js serializes the name table from `font.names`, NOT from
    // `font.tables.name` (see opentype.js src/tables/sfnt.js). The Font constructor
    // only sets English (en) records derived from familyName/styleName, which means
    // CJK family names (e.g. `方正准雅宋`, nameID 1 zh-Hans) are dropped from the
    // subsetted output. libass matches `\fnXxx` against name table records, so without
    // the original multilingual entries the font becomes unmatchable inside MKV.
    // Deep-copy the parsed `names` structure so all language/platform variants survive.
    if (Object.keys(origNames).length > 0) {
      const merged = JSON.parse(JSON.stringify(origNames)) as Record<string, Record<string, string>>;
      // Ensure required entries exist for sfnt writer; fall back to constructor defaults.
      const newNames = (newFont as unknown as { names: Record<string, Record<string, string>> }).names;
      for (const key of ["fontFamily", "fontSubfamily", "fullName", "postScriptName"]) {
        if (!merged[key] || Object.keys(merged[key]).length === 0) {
          merged[key] = newNames[key] ? { ...newNames[key] } : {};
        }
        // sfnt writer + CFF table read `font.getEnglishName(key)` which returns
        // `names[key].en` directly. For CJK-only fonts that lack an English entry
        // this would yield `undefined`, producing broken CFF strings ("undefined
        // undefined") and an invalid postScriptName. Seed `en` from the constructor
        // defaults (derived from ASCII familyName/styleName) when missing.
        if (!merged[key].en) {
          const fallback =
            newNames[key]?.en ??
            merged[key]["en-US"] ??
            Object.values(merged[key]).find(v => /^[\x20-\x7E]+$/.test(v)) ??
            Object.values(merged[key])[0];
          if (fallback) merged[key].en = fallback;
        }
      }

      // The ASS renderer must be able to match the requested/subset font name
      // against legacy nameID 1, not only preferredFamily (nameID 16). This is
      // important for Source Han / 思源 fonts, whose legacy family can include
      // the weight ("思源黑体 Medium") while subtitles usually request the
      // preferred family ("思源黑体"). When outputFontName is an ASCII subset
      // alias, make it the English family so CFF/FreeType based providers can
      // match it without relying on localized name records.
      const targetLang = outputFamilyIsAscii ? "en" : "zh";
      merged.fontFamily[targetLang] = outputFamilyName;
      merged.preferredFamily = {
        ...(merged.preferredFamily ?? {}),
        [targetLang]: outputFamilyName,
      };

      const fullName = styleName && styleName.toLowerCase() !== "regular"
        ? `${outputFamilyName} ${styleName}`
        : outputFamilyName;
      merged.fullName[targetLang] = fullName;
      merged.fontSubfamily.en = styleName;
      merged.preferredSubfamily = {
        ...(merged.preferredSubfamily ?? {}),
        en: styleName,
      };

      const safePostScriptName = `${outputFamilyName}-${styleName}`
        .replace(/\s+/g, "")
        .replace(/[^\x21-\x7E]/g, "");
      if (safePostScriptName) {
        merged.postScriptName.en = safePostScriptName;
      }

      // postScriptName must be ASCII and contain no whitespace; sanitize each entry.
      if (merged.postScriptName) {
        for (const lang of Object.keys(merged.postScriptName)) {
          const v = merged.postScriptName[lang];
          if (!/^[\x20-\x7E]+$/.test(v) || /\s/.test(v)) {
            merged.postScriptName[lang] = (familyName + styleName).replace(/\s/g, "").replace(/[^\x20-\x7E]/g, "");
          }
        }
      }
      (newFont as unknown as { names: Record<string, Record<string, string>> }).names = merged;
    }
    if (os2Table) newFont.tables.os2 = os2Table;

    const subsetBytes = new Uint8Array(newFont.toArrayBuffer());
    const encoded = uuencode(subsetBytes);

    const bTag = weight > 400 ? "B" : "";
    const iTag = italic ? "I" : "";
    // Sanitize fontName for inclusion in the [Fonts] section header. Newlines,
    // carriage returns and `:` would terminate the `fontname:` line or split it
    // into a malformed entry that libass / mux tools reject. Strip control chars
    // and `:`; collapse internal whitespace runs.
    const safeFontName = outputFamilyName
      .replace(/[\x00-\x1F\x7F:]/g, "")
      .replace(/\s+/g, " ")
      .trim() || "font";
    // opentype.js always outputs CFF/OTF format (OTTO magic bytes) — use .otf extension
    // so tools like mkvtoolnix correctly identify the attachment format.
    const header = `fontname:${safeFontName}_${bTag}${iTag}0.otf\n`;

    // Filter characters commonly absent from fonts and not worth warning about
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
      [0x2600, 0x26FF], // Miscellaneous Symbols
      [0x2700, 0x27BF], // Dingbats
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

function extractTTCFace(ttcBuf: ArrayBuffer, faceIndex: number): ArrayBuffer {
  const view = new DataView(ttcBuf);
  const numFonts = view.getUint32(8, false);
  if (numFonts === 0 || numFonts > 256) throw new Error(`Invalid TTC: numFonts=${numFonts}`);

  if (faceIndex >= numFonts) {
    log("warn", `TTC faceIndex ${faceIndex} exceeds numFonts ${numFonts}, clamping to ${numFonts - 1}`);
  }
  const safeIndex = Math.min(faceIndex, numFonts - 1);
  const faceOffset = view.getUint32(12 + safeIndex * 4, false);
  if (faceOffset >= ttcBuf.byteLength) throw new Error("Invalid TTC: faceOffset out of bounds");

  const numTables = view.getUint16(faceOffset + 4, false);
  if (numTables === 0 || numTables > 128) throw new Error(`Invalid font: numTables=${numTables}`);
  const sfVersion = view.getUint32(faceOffset, false);

  interface TableRec { tag: string; checksum: number; offset: number; length: number }
  const tables: TableRec[] = [];
  for (let i = 0; i < numTables; i++) {
    const r = faceOffset + 12 + i * 16;
    if (r + 16 > ttcBuf.byteLength) throw new Error("Invalid font: table directory truncated");
    const length = view.getUint32(r + 12, false);
    tables.push({
      tag: String.fromCharCode(view.getUint8(r), view.getUint8(r+1), view.getUint8(r+2), view.getUint8(r+3)),
      checksum: view.getUint32(r + 4, false),
      offset: view.getUint32(r + 8, false),
      length,
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
    if (t.offset + t.length > src.length) {
      log("warn", `TTC table '${t.tag}' extends beyond file (offset=${t.offset}, length=${t.length}, fileSize=${src.length})`);
    }
    out.set(src.subarray(t.offset, end), newOffsets[i]);
  }

  return result;
}

function parseTTCFace(buf: ArrayBuffer, faceIndex: number): opentype.Font {
  return opentype.parse(extractTTCFace(buf, faceIndex), { lowMemory: true });
}
