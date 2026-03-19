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
import { lookupFont, loadFontBytes } from "../lib/font-manager.js";
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

  if (contentType.includes("multipart/form-data")) {
    const form = await c.req.formData();
    const files = form.getAll("file");
    for (const f of files) {
      if (typeof f !== "string" && "arrayBuffer" in f) {
        const file = f as File;
        fileEntries.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
      }
    }
  } else {
    // Single file
    const rawBytes = new Uint8Array(await c.req.arrayBuffer());
    const filenameRaw = c.req.header("x-filename") ?? "";
    let filename = "subtitle.ass";
    if (filenameRaw) {
      try {
        filename = decodeURIComponent(escape(atob(filenameRaw)));
      } catch {
        filename = filenameRaw;
      }
    }
    fileEntries.push({ name: filename, bytes: rawBytes });
  }

  if (fileEntries.length === 0) {
    return sendResult(c, CODE.CLIENT_ERROR, ["No file provided"], null);
  }

  // For single-file requests, use the classic response format (matching fontInAss)
  if (fileEntries.length === 1) {
    const { bytes } = fileEntries[0];
    const result = await processSubtitle(c.env, bytes, {
      fontsCheck, clearFonts, srtFormat, srtStyle,
    });
    return sendResult(c, result.code, result.messages, result.data);
  }

  // Batch: return multipart response
  const parts: string[] = [];
  let anyError = false;

  for (const { name, bytes } of fileEntries) {
    const result = await processSubtitle(c.env, bytes, {
      fontsCheck, clearFonts, srtFormat, srtStyle,
    });
    if (result.code >= 400) anyError = true;
    // Pack as JSON envelope per file
    parts.push(JSON.stringify({
      filename: name,
      code: result.code,
      messages: result.messages,
      data: result.data ? Array.from(result.data) : null,
    }));
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
): Promise<ProcessResult> {
  // Cache check
  const cacheKey = await computeCacheKey(rawBytes, {
    fontsCheck: opts.fontsCheck,
    clearFonts: opts.clearFonts,
    srtFormat: opts.srtFormat,
    srtStyle: opts.srtStyle,
  });

  const cached = await getFromCache(env, cacheKey);
  if (cached) {
    return { code: CODE.OK, messages: null, data: cached };
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
  const fontStatus = checkFontsSection(text);
  if (fontStatus === 1) {
    if (!opts.clearFonts) {
      return { code: CODE.CLIENT_ERROR, messages: ["Subtitle already has embedded fonts. Enable 'clear fonts' to re-process."], data: null };
    }
    text = removeSection(text, "Fonts");
  } else if (fontStatus === 2) {
    text = removeSection(text, "Fonts");
  }

  // Parse ASS to get per-font codepoint sets
  const { fontCharMap } = analyseAss(text);
  const fontEntries = Object.entries(fontCharMap);

  if (fontEntries.length === 0) {
    return { code: CODE.CLIENT_ERROR, messages: ["No fonts referenced in subtitle"], data: null };
  }

  // Strict mode: check all fonts exist before processing
  if (opts.fontsCheck) {
    const missing: string[] = [];
    await Promise.all(
      fontEntries.map(async ([key]) => {
        const [nameLower, weightStr, italicStr] = key.split("|");
        const weight = parseInt(weightStr, 10);
        const italic = italicStr === "1";
        const match = await lookupFont(env, nameLower, weight, italic);
        if (!match) missing.push(nameLower);
      })
    );
    if (missing.length > 0) {
      return { code: CODE.MISSING_FONT, messages: missing.map(n => `Missing font: [${n}]`), data: null };
    }
  }

  // Subset all fonts in parallel
  const subsetResults = await Promise.all(
    fontEntries.map(async ([key, unicodeSet]) => {
      const [nameLower, weightStr, italicStr] = key.split("|");
      const weight = parseInt(weightStr, 10);
      const italic = italicStr === "1";

      const match = await lookupFont(env, nameLower, weight, italic);
      if (!match) {
        return { encoded: "", error: `Missing font: [${nameLower}]` };
      }

      const fontBytes = await loadFontBytes(env, match.r2Key);
      if (!fontBytes) {
        return { encoded: "", error: `Failed to load font from storage: [${nameLower}]` };
      }

      return subsetFont(fontBytes, match.fontIndex, nameLower, weight, italic, unicodeSet);
    })
  );

  // Build [Fonts] section
  let fontsSection = "[Fonts]\n";
  const errors: string[] = [];

  for (const res of subsetResults) {
    if (res.error) {
      errors.push(res.error);
    } else {
      fontsSection += res.encoded;
      if ("missingGlyphs" in res && res.missingGlyphs) {
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
  if (errors.length === 0) {
    await setInCache(env, cacheKey, resultBytes).catch(() => { /* non-critical */ });
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
    ? btoa(unescape(encodeURIComponent(JSON.stringify(messages))))
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
