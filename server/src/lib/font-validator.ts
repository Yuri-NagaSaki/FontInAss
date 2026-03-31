/**
 * Strict font file validator — multi-layer defence to ensure
 * uploaded content is a genuine font file.
 *
 * Validation layers (executed in order, fail-fast):
 *  1. File extension whitelist (.ttf, .otf, .ttc, .otc)
 *  2. Magic-byte / file-signature check
 *  3. File-size ceiling
 *  4. Structural parse via opentype.js (must yield ≥ 1 face)
 */

import * as opentype from "opentype.js";

const ALLOWED_EXTENSIONS = new Set(["ttf", "otf", "ttc", "otc"]);

/** Known font file signatures (first 4 bytes). */
const FONT_SIGNATURES: Array<{ label: string; bytes: number[] }> = [
  { label: "TTF",     bytes: [0x00, 0x01, 0x00, 0x00] },
  { label: "OTF",     bytes: [0x4f, 0x54, 0x54, 0x4f] }, // "OTTO"
  { label: "TTC/OTC", bytes: [0x74, 0x74, 0x63, 0x66] }, // "ttcf"
];

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/** Check whether the first 4 bytes match any known font signature. */
export function validateMagicBytes(data: Uint8Array): ValidationResult {
  if (data.length < 4) {
    return { valid: false, error: "File too small to be a font" };
  }

  const matched = FONT_SIGNATURES.some(sig =>
    sig.bytes.every((b, i) => data[i] === b),
  );

  return matched
    ? { valid: true }
    : { valid: false, error: "Invalid font file signature" };
}

/**
 * Full validation pipeline.
 *
 * Returns `{ valid: true }` only if ALL checks pass.
 */
export function validateFontFile(
  filename: string,
  data: Uint8Array,
  maxSize: number,
): ValidationResult {
  // 1. Extension
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { valid: false, error: `Unsupported format: .${ext}` };
  }

  // 2. File size
  if (data.length > maxSize) {
    const mb = (maxSize / 1024 / 1024).toFixed(0);
    return { valid: false, error: `File exceeds ${mb} MB limit` };
  }

  // 3. Magic bytes
  const magicResult = validateMagicBytes(data);
  if (!magicResult.valid) return magicResult;

  // 4. Structural parse — the file must produce at least one valid font face.
  try {
    const buf = (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength)
      ? data.buffer as ArrayBuffer
      : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;

    const isTTC = data[0] === 0x74 && data[1] === 0x74 && data[2] === 0x63 && data[3] === 0x66;

    if (isTTC) {
      // TTC/OTC is a container with multiple font faces sharing tables.
      // opentype.js cannot parse TTC containers at all — it only handles
      // individual TTF/OTF. We validate the TTC header structure instead:
      //   [tag 4B][version 4B][numFonts 4B][offsets numFonts×4B]
      const view = new DataView(buf);
      const numFonts = view.getUint32(8, false);
      if (numFonts === 0 || numFonts > 256) {
        return { valid: false, error: "Invalid TTC: bad face count" };
      }
      // Verify each face offset points to a valid TTF/OTF signature
      for (let i = 0; i < numFonts; i++) {
        const offset = view.getUint32(12 + i * 4, false);
        if (offset + 4 > buf.byteLength) {
          return { valid: false, error: `Invalid TTC: face ${i} offset out of range` };
        }
        const sig = new Uint8Array(buf, offset, 4);
        const isTTF = sig[0] === 0x00 && sig[1] === 0x01 && sig[2] === 0x00 && sig[3] === 0x00;
        const isOTF = sig[0] === 0x4f && sig[1] === 0x54 && sig[2] === 0x54 && sig[3] === 0x4f;
        if (!isTTF && !isOTF) {
          return { valid: false, error: `Invalid TTC: face ${i} has bad signature` };
        }
      }
    } else {
      const font = opentype.parse(buf, { lowMemory: true });
      if (!font) {
        return { valid: false, error: "Failed to parse font structure" };
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { valid: false, error: `Invalid font structure: ${msg}` };
  }

  return { valid: true };
}
