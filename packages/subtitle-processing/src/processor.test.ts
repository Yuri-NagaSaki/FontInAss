import { describe, expect, test } from "bun:test";
import * as opentype from "opentype.js";
import { CODE } from "@fontinass/contracts";
import { DefaultSubtitleProcessor, type FontSource } from "./processor.js";
import { analyseAss, removeSection } from "./ass-parser.js";
import { uudecode } from "./uuencode.js";

function fixtureFont(): Uint8Array {
  const path = new opentype.Path();
  path.moveTo(80, 0); path.lineTo(300, 700); path.lineTo(520, 0); path.close();
  const font = new opentype.Font({
    familyName: "Fixture", styleName: "Regular", unitsPerEm: 1000, ascender: 880, descender: -120,
    glyphs: [
      new opentype.Glyph({ name: ".notdef", advanceWidth: 500, path: new opentype.Path() }),
      new opentype.Glyph({ name: "A", unicode: 65, advanceWidth: 600, path }),
    ],
  });
  return new Uint8Array(font.toArrayBuffer());
}

function assBytes(fontName = "Fixture", dialogue = "A"): Uint8Array {
  const text = `[Script Info]
Title: fixture
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,${dialogue}
`;
  return new TextEncoder().encode(text);
}

function source(onLoad: () => void): FontSource {
  const bytes = fixtureFont();
  return {
    match(requests) {
      const result = new Map();
      for (const request of requests) result.set(request.key, request.nameLower === "fixture" ? { key: "fixture.ttf", fontIndex: 0 } : null);
      return result;
    },
    async load() {
      onLoad();
      return { bytes, resolvedKey: "fixture.ttf" };
    },
  };
}

const silent = { debug() {}, info() {}, warn() {}, error() {} };

describe("DefaultSubtitleProcessor", () => {
  for (const prefix of ["", "@"]) {
    test(`restores ${prefix ? "vertical" : "horizontal"} aliases and embedded family names for repeated processing`, async () => {
      const processor = new DefaultSubtitleProcessor(source(() => {}), silent, { cacheEntries: 0 });
      const original = assBytes(`${prefix}Fixture`, `A{\\fn${prefix}Fixture}A`);
      const aliased = await processor.process({ filename: "a.ass", bytes: original, options: { fontsCheck: true } });
      expect(aliased.code).toBe(CODE.OK);
      const aliasText = new TextDecoder().decode(aliased.data!);
      const [[alias, originalName]] = Object.entries(analyseAss(removeSection(aliasText, "Fonts")).subRename);
      expect(originalName).toBe("Fixture");
      expect(aliasText).toContain(`Style: Default,${prefix}${alias},`);
      expect(aliasText).toContain(`{\\fn${prefix}${alias}}`);

      const options = { fontNameMode: "preserve" as const, clearFonts: true, fontsCheck: true };
      const restored = await processor.process({ filename: "a.ass", bytes: aliased.data!, options });
      expect(restored.code).toBe(CODE.OK);
      const restoredText = new TextDecoder().decode(restored.data!);
      expect(removeSection(restoredText, "Fonts").trim()).toBe(new TextDecoder().decode(original).trim());
      expect(restoredText).not.toContain("; Font Subset:");
      expect(restoredText).toContain("fontname:Fixture_0.otf\n");
      const fontBlock = restoredText.split("fontname:Fixture_0.otf\n")[1].split("[Events]")[0];
      const embedded = opentype.parse(uudecode(fontBlock.trim()).buffer as ArrayBuffer);
      expect(embedded.getEnglishName("fontFamily")).toBe("Fixture");

      const repeated = await processor.process({ filename: "a.ass", bytes: restored.data!, options });
      expect(repeated.code).toBe(CODE.OK);
      expect(new TextDecoder().decode(repeated.data!)).toBe(restoredText);
    });
  }

  test("reports how many font variants were processed", async () => {
    const processor = new DefaultSubtitleProcessor(source(() => {}), silent, { cacheEntries: 0 });
    const result = await processor.process({ filename: "a.ass", bytes: assBytes() });
    expect(result.code).toBe(CODE.OK);
    expect(result.fontCount).toBe(1);
    expect(result.data?.byteLength).toBeGreaterThan(0);
  });

  test("serves identical successful results from cache", async () => {
    let loads = 0;
    const processor = new DefaultSubtitleProcessor(source(() => { loads++; }), silent, { cacheEntries: 8, cacheBytes: 64 * 1024 * 1024 });
    const bytes = assBytes();
    const first = await processor.process({ filename: "a.ass", bytes });
    const second = await processor.process({ filename: "a.ass", bytes });
    expect(first.code).toBe(CODE.OK);
    expect(second.code).toBe(CODE.OK);
    expect(loads).toBe(1);
  });

  test("evicts cached results that exceed the byte budget", async () => {
    let loads = 0;
    const processor = new DefaultSubtitleProcessor(source(() => { loads++; }), silent, { cacheEntries: 8, cacheBytes: 1 });
    const bytes = assBytes();
    await processor.process({ filename: "a.ass", bytes });
    await processor.process({ filename: "a.ass", bytes });
    expect(loads).toBe(2);
  });
});
