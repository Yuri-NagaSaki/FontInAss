/**
 * Subtitle subsetting API route.
 *
 * POST /api/subset
 *
 * Request:
 *   - Content-Type: application/octet-stream (single file)
 *   - Or multipart/form-data with field "file" (batch)
 *
 * Request headers:
 *   X-Fonts-Check: "1"   — strict mode, fail if any font missing
 *   X-Clear-Fonts: "1"   — clear existing embedded fonts before processing
 *   X-Srt-Format: base64 — ASS Format line for SRT→ASS conversion
 *   X-Srt-Style:  base64 — ASS Style line for SRT→ASS conversion
 *
 * Response headers:
 *   X-Code:    numeric status code (200=ok, 201=warn, 300=missing_font, 400=error, 500=server)
 *   X-Message: base64-encoded JSON array of error/warning strings
 *
 * Response body: processed subtitle bytes (UTF-8-BOM)
 */

import { Hono } from "hono";
import type { Env } from "../types.js";
import { CODE } from "../types.js";
import {
  analyseAss,
  decodeAssBytes,
  isSrt,
  srtToAss,
  removeSection,
  checkFontsSection,
} from "../lib/ass-parser.js";
import { lookupFontsBatch, loadFontBytes, type FontLookupResult } from "../lib/font-manager.js";
import { subsetFont } from "../lib/subsetter.js";
import { computeCacheKey, getFromCache, setInCache } from "../lib/cache.js";

const subset = new Hono<{ Bindings: Env }>();

subset.post("/", async (c) => {
  const contentType = c.req.header("content-type") ?? "";
  const fontsCheck = c.req.header("x-fonts-check") === "1";
  const clearFonts = c.req.header("x-clear-fonts") === "1";
  const srtFormatB64 = c.req.header("x-srt-format") ?? "";
  const srtStyleB64 = c.req.header("x-srt-style") ?? "";
  const srtFormat = srtFormatB64 ? atob(srtFormatB64) : "";
  const srtStyle = srtStyleB64 ? atob(srtStyleB64) : "";

  // Support both single-file (octet-stream) and batch (multipart) uploads
  const fileEntries: { name: string; bytes: Uint8Array }[] = [];

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await c.req.formData();
      const files = form.getAll("file");
      for (const f of files) {
        if (typeof f !== "string" && "arrayBuffer" in f) {
          const file = f as File;
          if (file.size > 20 * 1024 * 1024) {
            return sendResult(c, CODE.CLIENT_ERROR, [`File "${file.name}" too large (max 20 MB)`], null);
          }
          fileEntries.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
        }
      }
    } else {
      // Single file
      const rawBytes = new Uint8Array(await c.req.arrayBuffer());
      if (rawBytes.length > 20 * 1024 * 1024) {
        return sendResult(c, CODE.CLIENT_ERROR, ["Subtitle file too large (max 20 MB)"], null);
      }
      const filenameRaw = c.req.header("x-filename") ?? "";
      let filename = "subtitle.ass";
      if (filenameRaw) {
        try {
          filename = new TextDecoder().decode(
            Uint8Array.from(atob(filenameRaw), ch => ch.charCodeAt(0))
          );
        } catch {
          filename = filenameRaw;
        }
      }
      fileEntries.push({ name: filename, bytes: rawBytes });
    }
  } catch (e) {
    return sendResult(c, CODE.SERVER, [`Failed to read request: ${e instanceof Error ? e.message : String(e)}`], null);
  }

  if (fileEntries.length === 0) {
    return sendResult(c, CODE.CLIENT_ERROR, ["No file provided"], null);
  }

  // Limit batch size to prevent memory exhaustion
  const MAX_BATCH = 20;
  if (fileEntries.length > MAX_BATCH) {
    return sendResult(c, CODE.CLIENT_ERROR, [`Batch too large: max ${MAX_BATCH} files per request`], null);
  }

  // For single-file requests, use the classic response format (matching fontInAss)
  if (fileEntries.length === 1) {
    const { bytes } = fileEntries[0];
    try {
      const result = await processSubtitle(c.env, bytes, {
        fontsCheck, clearFonts, srtFormat, srtStyle,
      }, c.executionCtx);
      return sendResult(c, result.code, result.messages, result.data);
    } catch (e) {
      console.error("[subset] processSubtitle error:", e);
      return sendResult(c, CODE.SERVER, [`Server error: ${e instanceof Error ? e.message : String(e)}`], null);
    }
  }

  // Batch: return multipart response
  const parts: string[] = [];
  let anyError = false;

  for (const { name, bytes } of fileEntries) {
    try {
      const result = await processSubtitle(c.env, bytes, {
        fontsCheck, clearFonts, srtFormat, srtStyle,
      }, c.executionCtx);
      if (result.code >= 400) anyError = true;
      parts.push(JSON.stringify({
        filename: name,
        code: result.code,
        messages: result.messages,
        data: result.data ? Array.from(result.data) : null,
      }));
    } catch (e) {
      anyError = true;
      console.error("[subset] batch processSubtitle error:", name, e);
      parts.push(JSON.stringify({
        filename: name,
        code: CODE.SERVER,
        messages: [`Server error: ${e instanceof Error ? e.message : String(e)}`],
        data: null,
      }));
    }
  }

  return c.json({ results: parts.map(p => JSON.parse(p)) }, anyError ? 207 : 200);
});

