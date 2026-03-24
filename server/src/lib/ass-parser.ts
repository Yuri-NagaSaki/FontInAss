/**
 * ASS/SSA subtitle analyzer.
 *
 * Parses [V4+ Styles] and [Events] sections and returns a map of
 * (fontName, weight, italic) → Set<codepoint>.
 *
 * This is a TypeScript port of the C++/Cython analyseAss implementation
 * from the fontInAss project, which itself implements the ASS spec at:
 * https://github.com/weizhenye/ASS/wiki
 */

export interface FontCharMap {
  /** key is encoded as "fontNameLower|weight|italic(0/1)" */
  [key: string]: Set<number>;
}

export interface AnalyseResult {
  fontCharMap: FontCharMap;
  /** Maps internal renamed fonts back to original names (subset prefix stripping) */
  subRename: Record<string, string>;
  /** Maps lowercased font name → original cased name (first occurrence wins) */
  originalNames: Record<string, string>;
}

function makeFontKey(name: string, weight: number, italic: boolean): string {
  return `${name.toLowerCase()}|${weight}|${italic ? 1 : 0}`;
}

function getOrCreate(map: FontCharMap, key: string): Set<number> {
  if (!map[key]) map[key] = new Set();
  return map[key];
}

/**
 * Parse ASS override tags block `{...}` and update current font state.
 * Returns the new [fontName, weight, italic] state.
 */
function processTagBlock(
  tagContent: string, // content between { and }, without braces
  defaultFontName: string,
  defaultWeight: number,
  defaultItalic: boolean,
  currentFontName: string,
  currentWeight: number,
  currentItalic: boolean,
  styleFontName: Record<string, string>,
  styleWeight: Record<string, number>,
  styleItalic: Record<string, boolean>,
): [string, number, boolean] {
  let fontName = currentFontName;
  let weight = currentWeight;
  let italic = currentItalic;

  // Extract each \tag from the block
  // Tags are separated by \, and may contain parenthesized args e.g. \t(...)
  let i = 0;
  while (i < tagContent.length) {
    if (tagContent[i] !== "\\") {
      i++;
      continue;
    }
    i++; // skip backslash

    // Find end of tag name (next \ or end)
    let j = i;
    while (j < tagContent.length && tagContent[j] !== "\\") j++;
    const tagFull = tagContent.slice(i, j);
    i = j;

    if (!tagFull) continue;

    // \fn — font name change
    if (tagFull.startsWith("fn")) {
      let name = tagFull.slice(2);
      if (name.startsWith("@")) name = name.slice(1); // vertical orientation prefix
      fontName = name || defaultFontName;
      continue;
    }

    // \r — reset style
    if (tagFull.startsWith("r")) {
      // skip \rndx, \rndy, \rndz (random movement tags)
      if (tagFull.match(/^rnd[xyz]\d+$/) || tagFull.match(/^rnd\d+$/)) {
        continue;
      }
      let styleName = tagFull.slice(1).replace(/^\(|\)$/g, "").replace(/\*$/, "");
      if (styleName === "") {
        fontName = defaultFontName;
        weight = defaultWeight;
        italic = defaultItalic;
      } else if (styleName in styleFontName) {
        fontName = styleFontName[styleName];
        weight = styleWeight[styleName];
        italic = styleItalic[styleName];
      } else {
        // Unknown style — reset to default (ASS spec behaviour)
        fontName = defaultFontName;
        weight = defaultWeight;
        italic = defaultItalic;
      }
      continue;
    }

    // \b — bold / weight
    if (tagFull.startsWith("b") && !tagFull.match(/^b[a-zA-Z]/)) {
      const val = tagFull.slice(1).replace(/^\(|\)$/g, "");
      if (val === "" || val === "0") {
        weight = 400;
      } else if (val === "1") {
        weight = 700;
      } else {
        const n = parseInt(val, 10);
        if (!isNaN(n)) weight = n;
      }
      continue;
    }

    // \i — italic
    if (tagFull.startsWith("i") && !tagFull.match(/^i[a-zA-Z]/)) {
      const val = tagFull.slice(1).replace(/^\(|\)$/g, "");
      if (val === "1") italic = true;
      else if (val === "0") italic = false;
      // empty = no change per spec
      continue;
    }

    // all other tags are irrelevant for font tracking
  }

  return [fontName, weight, italic];
}

