/** Font usage follows libass: style booleans, resets, drawings and soft spaces. */
export type FontCharMap = Record<string, Set<number>>;
export interface AnalyseResult {
  fontCharMap: FontCharMap;
  subRename: Record<string, string>;
  originalNames: Record<string, string>;
}

export function normalizeFontName(name: string): string {
  return name.trim().replace(/^@\s*/, "");
}

export function parseFontKey(key: string): [string, number, boolean] {
  const italicAt = key.lastIndexOf("|");
  const weightAt = key.lastIndexOf("|", italicAt - 1);
  return [key.slice(0, weightAt), Number(key.slice(weightAt + 1, italicAt)), key.slice(italicAt + 1) === "1"];
}

interface Style { font: string; weight: number; italic: boolean }
interface State extends Style { style: Style; drawing: boolean; wrap: number }
const ASS_STYLE = "Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding";
const SSA_STYLE = "Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,TertiaryColour,BackColour,Bold,Italic,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,AlphaLevel,Encoding";
const EVENT_FORMAT = "Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text";
const columns = (format: string) => format.toLowerCase().split(",").map(s => s.trim());

function tags(block: string): string[] {
  const result: string[] = [];
  let depth = 0, start = -1;
  for (let i = 0; i < block.length; i++) {
    if (block[i] === "\\" && depth === 0) {
      if (start >= 0) result.push(block.slice(start, i));
      start = i + 1;
    } else if (block[i] === "(") depth++;
    else if (block[i] === ")") depth = Math.max(0, depth - 1);
  }
  if (start >= 0) result.push(block.slice(start));
  return result;
}

function applyTags(block: string, states: State[], initial: Style, styles: Map<string, Style>, wrap: number, depth = 0): State[] {
  for (const tag of tags(block)) {
    // Retain both endpoints of transforms; otherwise animated style changes can lose glyphs.
    if (tag.startsWith("t(") && depth < 8) {
      const inner = tag.slice(2, tag.endsWith(")") ? -1 : undefined);
      states = [...states, ...applyTags(inner, states.map(s => ({ ...s })), initial, styles, wrap, depth + 1)];
    } else {
      for (const state of states) {
        if (tag.startsWith("fn")) state.font = normalizeFontName(tag.slice(2)) || state.style.font;
        else if (/^r(?!nd)/.test(tag)) {
          const style = styles.get(tag.slice(1).trim()) ?? initial;
          Object.assign(state, style, { style, drawing: false, wrap });
        } else if (/^b(?:[-+\d(]|$)/.test(tag)) {
          const n = Number.parseInt(tag.slice(1).replace(/^\(/, ""), 10);
          state.weight = n === 0 ? 400 : n === 1 ? 700 : n >= 100 ? n : state.style.weight;
        } else if (/^i(?:[-+\d(]|$)/.test(tag)) {
          const n = Number.parseInt(tag.slice(1).replace(/^\(/, ""), 10);
          state.italic = n === 0 ? false : n === 1 ? true : state.style.italic;
        } else if (/^p(?:[-+\d]|$)/.test(tag)) state.drawing = Number.parseInt(tag.slice(1), 10) > 0;
        else if (/^q(?:\d|$)/.test(tag)) {
          const value = Number.parseInt(tag.slice(1), 10);
          state.wrap = value >= 0 && value <= 3 ? value : wrap;
        }
      }
    }
    states = [...new Map(states.map(s => [JSON.stringify(s), s])).values()];
    if (states.length > 256) throw new Error("Too many transformed font states");
  }
  return states;
}

export function analyseAss(assText: string): AnalyseResult {
  const lines = assText.split(/\r\n|\n|\r/);
  const styles = new Map<string, Style>();
  const fontCharMap: FontCharMap = Object.create(null);
  const subRename: Record<string, string> = Object.create(null);
  const originalNames: Record<string, string> = Object.create(null);
  let section = "", format: string[] = [], wrap = 0;
  // Styles may occur after Events; analyse the complete style table first.
  for (const line of lines) {
    const header = line.trim().match(/^\[([^\]]+)\]$/);
    if (header) {
      section = header[1].toLowerCase();
      format = columns(section === "v4 styles" ? SSA_STYLE : ASS_STYLE);
      continue;
    }
    const mapping = line.match(/^\s*; Font Subset:\s*([^\s]+) - (.+?)\s*$/);
    if (mapping) subRename[mapping[1]] = mapping[2];
    if (section === "script info" && /^\s*WrapStyle:/i.test(line)) wrap = Number(line.split(":")[1]) || 0;
    if (!/^v4\+? styles$/.test(section)) continue;
    const field = line.match(/^\s*(Format|Style)\s*:\s*(.*)$/i);
    if (!field) continue;
    if (field[1].toLowerCase() === "format") { format = columns(field[2]); continue; }
    const values = field[2].split(",");
    const get = (key: string) => values[format.indexOf(key)]?.trim() ?? "";
    styles.set(get("name").replace(/^\*/, ""), { font: normalizeFontName(get("fontname")), weight: Number(get("bold")) ? 700 : 400, italic: Boolean(Number(get("italic"))) });
  }
  section = "";
  for (const line of lines) {
    const header = line.trim().match(/^\[([^\]]+)\]$/);
    if (header) { section = header[1].toLowerCase(); format = columns(EVENT_FORMAT); continue; }
    if (section !== "events") continue;
    const field = line.match(/^\s*(Format|Dialogue)\s*:\s?(.*)$/i);
    if (!field) continue;
    if (field[1].toLowerCase() === "format") { format = columns(field[2]); continue; }
    const textAt = format.indexOf("text"), styleAt = format.indexOf("style");
    if (textAt < 0 || styleAt < 0) continue;
    const parts = field[2].split(",");
    if (parts.length <= textAt) continue;
    const initial = styles.get(parts[styleAt]?.trim().replace(/^\*/, "")) ?? styles.get("Default") ?? styles.values().next().value;
    if (!initial?.font) continue;
    let states: State[] = [{ ...initial, style: initial, drawing: false, wrap }];
    const text = parts.slice(textAt).join(",");
    const add = (cp: number, softBreak = false) => {
      for (const state of states) {
        if (state.drawing || (softBreak && state.wrap === 2)) continue;
        const lower = state.font.toLowerCase();
        originalNames[lower] ??= state.font;
        const key = `${lower}|${state.weight}|${state.italic ? 1 : 0}`;
        (fontCharMap[key] ??= new Set()).add(cp);
      }
    };
    for (let i = 0; i < text.length;) {
      if (text[i] === "{") {
        const end = text.indexOf("}", i + 1);
        if (end >= 0) { states = applyTags(text.slice(i + 1, end), states, initial, styles, wrap); i = end + 1; continue; }
      }
      if (text[i] === "\\") {
        const next = text[i + 1];
        if (next === "N") { i += 2; continue; }
        if (next === "n") { add(32, true); i += 2; continue; }
        if (next === "h") { add(160); i += 2; continue; }
        if (next === "{" || next === "}") { add(next.charCodeAt(0)); i += 2; continue; }
      }
      const cp = text.codePointAt(i)!;
      add(cp);
      i += cp > 0xffff ? 2 : 1;
    }
  }
  return { fontCharMap, subRename, originalNames };
}
