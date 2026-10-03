import { describe, expect, test } from "bun:test";
import { analyseAss, checkFontsSection, removeSection, renameAssFonts } from "./ass-parser.js";

function analyse(text: string, style = "Default,Fixture,-1,-1", section = "V4+ Styles") {
  return analyseAss(`[Script Info]\n[${section}]\nFormat: Name, Fontname, Bold, Italic\nStyle: ${style}\n[Events]\nFormat: Style, Text\nDialogue: Default,${text}`);
}

describe("ASS and SSA font usage", () => {
  test("recognizes negative style booleans and SSA sections", () => {
    expect([...analyse("A", undefined, "V4 Styles").fontCharMap["fixture|700|1"]]).toEqual([65]);
  });
  test("ignores drawings and restores default styles for bare tags", () => {
    const result = analyse(String.raw`{\p1}m 0 0 l 50 50{\p0\b0\i0}B{\b\i}A`);
    expect([...result.fontCharMap["fixture|400|0"]]).toEqual([66]);
    expect([...result.fontCharMap["fixture|700|1"]]).toEqual([65]);
  });
  test("includes hard spaces and soft line break spaces", () => {
    expect([...analyse(String.raw`A\hB\nC\ND`).fontCharMap["fixture|700|1"]]).toEqual([65, 160, 66, 32, 67, 68]);
  });
  test("retains both font styles across transforms without leaking parentheses", () => {
    const result = analyse(String.raw`{\t(0,100,\b0)}A`);
    expect([...result.fontCharMap["fixture|700|1"]]).toEqual([65]);
    expect([...result.fontCharMap["fixture|400|1"]]).toEqual([65]);
  });
  test("supports prototype-shaped names and preserves dialogue trailing spaces", () => {
    expect([...analyse("A ", "Default,constructor,0,0").fontCharMap["constructor|400|0"]]).toEqual([65,32]);
  });
  test("accepts mixed case sections and intervening metadata", () => {
    const text = "[v4+ styles]\nFormat: Name,Fontname\nStyle: Default,Fixture\n[Aegisub Project Garbage]\nfoo\n[events]\nFormat: Style,Text\nDialogue: Default,A";
    expect([...analyseAss(text).fontCharMap["fixture|400|0"]]).toEqual([65]);
  });
  test("finds Fonts only at section boundaries", () => {
    const text = "[Script Info]\nTitle: [Fonts]\n[Fonts]\nfontname:a.ttf\nABC[DEF\n[Events]\nDialogue: A";
    expect(checkFontsSection(text)).toBe(2);
    expect(removeSection(text,"Fonts")).toBe("[Script Info]\nTitle: [Fonts]\n[Events]\nDialogue: A");
  });
});

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
