/**
 * Font subsetter using opentype.js — pure JS, no WASM dependencies.
 *
 * Local version: No Worker memory constraints (128 MB limit removed).
 * Simplified vs. the Cloudflare Worker version — no two-phase GC tricks needed.
 * opentype.js runs without lowMemory mode restrictions.
 */

import * as opentype from "opentype.js";
import { uuencode } from "./uuencode.js";
import { readSfntTables, type SfntTableRecord } from "./font-validator.js";

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

type FontNames = Record<string, Record<string, string>>;

const NAME_TABLE_FIELDS = new Set([
  "copyright",
  "fontFamily",
  "fontSubfamily",
  "uniqueID",
  "fullName",
  "version",
  "postScriptName",
  "trademark",
  "manufacturer",
  "designer",
  "description",
  "manufacturerURL",
  "designerURL",
  "license",
  "licenseURL",
  "reserved",
  "preferredFamily",
  "preferredSubfamily",
  "compatibleFullName",
  "sampleText",
  "postScriptFindFontName",
  "wwsFamily",
  "wwsSubfamily",
]);

function addName(names: FontNames, field: string, lang: string, value: unknown): void {
  if (!NAME_TABLE_FIELDS.has(field) || typeof value !== "string" || value.length === 0) return;
  const entry = names[field] ?? {};
  entry[lang] = value;
  names[field] = entry;
}

function addNameBucket(names: FontNames, bucket: unknown): void {
  if (!bucket || typeof bucket !== "object") return;
  for (const [field, translations] of Object.entries(bucket as Record<string, unknown>)) {
    if (!NAME_TABLE_FIELDS.has(field) || !translations || typeof translations !== "object") continue;
    for (const [lang, value] of Object.entries(translations as Record<string, unknown>)) {
      addName(names, field, lang, value);
    }
  }
}

function normalizeFontNames(rawNames: unknown): FontNames {
  const names: FontNames = {};
  if (!rawNames || typeof rawNames !== "object") return names;
  const raw = rawNames as Record<string, unknown>;

  // opentype.js 1.3.4 exposes a flat name table:
  //   { fontFamily: { en: "...", zh: "..." }, ... }
  addNameBucket(names, raw);

  // opentype.js 1.3.5 exposes names grouped by platform:
  //   { macintosh: { fontFamily: {...} }, windows: { ... } }
  // Apply Windows last because it usually has the correct Unicode CJK records.
  for (const platform of ["unicode", "macintosh", "windows"]) {
    addNameBucket(names, raw[platform]);
  }

  // Be defensive for language-first shapes if a runtime changes again:
  //   { en: { fontFamily: "...", ... }, zh: { ... } }
  for (const [lang, fields] of Object.entries(raw)) {
    if (!fields || typeof fields !== "object" || NAME_TABLE_FIELDS.has(lang)) continue;
    for (const [field, value] of Object.entries(fields as Record<string, unknown>)) {
      addName(names, field, lang, value);
    }
  }

  return names;
}

function mergeFontNames(base: FontNames, override: FontNames): FontNames {
  const merged = JSON.parse(JSON.stringify(base)) as FontNames;
  for (const [field, translations] of Object.entries(override)) {
    merged[field] = {
      ...(merged[field] ?? {}),
      ...translations,
    };
  }
  return merged;
}

function usesPlatformNameBuckets(rawNames: unknown): boolean {
  if (!rawNames || typeof rawNames !== "object") return false;
  const raw = rawNames as Record<string, unknown>;
  return ["unicode", "macintosh", "windows"].some(platform =>
    raw[platform] && typeof raw[platform] === "object"
  );
}

function formatNamesForWriter(names: FontNames, writerTemplate: unknown): unknown {
  if (!usesPlatformNameBuckets(writerTemplate)) return names;

  const template = writerTemplate as Record<string, unknown>;
  const result: Record<string, FontNames> = {};
  for (const platform of ["unicode", "macintosh", "windows"]) {
    result[platform] = mergeFontNames(normalizeFontNames(template[platform]), names);
  }
  return result;
}

