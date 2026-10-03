export { analyseAss, parseFontKey, type AnalyseResult, type FontCharMap } from "./ass-analysis.js";
import { normalizeFontName } from "./ass-analysis.js";

export const DEFAULT_SRT_FORMAT = "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding";
export const DEFAULT_SRT_STYLE = "Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1";

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
  // SRT files have numbered entries like: digit(s) on a line by itself.
  // Bounded quantifiers prevent catastrophic backtracking on adversarial input.
  return /^[ \t]{0,8}\d{1,9}[ \t]{0,8}\r?\n\d{2}:\d{2}:\d{2}[,.]\d{3}[ \t]{0,8}-->/m.test(text);
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
    const text = blines.slice(textIdx).map(line => line.replace(/[{}]/g, "\\$&")).join("\\N")
      .replace(/<b>/gi, "{\\b1}").replace(/<\/b>/gi, "{\\b0}")
      .replace(/<i>/gi, "{\\i1}").replace(/<\/i>/gi, "{\\i0}")
      .replace(/<u>/gi, "{\\u1}").replace(/<\/u>/gi, "{\\u0}")
      .replace(/<[^>]+>/g, "")
      .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_, entity: string) => ({ amp: "&", lt: "<", gt: ">", quot: '\"', apos: "'", nbsp: "\u00a0" })[entity.toLowerCase()] ?? "");
    lines.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`);
  }

  return lines.join("\n");
}

/** Remove a section (e.g. [Fonts]) from ASS text.
 *  Handles encoded font data containing '[' characters within lines. */
export function removeSection(assText: string, sectionName: string): string {
  const lines = assText.split(/(\r?\n)/);
  let removing = false;
  return lines.filter((line, index) => {
    if (index % 2 === 0) {
      const header = line.trim().match(/^\[([^\]]+)\]$/);
      if (header) removing = header[1].toLowerCase() === sectionName.toLowerCase();
    }
    return !removing;
  }).join("");
}

/** Remove previous subset rename comments before writing fresh aliases. */
export function removeFontSubsetComments(assText: string): string {
  return assText.replace(/^; Font Subset: [^\r\n]*(?:\r?\n)?/gm, "");
}

/**
 * Rename ASS style font names and \fn override tags.
 *
 * `replacementByOriginalLower` maps lowercased font names to their replacements.
 * Used both to assign subset aliases and to restore original names.
 */
export function renameAssFonts(
  assText: string,
  replacementByOriginalLower: Record<string, string>,
): string {
  if (Object.keys(replacementByOriginalLower).length === 0) return assText;

  const tokens = assText.split(/(\r?\n)/);

  let section: "styles" | "events" | null = null;
  let fontNameIdx = -1;
  let eventTextIdx = -1;

  const renameFontName = (raw: string): string => {
    const name = normalizeFontName(raw).toLowerCase();
    if (!Object.hasOwn(replacementByOriginalLower, name)) return raw;
    const replacement = replacementByOriginalLower[name];
    if (!replacement) return raw;
    const leading = raw.match(/^\s*/)?.[0] ?? "";
    const trailing = raw.match(/\s*$/)?.[0] ?? "";
    const vertical = raw.trim().startsWith("@");
    return `${leading}${vertical ? "@" : ""}${replacement}${trailing}`;
  };

  const renameStyleLine = (line: string): string => {
    const match = line.match(/^(\s*Style\s*:\s*)(.*)$/i);
    if (!match || fontNameIdx < 0) return line;
    const parts = match[2].split(",");
    if (fontNameIdx >= parts.length) return line;

    parts[fontNameIdx] = renameFontName(parts[fontNameIdx]);
    return `${match[1]}${parts.join(",")}`;
  };

  const renameEventLine = (line: string): string => {
    const match = line.match(/^(\s*(?:Dialogue|Comment)\s*:\s*)(.*)$/i);
    if (!match || eventTextIdx < 0) return line;
    let textStart = 0;
    for (let column = 0; column < eventTextIdx; column++) {
      const comma = match[2].indexOf(",", textStart);
      if (comma === -1) return line;
      textStart = comma + 1;
    }
    const text = match[2].slice(textStart).replace(/\{[^}]*\}/g, (block) =>
      block.replace(/(\\fn)([^\\}]*)/gi, (_tag, prefix: string, name: string) => {
        const renamed = renameFontName(name);
        if (renamed !== name) return `${prefix}${renamed}`;
        // Closing transform parentheses belong to the tag container, not the name.
        const closing = name.match(/\)+[ \t]*$/)?.[0] ?? "";
        return `${prefix}${renameFontName(name.slice(0, name.length - closing.length))}${closing}`;
      }),
    );
    return `${match[1]}${match[2].slice(0, textStart)}${text}`;
  };

  for (let i = 0; i < tokens.length; i += 2) {
    const line = tokens[i];
    const trimmed = line.trim();

    if (/^\[[^\]]+\]$/.test(trimmed)) {
      section = /^\[V4\+? Styles\]$/i.test(trimmed) ? "styles" : /^\[Events\]$/i.test(trimmed) ? "events" : null;
      fontNameIdx = section === "styles" ? 1 : -1;
      eventTextIdx = section === "events" ? 9 : -1;
      continue;
    }
    if (!section) continue;

    if (/^\s*Format\s*:/i.test(line)) {
      const cols = line.replace(/^\s*Format\s*:/i, "").split(",").map((column) => column.trim().toLowerCase());
      if (section === "styles") fontNameIdx = cols.indexOf("fontname");
      else eventTextIdx = cols.indexOf("text");
      continue;
    }
    tokens[i] = section === "styles" ? renameStyleLine(line) : renameEventLine(line);
  }

  return tokens.join("");
}

/** Insert subset alias comments before the style section for future reprocessing. */
export function insertFontSubsetComments(
  assText: string,
  aliasToOriginal: Record<string, string>,
): string {
  const entries = Object.entries(aliasToOriginal);
  if (entries.length === 0) return assText;

  const comments = entries
    .map(([alias, original]) => `; Font Subset: ${alias} - ${original}`)
    .join(assText.includes("\r\n") ? "\r\n" : "\n");
  const newline = assText.includes("\r\n") ? "\r\n" : "\n";
  const marker = assText.search(/^[ \t]*\[V4\+? Styles\][ \t]*$/im);

  if (marker >= 0) {
    const before = assText.slice(0, marker).replace(/[ \t]*(?:\r?\n)*$/, newline);
    return before + comments + newline + assText.slice(marker);
  }

  return comments + newline + assText;
}

/** Check if ASS text has a [Fonts] section with content */
export function checkFontsSection(assText: string): 0 | 1 | 2 {
  let found = false;
  for (const line of assText.split(/\r?\n/)) {
    const header = line.trim().match(/^\[([^\]]+)\]$/);
    if (header) {
      if (header[1].toLowerCase() === "fonts") found = true;
      else if (found) return 1;
    } else if (found && line.trim()) return 2;
  }
  return found ? 1 : 0;
}