/**
 * Parse a single Dialogue event text into codepoints, updating fontCharMap.
 */
function parseDialogueText(
  text: string,
  defaultFontName: string,
  defaultWeight: number,
  defaultItalic: boolean,
  styleFontName: Record<string, string>,
  styleWeight: Record<string, number>,
  styleItalic: Record<string, boolean>,
  fontCharMap: FontCharMap,
  originalNames: Record<string, string>,
): void {
  let curFont = defaultFontName;
  let curWeight = defaultWeight;
  let curItalic = defaultItalic;

  const recordName = (name: string) => {
    const lower = name.toLowerCase();
    if (!(lower in originalNames)) originalNames[lower] = name;
  };
  recordName(defaultFontName);

  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];

    if (ch === "{") {
      // Collect tag block
      const end = text.indexOf("}", i + 1);
      if (end === -1) {
        // Unclosed brace — treat rest as text
        const cp = text.codePointAt(i);
        if (cp !== undefined) {
          getOrCreate(fontCharMap, makeFontKey(curFont, curWeight, curItalic)).add(cp);
        }
        i++;
        continue;
      }
      const tagBlock = text.slice(i + 1, end);
      [curFont, curWeight, curItalic] = processTagBlock(
        tagBlock,
        defaultFontName, defaultWeight, defaultItalic,
        curFont, curWeight, curItalic,
        styleFontName, styleWeight, styleItalic,
      );
      recordName(curFont);
      i = end + 1;
      continue;
    }

    if (ch === "\\") {
      // Escape sequences
      i++;
      if (i >= len) break;
      const next = text[i];
      if (next === "n" || next === "N" || next === "h") {
        // soft/hard line break — no visible char
        i++;
        continue;
      }
      if (next === "{" || next === "}") {
        // escaped brace — add as literal character
        getOrCreate(fontCharMap, makeFontKey(curFont, curWeight, curItalic)).add(next.codePointAt(0)!);
        i++;
        continue;
      }
      // plain backslash + char — add both
      getOrCreate(fontCharMap, makeFontKey(curFont, curWeight, curItalic)).add(92); // '\'
      const cp = text.codePointAt(i);
      if (cp !== undefined) {
        getOrCreate(fontCharMap, makeFontKey(curFont, curWeight, curItalic)).add(cp);
        i += cp > 0xFFFF ? 2 : 1;
      }
      continue;
    }

    // Regular character
    const cp = text.codePointAt(i);
    if (cp !== undefined) {
      getOrCreate(fontCharMap, makeFontKey(curFont, curWeight, curItalic)).add(cp);
      i += cp > 0xFFFF ? 2 : 1;
    } else {
      i++;
    }
  }
}

/**
 * Analyse an ASS subtitle string and return per-font codepoint sets.
 *
 * @param assText - UTF-8 decoded ASS file content
 */