const OPTIONAL_LAYOUT_TABLES = new Set(["GDEF", "GPOS", "GSUB"]);
const VERTICAL_TABLES = new Set(["vhea", "vmtx", "VORG"]);
const GSUB_FEATURES = ["vert", "vrt2", "vkna", "ccmp", "liga", "clig", "rlig", "locl"] as const;
const GSUB_SCRIPTS = ["DFLT", "hani", "kana", "hang", "latn"];
const ORIGINAL_SFNT = Symbol("originalSfnt");

interface GsubSubstitution {
  getScriptNames?(): string[];
  getSingle?(feature: string, script?: string): Array<{ sub: number; by: number }>;
  getMultiple?(feature: string, script?: string): Array<{ sub: number; by: number[] }>;
  getLigatures?(feature: string, script?: string): Array<{ sub: number[]; by: number }>;
  addSingle?(feature: string, substitution: { sub: number; by: number }, script?: string): void;
  addMultiple?(feature: string, substitution: { sub: number; by: number[] }, script?: string): void;
  addLigature?(feature: string, ligature: { sub: number[]; by: number }, script?: string): void;
}

function gsubApi(font: opentype.Font): GsubSubstitution | null {
  return (font as unknown as { substitution?: GsubSubstitution }).substitution ?? null;
}

function gsubScripts(subst: GsubSubstitution): string[] {
  const names = subst.getScriptNames?.() ?? [];
  return [...new Set([...names, ...GSUB_SCRIPTS])];
}

function closeGsubGlyphs(font: opentype.Font, needed: Set<number>): void {
  const subst = gsubApi(font);
  if (!subst) return;
  const scripts = gsubScripts(subst);
  let growing = true;
  while (growing) {
    growing = false;
    for (const feature of GSUB_FEATURES) {
      for (const script of scripts) {
        try {
          for (const rule of subst.getSingle?.(feature, script) ?? []) {
            if (needed.has(rule.sub) && !needed.has(rule.by)) { needed.add(rule.by); growing = true; }
          }
          for (const rule of subst.getMultiple?.(feature, script) ?? []) {
            if (!needed.has(rule.sub)) continue;
            for (const glyphId of rule.by ?? []) {
              if (!needed.has(glyphId)) { needed.add(glyphId); growing = true; }
            }
          }
          for (const rule of subst.getLigatures?.(feature, script) ?? []) {
            if (rule.sub.every((glyphId) => needed.has(glyphId)) && !needed.has(rule.by)) {
              needed.add(rule.by);
              growing = true;
            }
          }
        } catch {
          // A malformed lookup must not abort subsetting.
        }
      }
    }
  }
}

function rewriteGsub(orig: opentype.Font, next: opentype.Font, remap: Map<number, number>): void {
  const src = gsubApi(orig);
  const dst = gsubApi(next);
  if (!src || !dst) return;

  const sourceScripts = gsubScripts(src);
  const writeScripts = [...new Set(["DFLT", "hani", "latn", ...sourceScripts])];
  try {
    for (const feature of GSUB_FEATURES) {
      const singles: Array<{ sub: number; by: number }> = [];
      const multiples: Array<{ sub: number; by: number[] }> = [];
      const ligatures: Array<{ sub: number[]; by: number }> = [];
      for (const script of sourceScripts) {
        try {
          for (const rule of src.getSingle?.(feature, script) ?? []) {
            const sub = remap.get(rule.sub);
            const by = remap.get(rule.by);
            if (sub !== undefined && by !== undefined) singles.push({ sub, by });
          }
          for (const rule of src.getMultiple?.(feature, script) ?? []) {
            const sub = remap.get(rule.sub);
            const by = (rule.by ?? []).map((glyphId) => remap.get(glyphId));
            if (sub !== undefined && by.every((glyphId): glyphId is number => glyphId !== undefined)) {
              multiples.push({ sub, by });
            }
          }
          for (const rule of src.getLigatures?.(feature, script) ?? []) {
            const components = rule.sub.map((glyphId) => remap.get(glyphId));
            const by = remap.get(rule.by);
            if (by !== undefined && components.every((glyphId): glyphId is number => glyphId !== undefined)) {
              ligatures.push({ sub: components, by });
            }
          }
        } catch {
          // Skip one script/feature pair.
        }
      }
      for (const script of writeScripts) {
        for (const rule of uniqueKey(singles, (item) => `${item.sub}->${item.by}`)) dst.addSingle?.(feature, rule, script);
        for (const rule of uniqueKey(multiples, (item) => `${item.sub}->${item.by.join(",")}`)) dst.addMultiple?.(feature, rule, script);
        for (const rule of uniqueKey(ligatures, (item) => `${item.sub.join("+")}->${item.by}`)) dst.addLigature?.(feature, rule, script);
      }
    }
  } catch {
    // Output remains usable without GSUB.
  }
}

