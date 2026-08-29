import { createHash } from "node:crypto";
import { CODE, SubsetOptionsSchema, type SubsetOptions, type SubsetResult } from "@fontinass/contracts";
import {
  analyseAss,
  checkFontsSection,
  decodeAssBytes,
  insertFontSubsetComments,
  isSrt,
  removeFontSubsetComments,
  removeSection,
  renameAssFonts,
  srtToAss,
} from "./ass-parser.js";
import { parseFontFace, subsetParsedFont } from "./opentype-subsetter.js";

export interface FontSourceMatchRequest {
  key: string;
  nameLower: string;
  targetWeight: number;
  targetItalic: boolean;
}

export interface FontSourceMatch {
  key: string;
  fontIndex: number;
}

export interface FontSource {
  match(requests: FontSourceMatchRequest[]): Map<string, FontSourceMatch | null>;
  load(key: string): Promise<{ bytes: Uint8Array; resolvedKey: string } | null>;
}

export interface ProcessingLogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
}

export interface SubtitleProcessor {
  process(input: { filename: string; bytes: Uint8Array; options?: Partial<SubsetOptions> }): Promise<SubsetResult>;
}

export interface SubtitleProcessorOptions {
  cacheEntries?: number;
  cacheBytes?: number;
  cacheTtlMs?: number;
}

export class DefaultSubtitleProcessor implements SubtitleProcessor {
  private readonly cache: ResultCache;

  constructor(
    private readonly fonts: FontSource,
    private readonly logger: ProcessingLogger,
    options: SubtitleProcessorOptions = {},
  ) {
    this.cache = new ResultCache(options.cacheEntries ?? 500, options.cacheBytes ?? 256 * 1024 * 1024, options.cacheTtlMs ?? 48 * 60 * 60 * 1000);
  }

