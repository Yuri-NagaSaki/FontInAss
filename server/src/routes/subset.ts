import { Hono } from "hono";
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
import { computeCacheKey, getFromCache, setInCache } from "../cache.js";
import { config, log } from "../config.js";
import type { Context } from "hono";

const subset = new Hono();

subset.post("/", async (c) => {
  const reqStart = Date.now();
  const contentType = c.req.header("content-type") ?? "";
  const fontsCheck = c.req.header("x-fonts-check") === "1";
  const clearFonts = c.req.header("x-clear-fonts") === "1";
  const srtFormatB64 = c.req.header("x-srt-format") ?? "";
  const srtStyleB64 = c.req.header("x-srt-style") ?? "";
  const srtFormat = srtFormatB64 ? atob(srtFormatB64) : "";
  const srtStyle = srtStyleB64 ? atob(srtStyleB64) : "";

  const fileEntries: { name: string; bytes: Uint8Array }[] = [];

  try {
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
      const rawBytes = new Uint8Array(await c.req.arrayBuffer());
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
    return sendResult(c, CODE.SERVER_ERROR, [`Failed to read request: ${e instanceof Error ? e.message : String(e)}`], null);
  }

  if (fileEntries.length === 0) {
    return sendResult(c, CODE.CLIENT_ERROR, ["No file provided"], null);
  }

  log("info", `[subset] received ${fileEntries.length} file(s): ${
    fileEntries.map(f => `${f.name} (${(f.bytes.length / 1024).toFixed(1)} KB)`).join(", ")
  }`);

  // Single-file response (classic fontInAss format)
  if (fileEntries.length === 1) {
    const { name, bytes } = fileEntries[0];
    try {
      const result = await processSubtitle(name, bytes, { fontsCheck, clearFonts, srtFormat, srtStyle });
      log("info", `[subset] ${name} → code=${result.code} size=${result.data?.length ?? 0}B elapsed=${Date.now()-reqStart}ms`);
      return sendResult(c, result.code, result.messages, result.data);
    } catch (e) {
      log("error", `[subset] ${name} unhandled error:`, e);
      return sendResult(c, CODE.SERVER_ERROR, [`Server error: ${e instanceof Error ? e.message : String(e)}`], null);
    }
  }

  // Batch: process all files, return JSON array
  const parts: { filename: string; code: number; messages: string[] | null; data: number[] | null }[] = [];
  let anyError = false;

  // Process with concurrency limit to avoid resource exhaustion on large batches
  const BATCH_CONCURRENCY = Math.min(config.subsetConcurrency, fileEntries.length);
  for (let i = 0; i < fileEntries.length; i += BATCH_CONCURRENCY) {
    const chunk = fileEntries.slice(i, i + BATCH_CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(async ({ name, bytes }) =>
        processSubtitle(name, bytes, { fontsCheck, clearFonts, srtFormat, srtStyle })
      )
    );
    for (let j = 0; j < results.length; j++) {
      const { name } = chunk[j];
      if (results[j].status === "fulfilled") {
        const r = (results[j] as PromiseFulfilledResult<ProcessResult>).value;
        if (r.code >= 400) anyError = true;
        log("info", `[subset] batch[${i+j}] ${name} → code=${r.code} size=${r.data?.length ?? 0}B`);
        parts.push({ filename: name, code: r.code, messages: r.messages, data: r.data ? Array.from(r.data) : null });
      } else {
        anyError = true;
        const err = (results[j] as PromiseRejectedResult).reason;
        log("error", `[subset] batch[${i+j}] ${name} rejected:`, err);
        parts.push({ filename: name, code: CODE.SERVER_ERROR, messages: [String(err)], data: null });
      }
    }
  }

  log("info", `[subset] batch done: ${fileEntries.length} files, anyError=${anyError}, elapsed=${Date.now()-reqStart}ms`);
  return c.json({ results: parts }, anyError ? 207 : 200);
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
  filename: string,
  rawBytes: Uint8Array,
  opts: ProcessOptions,
): Promise<ProcessResult> {
  const t0 = Date.now();
  log("debug", `[subset:${filename}] start processing ${(rawBytes.length/1024).toFixed(1)} KB`);

  // Cache check
  let cacheKey = "";
  try {
    cacheKey = await computeCacheKey(rawBytes, {
      fontsCheck: opts.fontsCheck,
      clearFonts: opts.clearFonts,
      srtFormat: opts.srtFormat,
      srtStyle: opts.srtStyle,
    });
    const cached = getFromCache(cacheKey);
    if (cached) {
      log("debug", `[subset:${filename}] cache hit → ${cached.length}B`);
      return { code: CODE.OK, messages: null, data: cached };
    }
    log("debug", `[subset:${filename}] cache miss`);
  } catch {
    cacheKey = "";
  }

  const decoded = decodeAssBytes(rawBytes);
  if (!decoded) {
    log("warn", `[subset:${filename}] cannot decode subtitle encoding`);
    return { code: CODE.CLIENT_ERROR, messages: ["Cannot decode subtitle file encoding"], data: null };
  }

  let { text } = decoded;
  log("debug", `[subset:${filename}] decoded ${text.length} chars (encoding: ${decoded.encoding ?? "utf-8"})`);

  if (isSrt(text)) {
    if (!opts.srtFormat || !opts.srtStyle) {
      return { code: CODE.CLIENT_ERROR, messages: ["SRT→ASS conversion not configured (missing SRT format/style)"], data: null };
    }
    text = srtToAss(text, opts.srtFormat, opts.srtStyle);
    log("debug", `[subset:${filename}] converted SRT→ASS`);
  }

  const fontStatus = checkFontsSection(text);
  if (fontStatus === 2) {
    if (!opts.clearFonts) {
      return { code: CODE.CLIENT_ERROR, messages: ["Subtitle already has embedded fonts. Enable 'clear fonts' to re-process."], data: null };
    }
    text = removeSection(text, "Fonts");
    log("debug", `[subset:${filename}] cleared existing Fonts section`);
  } else if (fontStatus === 1) {
    text = removeSection(text, "Fonts");
  }

  const { fontCharMap, originalNames } = analyseAss(text);
  const fontEntries = Object.entries(fontCharMap);
  log("debug", `[subset:${filename}] found ${fontEntries.length} font(s): ${
    fontEntries.map(([k, v]) => {
      const [name] = k.split("|");
      return `${originalNames[name] ?? name}(${v.size} chars)`;
    }).join(", ")
  }`);

  if (fontEntries.length === 0) {
    return { code: CODE.CLIENT_ERROR, messages: ["No fonts referenced in subtitle"], data: null };
  }

  const displayName = (nameLower: string) => originalNames[nameLower] ?? nameLower;

  const lookupReqs = fontEntries.map(([key]) => {
    const [nameLower, weightStr, italicStr] = key.split("|");
    return { key, nameLower, targetWeight: parseInt(weightStr, 10), targetItalic: italicStr === "1" };
  });

  if (opts.fontsCheck) {
    let strictMatchMap: Map<string, FontLookupResult | null>;
    try {
      strictMatchMap = lookupFontsBatch(lookupReqs);
    } catch (e) {
      return { code: CODE.SERVER_ERROR, messages: [`Database error: ${e instanceof Error ? e.message : String(e)}`], data: null };
    }
    const missing = lookupReqs.filter(r => !strictMatchMap.get(r.key)).map(r => r.nameLower);
    if (missing.length > 0) {
      log("warn", `[subset:${filename}] fonts-check failed, missing: ${missing.map(n => displayName(n)).join(", ")}`);
      return { code: CODE.MISSING_FONT, messages: missing.map(n => `Missing font: [${displayName(n)}]`), data: null };
    }
  }

  let matchMap: Map<string, FontLookupResult | null>;
  try {
    matchMap = lookupFontsBatch(lookupReqs);
  } catch (e) {
    return { code: CODE.SERVER_ERROR, messages: [`Database error: ${e instanceof Error ? e.message : String(e)}`], data: null };
  }

  // Log lookup results
  for (const req of lookupReqs) {
    const m = matchMap.get(req.key);
    if (m) {
      log("debug", `[subset:${filename}]   ✓ "${displayName(req.nameLower)}" → ${m.r2Key} [face=${m.fontIndex}]`);
    } else {
      log("debug", `[subset:${filename}]   ✗ "${displayName(req.nameLower)}" not found in DB`);
    }
  }

  // Group entries by font file (r2Key) so we load each file exactly once,
  // process all its variants, then release the bytes before loading the next.
  // This keeps peak memory to O(1 font file) instead of O(all fonts simultaneously).
  const byFile = new Map<string, Array<{ key: string; unicodeSet: Set<number>; nameLower: string; weight: number; italic: boolean }>>();
  const missingEntries: Array<{ key: string; nameLower: string }> = [];

  for (const [key, unicodeSet] of fontEntries) {
    const [nameLower, weightStr, italicStr] = key.split("|");
    const weight = parseInt(weightStr, 10);
    const italic = italicStr === "1";
    const match = matchMap.get(key);
    if (!match) {
      missingEntries.push({ key, nameLower });
      continue;
    }
    const group = byFile.get(match.r2Key) ?? [];
    group.push({ key, unicodeSet, nameLower, weight, italic });
    byFile.set(match.r2Key, group);
  }

  // Preserve original ordering of entries in the output
  const subsetResultMap = new Map<string, { encoded: string; missingGlyphs: string; error: string | null }>();

  // Missing fonts → pre-fill errors
  for (const { key, nameLower } of missingEntries) {
    subsetResultMap.set(key, { encoded: "", missingGlyphs: "", error: `Missing font: [${displayName(nameLower)}]` });
  }

  // Process one font file at a time — load, subset all variants, release
  log("debug", `[subset:${filename}] starting subset of ${fontEntries.length} font variant(s) across ${byFile.size} file(s)…`);
  for (const [r2Key, variants] of byFile) {
    const tLoad = Date.now();
    const loaded = await loadFontBytes(r2Key);
    const fontBytes = loaded?.bytes ?? null;
    const resolvedKey = loaded?.resolvedKey ?? r2Key;
    log("debug", `[subset:${filename}]   loaded ${resolvedKey} → ${fontBytes ? `${(fontBytes.length/1024/1024).toFixed(2)} MB` : "null"} in ${Date.now()-tLoad}ms`);

    if (!fontBytes) {
      log("warn", `[subset:${filename}] font file missing on disk: ${r2Key}`);
      for (const { key, nameLower } of variants) {
        subsetResultMap.set(key, { encoded: "", missingGlyphs: "", error: `Failed to load font from storage: [${displayName(nameLower)}] — file not found at: ${r2Key}` });
      }
      continue;
    }

    for (const { key, unicodeSet, nameLower, weight, italic } of variants) {
      const match = matchMap.get(key)!;
      const tSub = Date.now();
      const result = await subsetFont(fontBytes, match.fontIndex, nameLower, weight, italic, unicodeSet);
      log("debug", `[subset:${filename}]   subsetted "${displayName(nameLower)}" in ${Date.now()-tSub}ms → ${result.encoded.length} encoded chars${result.error ? ` ERROR: ${result.error}` : ""}${result.missingGlyphs ? ` MISSING: ${result.missingGlyphs}` : ""}`);
      subsetResultMap.set(key, result);
    }
    // fontBytes goes out of scope here — eligible for GC before next file loads
  }

  let fontsSection = "[Fonts]\n";
  const errors: string[] = [];

  // Reassemble in original order
  for (const [key] of fontEntries) {
    const res = subsetResultMap.get(key);
    if (!res) continue;
    if (res.error) {
      errors.push(res.error);
    } else {
      fontsSection += res.encoded;
      if (res.missingGlyphs) errors.push(`Missing glyphs: ${res.missingGlyphs}`);
    }
  }

  const eventsIdx = text.indexOf("[Events]");
  if (eventsIdx === -1) {
    return { code: CODE.CLIENT_ERROR, messages: ["No [Events] section found in subtitle"], data: null };
  }

  const resultText = text.slice(0, eventsIdx) + fontsSection + "\n" + text.slice(eventsIdx);
  const resultBytes = new TextEncoder().encode("\uFEFF" + resultText);

  if (errors.length === 0 && cacheKey) {
    setInCache(cacheKey, resultBytes);
  }

  const elapsed = Date.now() - t0;
  log("info", `[subset:${filename}] done in ${elapsed}ms → output=${(resultBytes.length/1024).toFixed(1)} KB, errors=${errors.length}`);
  if (errors.length > 0) {
    log("debug", `[subset:${filename}] warnings: ${errors.join("; ")}`);
    return { code: CODE.WARN, messages: errors, data: resultBytes };
  }
  return { code: CODE.OK, messages: null, data: resultBytes };
}

// ─── Response helper ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sendResult(c: Context<any>, code: number, messages: string[] | null, data: Uint8Array | null) {
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