function uniqueKey<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const id = key(item);
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(item);
  }
  return result;
}

function copyGlyphOutline(orig: opentype.Font, origGlyph: opentype.Glyph): opentype.Path {
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
  return newPath;
}

interface OriginalSfnt {
  bytes: Uint8Array;
  tables: Map<string, SfntTableRecord>;
}

type FontWithOriginalSfnt = opentype.Font & {
  [ORIGINAL_SFNT]?: OriginalSfnt;
};

function toUint8Array(buf: ArrayBuffer): Uint8Array {
  return new Uint8Array(buf);
}

function attachOriginalSfnt(font: opentype.Font, buf: ArrayBuffer): opentype.Font {
  try {
    const bytes = toUint8Array(buf);
    const { tables } = readSfntTables(buf);
    (font as FontWithOriginalSfnt)[ORIGINAL_SFNT] = {
      bytes,
      tables,
    };
  } catch {
    // Parsed font is still usable; vertical preservation is best-effort.
  }
  return font;
}

function shouldRetryWithoutLayoutTables(buf: ArrayBuffer): boolean {
  try {
    const { tables } = readSfntTables(buf);
    return [...OPTIONAL_LAYOUT_TABLES].some(tag => tables.has(tag));
  } catch {
    return false;
  }
}

function stripOptionalLayoutTables(buf: ArrayBuffer): ArrayBuffer | null {
  const { sfntVersion, tables } = readSfntTables(buf);
  const keptTables = [...tables.values()].filter(table => !OPTIONAL_LAYOUT_TABLES.has(table.tag));
  if (keptTables.length === tables.size || keptTables.length === 0) return null;

  const numTables = keptTables.length;
  const headerSize = 12 + numTables * 16;
  const newOffsets: number[] = [];
  let cursor = headerSize;
  for (const table of keptTables) {
    newOffsets.push(cursor);
    cursor += (table.length + 3) & ~3;
  }

  const result = new ArrayBuffer(cursor);
  const out = new Uint8Array(result);
  const outView = new DataView(result);
  const src = new Uint8Array(buf);

  outView.setUint32(0, sfntVersion, false);
  outView.setUint16(4, numTables, false);
  const entrySelector = Math.floor(Math.log2(numTables));
  const searchRange = (1 << entrySelector) * 16;
  outView.setUint16(6, searchRange, false);
  outView.setUint16(8, entrySelector, false);
  outView.setUint16(10, numTables * 16 - searchRange, false);

  for (let i = 0; i < keptTables.length; i++) {
    const table = keptTables[i];
    const recordOffset = 12 + i * 16;
    for (let j = 0; j < 4; j++) out[recordOffset + j] = table.tag.charCodeAt(j);
    outView.setUint32(recordOffset + 4, table.checksum, false);
    outView.setUint32(recordOffset + 8, newOffsets[i], false);
    outView.setUint32(recordOffset + 12, table.length, false);
    out.set(src.subarray(table.offset, table.offset + table.length), newOffsets[i]);
  }

  return result;
}