  async process(input: { filename: string; bytes: Uint8Array; options?: Partial<SubsetOptions> }): Promise<SubsetResult> {
    const options = SubsetOptionsSchema.parse(input.options ?? {});
    const cacheKey = makeCacheKey(input.bytes, options);
    const cached = this.cache.get(cacheKey);
    if (cached) return { code: CODE.OK, messages: [], data: cached.bytes, fontCount: cached.fontCount };

    const decoded = decodeAssBytes(input.bytes);
    if (!decoded) return failure(CODE.CLIENT_ERROR, "Cannot decode subtitle file encoding", 0);
    let text = decoded.text;

    if (isSrt(text)) {
      if (!options.srtFormat || !options.srtStyle) {
        return failure(CODE.CLIENT_ERROR, "SRT→ASS conversion not configured (missing SRT format/style)", 0);
      }
      text = srtToAss(text, options.srtFormat, options.srtStyle);
    }

    const fontSection = checkFontsSection(text);
    if (fontSection === 2 && !options.clearFonts) {
      return failure(CODE.CLIENT_ERROR, "Subtitle already has embedded fonts. Enable 'clear fonts' to re-process.", 0);
    }
    if (fontSection > 0) text = removeSection(text, "Fonts");

    const { fontCharMap, subRename, originalNames } = analyseAss(text);
    if (Object.keys(subRename).length) {
      for (const [prefix, originalName] of Object.entries(subRename)) {
        const prefixLower = prefix.toLowerCase();
        const originalLower = originalName.toLowerCase();
        for (const key of Object.keys(fontCharMap)) {
          const [name, ...rest] = key.split("|");
          if (name !== prefixLower) continue;
          const nextKey = [originalLower, ...rest].join("|");
          if (fontCharMap[nextKey]) for (const codepoint of fontCharMap[key]) fontCharMap[nextKey].add(codepoint);
          else fontCharMap[nextKey] = fontCharMap[key];
          delete fontCharMap[key];
        }
        originalNames[originalLower] ??= originalName;
        const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        text = text.replace(new RegExp(`(,\\s*|\\\\fn@?)${escaped}[ \\t]*(?=[,\\\\}\\r\\n])`, "gi"), `$1${originalName}`);
      }
      text = removeFontSubsetComments(text);
    }

    const entries = Object.entries(fontCharMap);
    if (!entries.length) return failure(CODE.CLIENT_ERROR, "No fonts referenced in subtitle", 0);
    const displayName = (name: string) => originalNames[name] ?? name;
    const aliases = buildAliases(entries.map(([key]) => key.split("|")[0]), displayName, options.fontAliasSalt);
    const requests = entries.map(([key]) => {
      const [nameLower, weight, italic] = key.split("|");
      return { key, nameLower, targetWeight: Number.parseInt(weight, 10), targetItalic: italic === "1" };
    });

    let matches: Map<string, FontSourceMatch | null>;
    try {
      matches = this.fonts.match(requests);
    } catch (error) {
      this.logger.error("[subtitle-processing] font lookup failed", error);
      return failure(CODE.SERVER_ERROR, "Database error", 0);
    }

    if (options.fontsCheck) {
      const missing = requests.filter((request) => !matches.get(request.key));
      if (missing.length) return { code: CODE.MISSING_FONT, messages: missing.map((request) => `Missing font: [${displayName(request.nameLower)}]`), data: null, fontCount: 0 };
    }

    type Variant = { key: string; unicodeSet: Set<number>; nameLower: string; weight: number; italic: boolean };
    const byFile = new Map<string, Variant[]>();
    const results = new Map<string, { encoded: string; missingGlyphs: string; error: string | null }>();
    for (const [key, unicodeSet] of entries) {
      const [nameLower, weight, italic] = key.split("|");
      const match = matches.get(key);
      if (!match) {
        results.set(key, { encoded: "", missingGlyphs: "", error: `Missing font: [${displayName(nameLower)}]` });
        continue;
      }
      const variants = byFile.get(match.key) ?? [];
      variants.push({ key, unicodeSet, nameLower, weight: Number.parseInt(weight, 10), italic: italic === "1" });
      byFile.set(match.key, variants);
    }

    for (const [storageKey, variants] of byFile) {
      const loaded = await this.fonts.load(storageKey);
      if (!loaded) {
        for (const variant of variants) results.set(variant.key, { encoded: "", missingGlyphs: "", error: `Failed to load font: [${displayName(variant.nameLower)}]` });
        continue;
      }
      const byFace = new Map<number, Variant[]>();
      for (const variant of variants) {
        const faceIndex = matches.get(variant.key)!.fontIndex;
        byFace.set(faceIndex, [...(byFace.get(faceIndex) ?? []), variant]);
      }
      for (const [faceIndex, faceVariants] of byFace) {
        let parsed: ReturnType<typeof parseFontFace>;
        try {
          parsed = parseFontFace(loaded.bytes, faceIndex);
        } catch (error) {
          const message = `Subsetting error [${loaded.resolvedKey}#${faceIndex}]: ${error instanceof Error ? error.message : String(error)}`;
          for (const variant of faceVariants) results.set(variant.key, { encoded: "", missingGlyphs: "", error: message });
          continue;
        }
        for (const variant of faceVariants) {
          const fontName = displayName(variant.nameLower);
          const alias = aliases.get(variant.nameLower) ?? fontName;
          const outputName = options.fontNameMode === "preserve" ? fontName : alias;
          results.set(variant.key, subsetParsedFont(parsed, fontName, variant.weight, variant.italic, variant.unicodeSet, outputName, alias));
        }
      }
    }

    const fontChunks = ["[Fonts]\n"];
    const warnings: string[] = [];
    const successful = new Set<string>();
    for (const [key] of entries) {
      const result = results.get(key);
      if (!result) continue;
      const [nameLower] = key.split("|");
      if (result.error) warnings.push(result.error);
      else {
        fontChunks.push(result.encoded);
        successful.add(nameLower);
        if (result.missingGlyphs) warnings.push(`Missing glyphs in [${displayName(nameLower)}]: ${result.missingGlyphs}`);
      }
    }
    const fontsSection = fontChunks.join("");

    const aliasByOriginal: Record<string, string> = {};
    const aliasToOriginal: Record<string, string> = {};
    for (const nameLower of successful) {
      const alias = aliases.get(nameLower);
      if (!alias) continue;
      aliasByOriginal[nameLower] = alias;
      aliasToOriginal[alias] = displayName(nameLower);
    }
    text = options.fontNameMode === "alias"
      ? insertFontSubsetComments(renameAssFonts(removeFontSubsetComments(text), aliasByOriginal), aliasToOriginal)
      : removeFontSubsetComments(text);

    const eventsIndex = text.indexOf("[Events]");
    if (eventsIndex === -1) return failure(CODE.CLIENT_ERROR, "No [Events] section found in subtitle", entries.length);
    const output = new TextEncoder().encode(`\uFEFF${text.slice(0, eventsIndex)}${fontsSection}\n${text.slice(eventsIndex)}`);
    if (!warnings.length) this.cache.set(cacheKey, output, entries.length);
    this.logger.info(`[subtitle-processing] ${input.filename}: ${entries.length} variants, ${warnings.length} warnings`);
    return { code: warnings.length ? CODE.WARN : CODE.OK, messages: warnings, data: output, fontCount: entries.length };
  }
}

