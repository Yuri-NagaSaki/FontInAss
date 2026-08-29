import { describe, expect, test } from "bun:test";
import * as opentype from "opentype.js";
import { readSfntTables } from "./font-validator.js";
import { parseFontFace, subsetParsedFont } from "./opentype-subsetter.js";
import { uudecode } from "./uuencode.js";

function checksum(bytes: Uint8Array): number {
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

function makeVheaTable(glyphCount: number): Uint8Array {
  const bytes = new Uint8Array(36);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x00010000, false);
  view.setInt16(4, 880, false);
  view.setInt16(6, -120, false);
  view.setUint16(10, 1000, false);
  view.setInt16(18, 1, false);
  view.setInt16(32, 0, false);
  view.setUint16(34, glyphCount, false);
  return bytes;
}

function makeVmtxTable(glyphCount: number): Uint8Array {
  const bytes = new Uint8Array(glyphCount * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < glyphCount; i++) {
    view.setUint16(i * 4, 1000, false);
    view.setInt16(i * 4 + 2, 80, false);
  }
  return bytes;
}

function makeVorgTable(glyphCount: number): Uint8Array {
  const bytes = new Uint8Array(8 + glyphCount * 4);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 1, false);
  view.setUint16(2, 0, false);
  view.setInt16(4, 880, false);
  view.setUint16(6, glyphCount, false);
  for (let i = 0; i < glyphCount; i++) {
    view.setUint16(8 + i * 4, i, false);
    view.setInt16(10 + i * 4, 880, false);
  }
  return bytes;
}

function addSfntTables(fontBytes: Uint8Array, extraTables: Record<string, Uint8Array>): Uint8Array {
  const source = fontBytes.buffer.slice(fontBytes.byteOffset, fontBytes.byteOffset + fontBytes.byteLength) as ArrayBuffer;
  const directory = readSfntTables(source);
  const sourceBytes = new Uint8Array(source);
  const tables = [
    ...[...directory.tables.values()].map(table => ({
      tag: table.tag,
      data: sourceBytes.slice(table.offset, table.offset + table.length),
    })),
    ...Object.entries(extraTables).map(([tag, data]) => ({ tag, data })),
  ].sort((a, b) => a.tag.localeCompare(b.tag));

  const numTables = tables.length;
  const headerSize = 12 + numTables * 16;
  let cursor = headerSize;
  const offsets: number[] = [];
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

  for (let i = 0; i < tables.length; i++) {
    const table = tables[i];
    const recordOffset = 12 + i * 16;
    for (let j = 0; j < 4; j++) output[recordOffset + j] = table.tag.charCodeAt(j);
    view.setUint32(recordOffset + 4, checksum(table.data), false);
    view.setUint32(recordOffset + 8, offsets[i], false);
    view.setUint32(recordOffset + 12, table.data.length, false);
    output.set(table.data, offsets[i]);
  }

  return output;
}

function makeVerticalFixtureFont(): Uint8Array {
  const path = new opentype.Path();
  path.moveTo(80, 0);
  path.lineTo(300, 700);
  path.lineTo(520, 0);
  path.close();

  const font = new opentype.Font({
    familyName: "VerticalFixture",
    styleName: "Regular",
    unitsPerEm: 1000,
    ascender: 880,
    descender: -120,
    glyphs: [
      new opentype.Glyph({ name: ".notdef", advanceWidth: 500, path: new opentype.Path() }),
      new opentype.Glyph({ name: "A", unicode: 65, advanceWidth: 600, path }),
    ],
  });
  const bytes = new Uint8Array(font.toArrayBuffer());
  return addSfntTables(bytes, {
    vhea: makeVheaTable(2),
    vmtx: makeVmtxTable(2),
    VORG: makeVorgTable(2),
  });
}

function decodeSubsetFont(encoded: string): Uint8Array {
  return uudecode(encoded.split("\n").slice(1).join("\n"));
}

interface SubstitutionApi {
  addSingle(feature: string, substitution: { sub: number; by: number }, script?: string): void;
  addLigature(feature: string, ligature: { sub: number[]; by: number }, script?: string): void;
  getSingle(feature: string, script?: string): Array<{ sub: number; by: number }>;
  getLigatures(feature: string, script?: string): Array<{ sub: number[]; by: number }>;
}

function substitution(font: opentype.Font): SubstitutionApi {
  return (font as unknown as { substitution: SubstitutionApi }).substitution;
}