function parseOpenTypeFace(buf: ArrayBuffer): opentype.Font {
  try {
    return attachOriginalSfnt(opentype.parse(buf, { lowMemory: true }), buf);
  } catch (e) {
    if (!shouldRetryWithoutLayoutTables(buf)) throw e;

    const stripped = stripOptionalLayoutTables(buf);
    if (!stripped) throw e;

    try {
      return attachOriginalSfnt(opentype.parse(stripped, { lowMemory: true }), buf);
    } catch {
      throw e;
    }
  }
}

function sfntChecksum(bytes: Uint8Array): number {
  let sum = 0;
  const paddedLength = (bytes.length + 3) & ~3;
  for (let offset = 0; offset < paddedLength; offset += 4) {
    sum = (sum + (
      ((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)
    )) >>> 0;
  }
  return sum >>> 0;
}

function tableBytes(sfnt: OriginalSfnt, tag: string): Uint8Array | null {
  const table = sfnt.tables.get(tag);
  if (!table) return null;
  return sfnt.bytes.slice(table.offset, table.offset + table.length);
}

function addOrReplaceSfntTables(fontBytes: Uint8Array, extraTables: Record<string, Uint8Array>): Uint8Array {
  const source = fontBytes.buffer.slice(fontBytes.byteOffset, fontBytes.byteOffset + fontBytes.byteLength) as ArrayBuffer;
  const directory = readSfntTables(source);
  const sourceBytes = new Uint8Array(source);
  const replacements = new Set(Object.keys(extraTables));
  const tables = [
    ...[...directory.tables.values()]
      .filter(table => !replacements.has(table.tag))
      .map(table => {
        const data = sourceBytes.slice(table.offset, table.offset + table.length);
        if (table.tag === "head" && data.length >= 12) {
          data[8] = 0;
          data[9] = 0;
          data[10] = 0;
          data[11] = 0;
        }
        return { tag: table.tag, data };
      }),
    ...Object.entries(extraTables).map(([tag, data]) => ({ tag, data })),
  ].sort((a, b) => a.tag.localeCompare(b.tag));

  const numTables = tables.length;
  const headerSize = 12 + numTables * 16;
  const offsets: number[] = [];
  let cursor = headerSize;
  for (const table of tables) {
    offsets.push(cursor);
    cursor += (table.data.length + 3) & ~3;
  }

  const output = new Uint8Array(cursor);
  const view = new DataView(output.buffer);
  view.setUint32(0, directory.sfntVersion, false);
  view.setUint16(4, numTables, false);
  const entrySelector = Math.floor(Math.log2(numTables));
  const searchRange = (1 << entrySelector) * 16;
  view.setUint16(6, searchRange, false);
  view.setUint16(8, entrySelector, false);
  view.setUint16(10, numTables * 16 - searchRange, false);

  let headOffset = -1;
  for (let i = 0; i < tables.length; i++) {
    const table = tables[i];
    const recordOffset = 12 + i * 16;
    for (let j = 0; j < 4; j++) output[recordOffset + j] = table.tag.charCodeAt(j);
    view.setUint32(recordOffset + 4, sfntChecksum(table.data), false);
    view.setUint32(recordOffset + 8, offsets[i], false);
    view.setUint32(recordOffset + 12, table.data.length, false);
    output.set(table.data, offsets[i]);
    if (table.tag === "head") headOffset = offsets[i];
  }

  if (headOffset >= 0 && headOffset + 12 <= output.length) {
    view.setUint32(headOffset + 8, 0, false);
    const adjustment = (0xB1B0AFBA - sfntChecksum(output)) >>> 0;
    view.setUint32(headOffset + 8, adjustment, false);
  }

  return output;
}

function readVmtxMetric(vhea: Uint8Array, vmtx: Uint8Array, glyphIndex: number): { advanceHeight: number; topSideBearing: number } | null {
  if (vhea.length < 36 || vmtx.length < 4) return null;
  const vheaView = new DataView(vhea.buffer, vhea.byteOffset, vhea.byteLength);
  const metricCount = vheaView.getUint16(34, false);
  if (metricCount === 0) return null;

  const vmtxView = new DataView(vmtx.buffer, vmtx.byteOffset, vmtx.byteLength);
  if (glyphIndex < metricCount) {
    const offset = glyphIndex * 4;
    if (offset + 4 > vmtx.length) return null;
    return {
      advanceHeight: vmtxView.getUint16(offset, false),
      topSideBearing: vmtxView.getInt16(offset + 2, false),
    };
  }

  const lastLongOffset = (metricCount - 1) * 4;
  const sideBearingOffset = metricCount * 4 + (glyphIndex - metricCount) * 2;
  if (lastLongOffset + 2 > vmtx.length || sideBearingOffset + 2 > vmtx.length) return null;
  return {
    advanceHeight: vmtxView.getUint16(lastLongOffset, false),
    topSideBearing: vmtxView.getInt16(sideBearingOffset, false),
  };
}

function buildVheaTable(source: Uint8Array, glyphCount: number, maxAdvanceHeight: number): Uint8Array | null {
  if (source.length < 36 || glyphCount > 0xffff) return null;
  const table = source.slice();
  const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
  view.setUint16(10, Math.min(maxAdvanceHeight, 0xffff), false);
  view.setInt16(32, 0, false);
  view.setUint16(34, glyphCount, false);
  return table;
}

function buildVmtxTable(sfnt: OriginalSfnt, originalGlyphIndices: number[]): { table: Uint8Array; maxAdvanceHeight: number } | null {
  const vhea = tableBytes(sfnt, "vhea");
  const vmtx = tableBytes(sfnt, "vmtx");
  if (!vhea || !vmtx || originalGlyphIndices.length > 0xffff) return null;

  const output = new Uint8Array(originalGlyphIndices.length * 4);
  const view = new DataView(output.buffer);
  let maxAdvanceHeight = 0;

  for (let i = 0; i < originalGlyphIndices.length; i++) {
    const metric = readVmtxMetric(vhea, vmtx, originalGlyphIndices[i]);
    if (!metric) return null;
    view.setUint16(i * 4, metric.advanceHeight, false);
    view.setInt16(i * 4 + 2, metric.topSideBearing, false);
    maxAdvanceHeight = Math.max(maxAdvanceHeight, metric.advanceHeight);
  }

  return { table: output, maxAdvanceHeight };
}

function parseVorgOrigins(vorg: Uint8Array): { major: number; minor: number; defaultOrigin: number; origins: Map<number, number> } | null {
  if (vorg.length < 8) return null;
  const view = new DataView(vorg.buffer, vorg.byteOffset, vorg.byteLength);
  const count = view.getUint16(6, false);
  if (8 + count * 4 > vorg.length) return null;

  const origins = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    origins.set(view.getUint16(8 + i * 4, false), view.getInt16(10 + i * 4, false));
  }

  return {
    major: view.getUint16(0, false),
    minor: view.getUint16(2, false),
    defaultOrigin: view.getInt16(4, false),
    origins,
  };
}