export function analyseAss(assText: string): AnalyseResult {
  const lines = assText.split(/\r?\n/);

  // Style maps
  const styleFontName: Record<string, string> = {};
  const styleWeight: Record<string, number> = {};
  const styleItalic: Record<string, boolean> = {};
  const fontCharMap: FontCharMap = {};
  const subRename: Record<string, string> = {};
  const originalNames: Record<string, string> = {};

  let firstStyleName: string | null = null;

  // Format column indices
  let styleNameIdx = -1, fontNameIdx = -1, boldIdx = -1, italicIdx = -1;
  let eventStyleIdx = -1, eventTextIdx = -1;

  type State = "init" | "styles_format" | "styles" | "events_format" | "events";
  let state: State = "init";

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line) continue;

    if (state === "init") {
      // Parse "; Font Subset: XXXXXXXX - OriginalFontName" comments
      if (line.startsWith("; Font Subset:")) {
        // Format: "; Font Subset: 59W6OVGX - DFHanziPenW5-A"
        const afterPrefix = line.slice("; Font Subset: ".length);
        const renamedTo = afterPrefix.slice(0, 8);
        const dashIdx = afterPrefix.indexOf(" - ");
        if (dashIdx >= 0 && renamedTo.length === 8) {
          const originalName = afterPrefix.slice(dashIdx + 3).trim();
          if (originalName) subRename[renamedTo] = originalName;
        }
      }
      if (line === "[V4+ Styles]") {
        state = "styles_format";
      }
      continue;
    }

    if (state === "styles_format") {
      if (!line.startsWith("Format:")) continue;
      const cols = line.slice(7).replace(/ /g, "").split(",");
      styleNameIdx = cols.indexOf("Name");
      fontNameIdx = cols.indexOf("Fontname");
      boldIdx = cols.indexOf("Bold");
      italicIdx = cols.indexOf("Italic");
      if (styleNameIdx === -1 || fontNameIdx === -1) {
        // Malformed — skip
        continue;
      }
      state = "styles";
      continue;
    }

    if (state === "styles") {
      if (line.startsWith("[Events]")) {
        state = "events_format";
        continue;
      }
      if (line.startsWith("[")) {
        state = "init";
        continue;
      }
      if (!line.startsWith("Style:")) continue;
      const parts = line.slice(6).trim().split(",");
      const styleName = parts[styleNameIdx]?.trim().replace(/\*$/, "") ?? "";
      let fontName = parts[fontNameIdx]?.trim() ?? "";
      if (fontName.startsWith("@")) fontName = fontName.slice(1);
      const weight = boldIdx >= 0 && parts[boldIdx]?.trim() === "1" ? 700 : 400;
      const italic = italicIdx >= 0 && parts[italicIdx]?.trim() === "1";
      styleFontName[styleName] = fontName;
      styleWeight[styleName] = weight;
      styleItalic[styleName] = italic;
      if (firstStyleName === null) firstStyleName = styleName;
      continue;
    }

    if (state === "events_format") {
      if (!line.startsWith("Format:")) continue;
      const cols = line.slice(7).replace(/ /g, "").split(",");
      eventStyleIdx = cols.indexOf("Style");
      eventTextIdx = cols.indexOf("Text");
      if (eventStyleIdx === -1 || eventTextIdx === -1) continue;
      state = "events";
      continue;
    }

    if (state === "events") {
      if (line.startsWith("[")) break; // next section
      if (!line.startsWith("Dialogue:")) continue;

      // Split only enough to extract Style and Text
      const withoutPrefix = line.slice(9); // skip "Dialogue:"
      const parts = withoutPrefix.split(",");
      if (parts.length <= eventTextIdx) continue;

      let styleName = parts[eventStyleIdx]?.replace(/\*$/, "").trim() ?? "";
      if (!(styleName in styleFontName)) {
        styleName = firstStyleName ?? "";
      }

      const defaultFont = styleFontName[styleName] ?? "";
      const defaultWeight = styleWeight[styleName] ?? 400;
      const defaultItalic = styleItalic[styleName] ?? false;

      // Text is everything from eventTextIdx onward (may contain commas)
      const text = parts.slice(eventTextIdx).join(",");

      if (defaultFont) {
        parseDialogueText(
          text,
          defaultFont, defaultWeight, defaultItalic,
          styleFontName, styleWeight, styleItalic,
          fontCharMap,
          originalNames,
        );
      }
    }
  }

  return { fontCharMap, subRename, originalNames };
}

/**
 * Decode the encoding of an ASS subtitle byte buffer.
 * Tries UTF-8-BOM, UTF-8, UTF-16 LE/BE, then latin1.
 */
