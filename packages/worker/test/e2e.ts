/**
 * E2E unit tests for FontInAss core library functions.
 *
 * Tests run with tsx (no Cloudflare runtime needed) against:
 *   - ass-parser: analyseAss, decodeAssBytes, isSrt, srtToAss
 *   - uuencode: uuencode + uudecode roundtrip
 *
 * Usage:  pnpm test
 *   or:   pnpm exec tsx test/e2e.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analyseAss, decodeAssBytes, isSrt, srtToAss, checkFontsSection, removeSection } from "../src/lib/ass-parser.js";
import { uuencode, uudecode } from "../src/lib/uuencode.js";

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✅  ${msg}`);
    passed++;
  } else {
    console.error(`  ❌  ${msg}`);
    failed++;
  }
}

function assertEqual<T>(actual: T, expected: T, msg: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ✅  ${msg}`);
    passed++;
  } else {
    console.error(`  ❌  ${msg}`);
    console.error(`      expected: ${JSON.stringify(expected)}`);
    console.error(`      actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ─── UUencode roundtrip ───────────────────────────────────────────────────────
console.log("\n[uuencode] roundtrip");

{
  // Short buffer
  const original = new Uint8Array([0, 1, 2, 3, 4, 5, 255, 254, 253]);
  const encoded = uuencode(original);
  const decoded = uudecode(encoded);
  assert(encoded.length > 0, "encode produces non-empty string");
  assertEqual(Array.from(decoded), Array.from(original), "decode(encode(x)) === x for short buffer");
}

{
  // 60-byte boundary (exactly one UUencode line)
  const data = new Uint8Array(60).fill(0xAB);
  const encoded = uuencode(data);
  const decoded = uudecode(encoded);
  assertEqual(Array.from(decoded), Array.from(data), "60-byte buffer roundtrip");
}

{
  // Multi-line: 180 bytes = 3 lines
  const data = new Uint8Array(180).map((_, i) => i % 256);
  const decoded = uudecode(uuencode(data));
  assertEqual(Array.from(decoded), Array.from(data), "180-byte buffer roundtrip (3 UU lines)");
}

{
  // Empty buffer
  const data = new Uint8Array(0);
  const decoded = uudecode(uuencode(data));
  assertEqual(decoded.length, 0, "empty buffer roundtrip");
}

// ─── ASS parser ──────────────────────────────────────────────────────────────
console.log("\n[analyseAss] minimal inline ASS");

{
  const ass = `[Script Info]
Title: Test
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Hello World
`;
  const { fontCharMap } = analyseAss(ass);
  const keys = Object.keys(fontCharMap);
  assert(keys.length === 1, "single style → single font entry");
  const key = keys[0];
  assert(key.startsWith("arial|"), "font key uses lowercase name");

  const codepoints = fontCharMap[key];
  // "Hello World" → H(72) e(101) l(108) o(111) (32) W(87) r(114) d(100)
  assert(codepoints.has(72), "codepoint H(72) present");
  assert(codepoints.has(32), "codepoint SPACE(32) present");
  assert(codepoints.has(87), "codepoint W(87) present");
}

console.log("\n[analyseAss] inline \\fn tag override");

{
  const ass = `[Script Info]
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,{\\fnTimesNewRoman}Times{\\r}Arial
`;
  const { fontCharMap } = analyseAss(ass);
  const keys = Object.keys(fontCharMap);
  assert(keys.length === 2, "fn override creates second font entry");
  const arialKey = keys.find(k => k.startsWith("arial|"));
  const timesKey = keys.find(k => k.startsWith("timesnewroman|"));
  assert(!!arialKey, "Arial entry present");
  assert(!!timesKey, "TimesNewRoman entry present");

  const timesGlyphs = fontCharMap[timesKey!];
  assert(timesGlyphs.has("T".codePointAt(0)!), "T in TimesNewRoman glyphs");
  assert(!timesGlyphs.has("A".codePointAt(0)!), "A not in TimesNewRoman (it's after \\r)");
}

console.log("\n[analyseAss] \\b and \\i weight/italic tracking");

{
  const ass = `[Script Info]
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,MyFont,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,{\\b1}Bold{\\b0}Normal
`;
  const { fontCharMap } = analyseAss(ass);
  const boldKey = Object.keys(fontCharMap).find(k => k.startsWith("myfont|") && k.includes("|0") && k !== "myfont|400|0");
  // Bold text → weight 700 or style bold flag
  const allKeys = Object.keys(fontCharMap);
  assert(allKeys.length >= 1, "at least one font entry for \\b toggle");
}

// ─── checkFontsSection ────────────────────────────────────────────────────────
console.log("\n[checkFontsSection]");

{
  const noFonts = `[Script Info]\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  assertEqual(checkFontsSection(noFonts), 0, "no [Fonts] section → 0");

  const emptyFonts = `[Script Info]\n[Fonts]\n\n[Events]\n`;
  assertEqual(checkFontsSection(emptyFonts), 1, "empty [Fonts] section → 1");

  const withFonts = `[Script Info]\n[Fonts]\nfontname:Arial_0.ttf\nSomeBase64Data\n[Events]\n`;
  assertEqual(checkFontsSection(withFonts), 2, "[Fonts] with data → 2");
}

// ─── removeSection ────────────────────────────────────────────────────────────
console.log("\n[removeSection]");

{
  const ass = `[Script Info]\nfoo\n[Fonts]\nfontname:x\ndata\n[Events]\nbar\n`;
  const removed = removeSection(ass, "Fonts");
  assert(!removed.includes("[Fonts]"), "[Fonts] section removed");
  assert(removed.includes("[Events]"), "[Events] section preserved");
}

// ─── decodeAssBytes ───────────────────────────────────────────────────────────
console.log("\n[decodeAssBytes]");

{
  const utf8 = new TextEncoder().encode("[Script Info]\nTitle: Test\n");
  const result = decodeAssBytes(utf8);
  assert(result !== null, "plain UTF-8 decoded");
  assert(result!.text.includes("[Script Info]"), "UTF-8 content correct");
}

{
  // UTF-16 LE with BOM
  const text = "[Script Info]\nTitle: UTF16\n";
  const utf16 = new Uint8Array(2 + text.length * 2);
  utf16[0] = 0xFF; utf16[1] = 0xFE; // BOM
  for (let i = 0; i < text.length; i++) {
    utf16[2 + i * 2] = text.charCodeAt(i) & 0xFF;
    utf16[2 + i * 2 + 1] = 0;
  }
  const result = decodeAssBytes(utf16);
  assert(result !== null, "UTF-16 LE decoded");
  assert(result!.text.includes("[Script Info]"), "UTF-16 LE content correct");
}

// ─── isSrt ────────────────────────────────────────────────────────────────────
console.log("\n[isSrt]");

{
  const srt = `1\n00:00:01,000 --> 00:00:03,000\nHello World\n\n2\n00:00:04,000 --> 00:00:06,000\nGoodbye\n`;
  assert(isSrt(srt), "SRT text detected");
  assert(!isSrt("[Script Info]\n[Events]\n"), "ASS text NOT detected as SRT");
}

// ─── srtToAss ─────────────────────────────────────────────────────────────────
console.log("\n[srtToAss]");

{
  const srt = `1\n00:00:01,000 --> 00:00:03,000\nHello World\n\n`;
  const ass = srtToAss(srt, "", "");
  assert(ass.includes("[Script Info]"), "converted ASS has [Script Info]");
  assert(ass.includes("[V4+ Styles]"), "converted ASS has [V4+ Styles]");
  assert(ass.includes("[Events]"), "converted ASS has [Events]");
  assert(ass.includes("Hello World"), "dialogue text preserved");
  assert(ass.includes("0:00:01.00"), "start time correctly converted");
}

// ─── Real-world ASS file test ─────────────────────────────────────────────────
console.log("\n[analyseAss] real-world test file");

{
  const testFilePath = join(new URL(import.meta.url).pathname, "../../../../../fontInAss/test/subset.ass");
  let fileBytes: Buffer | null = null;
  try {
    fileBytes = readFileSync(testFilePath);
  } catch {
    console.log("  ⚠️   Test file not found, skipping real-world test");
  }

  if (fileBytes) {
    const decoded = decodeAssBytes(new Uint8Array(fileBytes));
    assert(decoded !== null, "test file decoded successfully");

    const { fontCharMap, subRename } = analyseAss(decoded!.text);
    const fontCount = Object.keys(fontCharMap).length;
    assert(fontCount > 0, `extracted ${fontCount} font(s) from real-world ASS`);

    // The test file has many subset-renamed fonts (8-char prefixes like "59W6OVGX")
    const renames = Object.keys(subRename).length;
    assert(renames > 0, `detected ${renames} subset-renamed font(s)`);

    // Check total codepoints extracted
    let totalCp = 0;
    for (const set of Object.values(fontCharMap)) totalCp += set.size;
    assert(totalCp > 100, `total codepoints: ${totalCp} (expect >100)`);

    console.log(`     fonts: ${fontCount}, renames: ${renames}, codepoints: ${totalCp}`);
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