function buildVorgTable(sfnt: OriginalSfnt, originalGlyphIndices: number[]): Uint8Array | null {
  const source = tableBytes(sfnt, "VORG");
  if (!source || originalGlyphIndices.length > 0xffff) return null;
  const parsed = parseVorgOrigins(source);
  if (!parsed) return null;

  const output = new Uint8Array(8 + originalGlyphIndices.length * 4);
  const view = new DataView(output.buffer);
  view.setUint16(0, parsed.major, false);
  view.setUint16(2, parsed.minor, false);
  view.setInt16(4, parsed.defaultOrigin, false);
  view.setUint16(6, originalGlyphIndices.length, false);
  for (let i = 0; i < originalGlyphIndices.length; i++) {
    view.setUint16(8 + i * 4, i, false);
    view.setInt16(10 + i * 4, parsed.origins.get(originalGlyphIndices[i]) ?? parsed.defaultOrigin, false);
  }
  return output;
}

function preserveVerticalLayoutTables(
  subsetBytes: Uint8Array,
  orig: opentype.Font,
  originalGlyphIndices: number[],
): Uint8Array {
  const sfnt = (orig as FontWithOriginalSfnt)[ORIGINAL_SFNT];
  if (!sfnt) return subsetBytes;
  if (![...VERTICAL_TABLES].some(tag => sfnt.tables.has(tag))) return subsetBytes;

  try {
    const vmtx = buildVmtxTable(sfnt, originalGlyphIndices);
    const sourceVhea = tableBytes(sfnt, "vhea");
    if (!vmtx || !sourceVhea) return subsetBytes;

    const vhea = buildVheaTable(sourceVhea, originalGlyphIndices.length, vmtx.maxAdvanceHeight);
    if (!vhea) return subsetBytes;

    const tables: Record<string, Uint8Array> = { vhea, vmtx: vmtx.table };
    const vorg = buildVorgTable(sfnt, originalGlyphIndices);
    if (vorg) tables.VORG = vorg;
    return addOrReplaceSfntTables(subsetBytes, tables);
  } catch {
    // Malformed optional vertical tables must not make the whole subset fail.
    return subsetBytes;
  }
}