// ─── Core processing ──────────────────────────────────────────────────────────

interface ProcessOptions {
  fontsCheck: boolean;
  clearFonts: boolean;
  srtFormat: string;
  srtStyle: string;
}

interface ProcessResult {
  code: number;
  messages: string[] | null;
  data: Uint8Array | null;
}

async function processSubtitle(
  env: Env,
  rawBytes: Uint8Array,
  opts: ProcessOptions,
  ctx?: ExecutionContext,
): Promise<ProcessResult> {
  // Cache check
  let cacheKey = "";
  try {
    cacheKey = await computeCacheKey(rawBytes, {
      fontsCheck: opts.fontsCheck,
      clearFonts: opts.clearFonts,
      srtFormat: opts.srtFormat,
      srtStyle: opts.srtStyle,
    });
    const cached = await getFromCache(env, cacheKey);
    if (cached) {
      return { code: CODE.OK, messages: null, data: cached };
    }
  } catch {
    // Cache errors are non-fatal — continue without cache
    cacheKey = "";
  }

  // Decode subtitle
  const decoded = decodeAssBytes(rawBytes);
  if (!decoded) {
    return { code: CODE.CLIENT_ERROR, messages: ["Cannot decode subtitle file encoding"], data: null };
  }

  let { text } = decoded;

  // Handle SRT
  if (isSrt(text)) {
    if (!opts.srtFormat || !opts.srtStyle) {
      return { code: CODE.CLIENT_ERROR, messages: ["SRT→ASS conversion not configured (missing SRT format/style)"], data: null };
    }
    text = srtToAss(text, opts.srtFormat, opts.srtStyle);
  }

  // Handle existing [Fonts] section
  // checkFontsSection: 0=none, 1=empty section, 2=has embedded font data
  const fontStatus = checkFontsSection(text);
  if (fontStatus === 2) {
    // Section has real embedded fonts — require explicit opt-in to clear
    if (!opts.clearFonts) {
      return { code: CODE.CLIENT_ERROR, messages: ["Subtitle already has embedded fonts. Enable 'clear fonts' to re-process."], data: null };
    }
    text = removeSection(text, "Fonts");
  } else if (fontStatus === 1) {
    // Empty [Fonts] section — safe to remove silently
    text = removeSection(text, "Fonts");
  }

  // Parse ASS to get per-font codepoint sets
  const { fontCharMap, originalNames } = analyseAss(text);
  const fontEntries = Object.entries(fontCharMap);

  if (fontEntries.length === 0) {
    return { code: CODE.CLIENT_ERROR, messages: ["No fonts referenced in subtitle"], data: null };
  }

  const displayName = (nameLower: string) => originalNames[nameLower] ?? nameLower;

  // Build batch lookup requests — key = "nameLower|weight|italic"
  const lookupReqs = fontEntries.map(([key]) => {
    const [nameLower, weightStr, italicStr] = key.split("|");
    return {
      key,
      nameLower,
      targetWeight: parseInt(weightStr, 10),
      targetItalic: italicStr === "1",
    };
  });

  // Strict mode: batch check all fonts exist before processing
  if (opts.fontsCheck) {
    let strictMatchMap: Map<string, FontLookupResult | null>;
    try {
      strictMatchMap = await lookupFontsBatch(env, lookupReqs);
    } catch (e) {
      return { code: CODE.SERVER, messages: [`Database error during font lookup: ${e instanceof Error ? e.message : String(e)}`], data: null };
    }
    const missing = lookupReqs.filter(r => !strictMatchMap.get(r.key)).map(r => r.nameLower);
    if (missing.length > 0) {
      return { code: CODE.MISSING_FONT, messages: missing.map(n => `Missing font: [${displayName(n)}]`), data: null };
    }
  }

  // Single batch D1 query for all fonts needed in this subtitle
  let matchMap: Map<string, FontLookupResult | null>;
  try {
    matchMap = await lookupFontsBatch(env, lookupReqs);
  } catch (e) {
    return { code: CODE.SERVER, messages: [`Database error: ${e instanceof Error ? e.message : String(e)}`], data: null };
  }

  // Per-request font bytes dedup: same r2Key only read once
  // NOTE: we process fonts sequentially (not Promise.all) to avoid OOM.
  // CJK fonts are 15-30 MB each; opentype.js parses them into ~50 MB JS objects.
  // Sequential processing lets V8 GC reclaim each font before the next starts.
  const bytesCache = new Map<string, Uint8Array | null>();
  const loadBytes = async (r2Key: string): Promise<Uint8Array | null> => {
    if (bytesCache.has(r2Key)) return bytesCache.get(r2Key) ?? null;
    const bytes = await loadFontBytes(env, r2Key);
    bytesCache.set(r2Key, bytes);
    return bytes;
  };

  // Subset fonts one at a time — sequential to control peak memory
  const subsetResults: Awaited<ReturnType<typeof subsetFont>>[] = [];
  for (const [key, unicodeSet] of fontEntries) {
    const [nameLower, weightStr, italicStr] = key.split("|");
    const weight = parseInt(weightStr, 10);
    const italic = italicStr === "1";

    const match = matchMap.get(key);
    if (!match) {
      subsetResults.push({ encoded: "", missingGlyphs: "", error: `Missing font: [${displayName(nameLower)}]` });
      continue;
    }

    const fontBytes = await loadBytes(match.r2Key);
    if (!fontBytes) {
      subsetResults.push({ encoded: "", missingGlyphs: "", error: `Failed to load font from storage: [${displayName(nameLower)}]` });
      continue;
    }

    const result = await subsetFont(fontBytes, match.fontIndex, nameLower, weight, italic, unicodeSet);
    subsetResults.push(result);

    // Release font bytes from cache after subsetting to allow GC
    bytesCache.delete(match.r2Key);
  }

  // Build [Fonts] section
  let fontsSection = "[Fonts]\n";
  const errors: string[] = [];

  for (const res of subsetResults) {
    if (res.error) {
      errors.push(res.error);
    } else {
      fontsSection += res.encoded;
      if (res.missingGlyphs) {
        errors.push(`Missing glyphs: ${res.missingGlyphs}`);
      }
    }
  }

  // Insert [Fonts] before [Events]
  const eventsIdx = text.indexOf("[Events]");
  if (eventsIdx === -1) {
    return { code: CODE.CLIENT_ERROR, messages: ["No [Events] section found in subtitle"], data: null };
  }

  const resultText = text.slice(0, eventsIdx) + fontsSection + "\n" + text.slice(eventsIdx);
  const resultBytes = new TextEncoder().encode("\uFEFF" + resultText);

  // Cache only on full success (no missing fonts/glyphs)
  if (errors.length === 0 && cacheKey) {
    const cacheWrite = setInCache(env, cacheKey, resultBytes).catch(() => {});
    if (ctx) {
      ctx.waitUntil(cacheWrite);
    }
  }

  if (errors.length > 0) {
    return { code: CODE.WARN, messages: errors, data: resultBytes };
  }
  return { code: CODE.OK, messages: null, data: resultBytes };
}

// ─── Response helpers ─────────────────────────────────────────────────────────

import type { Context } from "hono";

function sendResult(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _c: Context<any>,
  code: number,
  messages: string[] | null,
  data: Uint8Array | null,
) {
  const msgHeader = messages
    ? btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(messages))))
    : "";

  return new Response(data ? data.buffer as ArrayBuffer : new ArrayBuffer(0), {
    status: code >= 500 ? 500 : 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Code": String(code),
      "X-Message": msgHeader,
    },
  });
}

export default subset;
