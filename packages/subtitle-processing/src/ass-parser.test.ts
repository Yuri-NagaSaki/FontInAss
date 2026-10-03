import { describe, expect, test } from "bun:test";
import { renameAssFonts } from "./ass-parser.js";

describe("renameAssFonts", () => {
  test("renames font fields and override tags without changing other text", () => {
    const input = String.raw`[Script Info]
Title: F1234567,{\fnF1234567}
[V4+ Styles]
Format: Name, Fontname, Fontsize
Style: F1234567, @f1234567 ,20
[Events]
Format: Layer, Style, Name, Effect, Text
Dialogue: 0,F1234567,F1234567,{\fnF1234567},A,F1234567,{\fn@F1234567}A{\fnF1234567\b1}A \fnF1234567
Comment: 0,F1234567,,,{\fnF1234567}A
[Aegisub Project Garbage]
Text: {\fnF1234567}
`;
    const expected = String.raw`[Script Info]
Title: F1234567,{\fnF1234567}
[V4+ Styles]
Format: Name, Fontname, Fontsize
Style: F1234567, @Original $& ,20
[Events]
Format: Layer, Style, Name, Effect, Text
Dialogue: 0,F1234567,F1234567,{\fnF1234567},A,F1234567,{\fn@Original $&}A{\fnOriginal $&\b1}A \fnF1234567
Comment: 0,F1234567,,,{\fnOriginal $&}A
[Aegisub Project Garbage]
Text: {\fnF1234567}
`;
    expect(renameAssFonts(input, { f1234567: "Original $&" })).toBe(expected);
  });

  test("uses Format column positions and preserves CRLF and font whitespace", () => {
    const input = String.raw`[V4+ Styles]
Format: Fontname, Name, Fontsize
Style: @F1234567,Default,20
[Events]
Format: Style, Text
Dialogue: Default,{\fn F1234567  }A{\fn}A{\fnF12345670}A{\fnConstructor}A
`.replaceAll("\n", "\r\n");
    const expected = String.raw`[V4+ Styles]
Format: Fontname, Name, Fontsize
Style: @Fixture,Default,20
[Events]
Format: Style, Text
Dialogue: Default,{\fn Fixture  }A{\fn}A{\fnF12345670}A{\fnConstructor}A
`.replaceAll("\n", "\r\n");
    expect(renameAssFonts(input, { f1234567: "Fixture" })).toBe(expected);
  });

  test("applies mappings once when an original name is another alias", () => {
    const input = String.raw`[V4+ Styles]
Format: Name, Fontname
Style: Default,F1234567
[Events]
Format: Style, Text
Dialogue: Default,{\fnF1234567}A{\fnF7654321}A
`;
    const output = renameAssFonts(input, { f1234567: "F7654321", f7654321: "Fixture" });
    expect(output).toContain("Style: Default,F7654321");
    expect(output).toContain(String.raw`{\fnF7654321}A{\fnFixture}A`);
  });
});