function parseSubset(encoded: string): opentype.Font {
  return parseFontFace(decodeSubsetFont(encoded), 0);
}

function makeVertGsubFont(): Uint8Array {
  const horizontal = new opentype.Path();
  horizontal.moveTo(0, 0);
  horizontal.lineTo(600, 0);
  horizontal.lineTo(600, 100);
  horizontal.close();
  const vertical = new opentype.Path();
  vertical.moveTo(0, 0);
  vertical.lineTo(100, 0);
  vertical.lineTo(100, 800);
  vertical.close();
  const font = new opentype.Font({
    familyName: "VertGsub",
    styleName: "Regular",
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs: [
      new opentype.Glyph({ name: ".notdef", advanceWidth: 500, path: new opentype.Path() }),
      new opentype.Glyph({ name: "A", unicode: 65, advanceWidth: 600, path: horizontal }),
      new opentype.Glyph({ name: "A.vert", advanceWidth: 800, path: vertical }),
    ],
  });
  substitution(font).addSingle("vert", { sub: 1, by: 2 });
  return new Uint8Array(font.toArrayBuffer());
}

function makeLigaFont(): Uint8Array {
  const stem = new opentype.Path();
  stem.moveTo(0, 0);
  stem.lineTo(50, 0);
  stem.lineTo(50, 700);
  stem.close();
  const wide = new opentype.Path();
  wide.moveTo(0, 0);
  wide.lineTo(900, 0);
  wide.lineTo(900, 700);
  wide.close();
  const font = new opentype.Font({
    familyName: "LigaFixture",
    styleName: "Regular",
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs: [
      new opentype.Glyph({ name: ".notdef", advanceWidth: 500, path: new opentype.Path() }),
      new opentype.Glyph({ name: "f", unicode: 102, advanceWidth: 400, path: stem }),
      new opentype.Glyph({ name: "i", unicode: 105, advanceWidth: 300, path: stem }),
      new opentype.Glyph({ name: "fi", advanceWidth: 700, path: wide }),
    ],
  });
  substitution(font).addLigature("liga", { sub: [1, 2], by: 3 });
  return new Uint8Array(font.toArrayBuffer());
}

describe("subsetParsedFont", () => {
  test("preserves vertical layout tables needed by ASS @ fonts", () => {
    const parsed = parseFontFace(makeVerticalFixtureFont(), 0);
    const result = subsetParsedFont(parsed, "VerticalFixture", 400, false, new Set([65]), "FVERT001", "FVERT001");

    expect(result.error).toBeNull();
    const bytes = decodeSubsetFont(result.encoded);
    const tables = readSfntTables(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer).tables;
    expect(tables.has("vhea")).toBe(true);
    expect(tables.has("vmtx")).toBe(true);
    expect(tables.has("VORG")).toBe(true);
  });

  test("keeps GSUB vert alternates that cmap does not name", () => {
    const parsed = parseFontFace(makeVertGsubFont(), 0);
    expect(substitution(parsed).getSingle("vert")).toEqual([{ sub: 1, by: 2 }]);

    const result = subsetParsedFont(parsed, "VertGsub", 400, false, new Set([65]), "FVERT002", "FVERT002");
    expect(result.error).toBeNull();
    const subset = parseSubset(result.encoded);
    const glyphCount = subset.numGlyphs ?? subset.glyphs.length;
    expect(glyphCount).toBe(3);
    expect(substitution(subset).getSingle("vert")).toEqual([{ sub: 1, by: 2 }]);
    expect(subset.charToGlyphIndex("A")).toBe(1);
    expect(subset.glyphs.get(2)?.advanceWidth).toBe(800);
  });

  test("keeps liga glyphs that are only reachable through GSUB", () => {
    const parsed = parseFontFace(makeLigaFont(), 0);
    expect(substitution(parsed).getLigatures("liga")).toEqual([{ sub: [1, 2], by: 3 }]);

    const result = subsetParsedFont(parsed, "LigaFixture", 400, false, new Set([102, 105]), "FLIGA001", "FLIGA001");
    expect(result.error).toBeNull();
    const subset = parseSubset(result.encoded);
    expect(subset.numGlyphs ?? subset.glyphs.length).toBe(4);
    expect(substitution(subset).getLigatures("liga")).toEqual([{ sub: [1, 2], by: 3 }]);
    expect(subset.glyphs.get(3)?.advanceWidth).toBe(700);
  });
});