export function parseFontFace(fontBytes: Uint8Array, faceIndex: number): opentype.Font {
  const buf = toArrayBuffer(fontBytes);
  return isTTC(fontBytes)
    ? parseTTCFace(buf, faceIndex)
    : parseOpenTypeFace(buf);
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
  postScriptBaseName = outputFontName,
): Promise<FontSubsetResult> {
  try {
    return subsetParsedFont(parseFontFace(fontBytes, faceIndex), fontName, weight, italic, unicodes, outputFontName, postScriptBaseName);
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
  postScriptBaseName = outputFontName,
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
    const originalGlyphIndices: number[] = [0];
    const needed = new Set<number>([0]);
    const unicodeForGlyph = new Map<number, number>();
    const missing: string[] = [];

    for (const cp of unicodes) {
      const char = String.fromCodePoint(cp);
      const glyphIndex = orig.charToGlyphIndex(char);
      const origGlyph = glyphIndex ? orig.glyphs.get(glyphIndex) : null;
      if (!origGlyph || glyphIndex === 0) {
        missing.push(char);
        continue;
      }
      needed.add(glyphIndex);
      if (!unicodeForGlyph.has(glyphIndex)) unicodeForGlyph.set(glyphIndex, cp);
    }
    closeGsubGlyphs(orig, needed);

    for (const glyphIndex of needed) {
      if (glyphIndex === 0) continue;
      const origGlyph = orig.glyphs.get(glyphIndex);
      if (!origGlyph) continue;
      const unicode = unicodeForGlyph.get(glyphIndex);
      glyphs.push(new opentype.Glyph({
        name: origGlyph.name || (unicode !== undefined ? `glyph_${unicode}` : `gid_${glyphIndex}`),
        ...(unicode !== undefined ? { unicode } : {}),
        advanceWidth: origGlyph.advanceWidth,
        path: copyGlyphOutline(orig, origGlyph),
      }));
      originalGlyphIndices.push(glyphIndex);
    }

    // Pick a sensible ASCII family/style for the constructor — opentype.js uses these
    // to build a default postScriptName (which must be ASCII per spec).
    const origNames = normalizeFontNames((orig as unknown as { names?: unknown }).names);
    const pickName = (id: string): string | null => {
      const entry = origNames[id];
      if (!entry) return null;
      return entry["en"] ?? entry["en-US"] ?? Object.values(entry).find(v => /^[\x20-\x7E]+$/.test(v)) ?? Object.values(entry)[0] ?? null;
    };

    const isAscii = (value: string) => /^[\x20-\x7E]+$/.test(value);
    const sanitizePostScript = (value: string) => value
      .replace(/\s+/g, "")
      .replace(/[^\x21-\x7E]/g, "");
    const outputFamilyName = outputFontName.trim() || fontName;
    const outputFamilyIsAscii = isAscii(outputFamilyName);
    const familyName =
      (outputFamilyIsAscii ? outputFamilyName : null) ??
      Object.values(origNames.fontFamily ?? {}).find(isAscii) ??
      (sanitizePostScript(postScriptBaseName) || "font");
    const rawStyleName = pickName("preferredSubfamily") ?? pickName("fontSubfamily") ?? "Regular";
    const styleName = isAscii(rawStyleName) ? rawStyleName : "Regular";
    const safePostScriptBase = sanitizePostScript(postScriptBaseName || familyName || "font") || "font";
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
      const rawNewNames = (newFont as unknown as { names: unknown }).names;
      const newNames = normalizeFontNames(rawNewNames);
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
            (key === "fontFamily" ? familyName : null) ??
            (key === "fontSubfamily" ? styleName : null) ??
            (key === "fullName" ? `${familyName} ${styleName}` : null) ??
            (key === "postScriptName" ? `${safePostScriptBase}-${sanitizePostScript(styleName) || "Regular"}` : null) ??
            Object.values(merged[key])[0];
          if (fallback) merged[key].en = fallback;
        }
      }
      if (!isAscii(merged.fontFamily.en ?? "")) merged.fontFamily.en = familyName;
      if (!isAscii(merged.fontSubfamily.en ?? "")) merged.fontSubfamily.en = styleName;
      if (!isAscii(merged.fullName.en ?? "")) merged.fullName.en = `${familyName} ${styleName}`;

      // The ASS renderer must be able to match the requested/subset font name
      // against legacy nameID 1, not only preferredFamily (nameID 16). This is
      // important for Source Han / 思源 fonts, whose legacy family can include
      // the weight ("思源黑体 Medium") while subtitles usually request the
      // preferred family ("思源黑体"). Alias mode writes an ASCII family; preserve
      // mode keeps the localized public family while CFF/PostScript stays ASCII.
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

      const safePostScriptName = `${safePostScriptBase}-${sanitizePostScript(styleName) || "Regular"}`
        .replace(/^-+/, "")
        .replace(/-+$/, "");
      if (safePostScriptName) {
        merged.postScriptName.en = safePostScriptName;
      }

      // postScriptName must be ASCII and contain no whitespace; sanitize each entry.
      if (merged.postScriptName) {
        for (const lang of Object.keys(merged.postScriptName)) {
          const v = merged.postScriptName[lang];
          if (!/^[\x20-\x7E]+$/.test(v) || /\s/.test(v)) {
            merged.postScriptName[lang] = safePostScriptName;
          }
        }
      }
      (newFont as unknown as { names: unknown }).names = formatNamesForWriter(merged, rawNewNames);
    }
    if (os2Table) newFont.tables.os2 = os2Table as typeof newFont.tables.os2;

    const remap = new Map<number, number>();
    originalGlyphIndices.forEach((oldIndex, newIndex) => remap.set(oldIndex, newIndex));
    rewriteGsub(orig, newFont, remap);

    const subsetBytes = preserveVerticalLayoutTables(new Uint8Array(newFont.toArrayBuffer()), orig, originalGlyphIndices);
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
    faceIndex = numFonts - 1;
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
    out.set(src.subarray(t.offset, end), newOffsets[i]);
  }

  return result;
}

function parseTTCFace(buf: ArrayBuffer, faceIndex: number): opentype.Font {
  return parseOpenTypeFace(extractTTCFace(buf, faceIndex));
}