function failure(code: typeof CODE.CLIENT_ERROR | typeof CODE.SERVER_ERROR, message: string, fontCount = 0): SubsetResult {
  return { code, messages: [message], data: null, fontCount };
}

function buildAliases(names: string[], displayName: (name: string) => string, salt: string): Map<string, string> {
  const aliases = new Map<string, string>();
  const used = new Set<string>();
  for (const name of names) {
    if (aliases.has(name)) continue;
    let attempt = 0;
    while (true) {
      const digest = createHash("sha1").update(displayName(name)).update("\0").update(salt.trim().slice(0, 80)).update("\0").update(String(attempt)).digest("hex").toUpperCase();
      const alias = `F${digest.slice(0, 7)}`;
      if (!used.has(alias)) { aliases.set(name, alias); used.add(alias); break; }
      attempt++;
    }
  }
  return aliases;
}

function makeCacheKey(bytes: Uint8Array, options: SubsetOptions): string {
  return createHash("sha256").update(bytes).update(JSON.stringify(options, Object.keys(options).sort())).digest("hex");
}

class ResultCache {
  private readonly entries = new Map<string, { bytes: Uint8Array; fontCount: number; expiresAt: number }>();
  private totalBytes = 0;

  constructor(private readonly maxEntries: number, private readonly maxBytes: number, private readonly ttlMs: number) {}

  get(key: string): { bytes: Uint8Array; fontCount: number } | null {
    this.pruneExpired();
    const entry = this.entries.get(key);
    if (!entry) return null;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return { bytes: entry.bytes, fontCount: entry.fontCount };
  }

  set(key: string, bytes: Uint8Array, fontCount: number): void {
    this.pruneExpired();
    const existing = this.entries.get(key);
    if (existing) this.totalBytes -= existing.bytes.byteLength;
    this.entries.delete(key);
    if (this.maxEntries <= 0 || this.maxBytes <= 0) return;
    this.entries.set(key, { bytes, fontCount, expiresAt: Date.now() + this.ttlMs });
    this.totalBytes += bytes.byteLength;
    while (this.entries.size && (this.entries.size > this.maxEntries || this.totalBytes > this.maxBytes)) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.totalBytes -= this.entries.get(oldest)!.bytes.byteLength;
      this.entries.delete(oldest);
    }
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt > now) continue;
      this.totalBytes -= entry.bytes.byteLength;
      this.entries.delete(key);
    }
  }
}
