import { describe, expect, test } from "bun:test";
import * as opentype from "opentype.js";
import { CODE } from "@fontinass/contracts";
import { DefaultSubtitleProcessor, type FontSource } from "./processor.js";

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

function assBytes(): Uint8Array {
  const text = `[Script Info]
Title: fixture
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Fixture,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,A
`;
  return new TextEncoder().encode(text);
}

function source(onLoad: () => void): FontSource {
  const bytes = fixtureFont();
  return {
    match(requests) {
      const result = new Map();
      for (const request of requests) result.set(request.key, { key: "fixture.ttf", fontIndex: 0 });
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