export function decodeAssBytes(bytes: Uint8Array): { encoding: string; text: string } | null {
  try {
    // UTF-8 BOM
    if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
      return { encoding: "utf-8-bom", text: new TextDecoder("utf-8").decode(bytes.slice(3)) };
    }
    // UTF-16 LE BOM
    if (bytes[0] === 0xFF && bytes[1] === 0xFE) {
      return { encoding: "utf-16-le", text: new TextDecoder("utf-16le").decode(bytes.slice(2)) };
    }
    // UTF-16 BE BOM
    if (bytes[0] === 0xFE && bytes[1] === 0xFF) {
      return { encoding: "utf-16-be", text: new TextDecoder("utf-16be").decode(bytes.slice(2)) };
    }
    // Try strict UTF-8
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
    return { encoding: "utf-8", text: decoder.decode(bytes) };
  } catch {
    try {
      return { encoding: "latin1", text: new TextDecoder("latin1").decode(bytes) };
    } catch {
      return null;
    }
  }
}

/** Check if text looks like SRT format */
export function isSrt(text: string): boolean {
  // SRT files have numbered entries like: digit(s) on a line by itself
  return /^\s*\d+\s*\r?\n\d{2}:\d{2}:\d{2}[,\.]\d{3}\s*-->/m.test(text);
}

/** Convert SRT to ASS with given format and style strings */
export function srtToAss(srtText: string, format: string, style: string): string {
  const lines: string[] = [];
  lines.push("[Script Info]");
  lines.push("ScriptType: v4.00+");
  lines.push("WrapStyle: 0");
  lines.push("ScaledBorderAndShadow: yes");
  lines.push("");
  lines.push("[V4+ Styles]");
  lines.push(format);
  lines.push(style);
  lines.push("");
  lines.push("[Events]");
  lines.push("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text");

  const blocks = srtText.split(/\n\s*\n/);
  for (const block of blocks) {
    const blines = block.trim().split(/\r?\n/);
    if (blines.length < 2) continue;
    // Skip index line
    const timeLine = blines.find(l => l.includes("-->"));
    if (!timeLine) continue;
    const timeMatch = timeLine.match(
      /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/
    );
    if (!timeMatch) continue;
    const [, h1, m1, s1, ms1, h2, m2, s2, ms2] = timeMatch;
    const start = `${h1}:${m1}:${s1}.${ms1.slice(0, 2)}`;
    const end = `${h2}:${m2}:${s2}.${ms2.slice(0, 2)}`;
    const textIdx = blines.indexOf(timeLine) + 1;
    const text = blines.slice(textIdx).join("\\N")
      .replace(/<b>/gi, "{\\b1}").replace(/<\/b>/gi, "{\\b0}")
      .replace(/<i>/gi, "{\\i1}").replace(/<\/i>/gi, "{\\i0}")
      .replace(/<[^>]+>/g, "");
    lines.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`);
  }

  return lines.join("\n");
}

/** Remove a section (e.g. [Fonts]) from ASS text.
 *  Handles encoded font data containing '[' characters within lines. */
export function removeSection(assText: string, sectionName: string): string {
  const header = `[${sectionName}]`;
  const startIdx = assText.indexOf(header);
  if (startIdx === -1) return assText;

  // Find the next real section header: a line matching [Name] exactly.
  // UUencoded data may contain '[' mid-line, so we must check line boundaries.
  const sectionHeaderRe = /^\[[^\[\]\r\n]+\]\s*$/gm;
  sectionHeaderRe.lastIndex = startIdx + header.length;
  const match = sectionHeaderRe.exec(assText);

  if (match) {
    return assText.slice(0, startIdx) + assText.slice(match.index);
  }
  // No next section — remove everything from this section to end
  return assText.slice(0, startIdx);
}

/** Check if ASS text has a [Fonts] section with content */
export function checkFontsSection(assText: string): 0 | 1 | 2 {
  const match = assText.match(/\[Fonts\]([\s\S]*?)(?=\[|$)/);
  if (!match) return 0;
  const content = match[1].trim();
  return content.length > 0 ? 2 : 1;
}
