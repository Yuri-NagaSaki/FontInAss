/**
 * Strict font file validator — multi-layer defence to ensure
 * uploaded content is a genuine font file.
 *
 * Validation layers (executed in order, fail-fast):
 *  1. File extension whitelist (.ttf, .otf, .ttc, .otc)
 *  2. Magic-byte / file-signature check
 *  3. Structural sfnt/TTC table validation (must yield ≥ 1 face)
 */

const ALLOWED_EXTENSIONS = new Set(["ttf", "otf", "ttc", "otc"]);
const MAX_TABLES_PER_FACE = 512;
const MAX_TTC_FACES = 256;

const SFNT_TTF = 0x00010000;
const SFNT_OTTO = 0x4f54544f; // "OTTO"
const TTCF = 0x74746366; // "ttcf"

const REQUIRED_COMMON_TABLES = ["cmap", "head", "hhea", "hmtx", "maxp", "name"] as const;

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

export interface SfntTableRecord {
  tag: string;
  checksum: number;
  offset: number;
  length: number;
}

export interface SfntDirectory {
  sfntVersion: number;
  numTables: number;
  tables: Map<string, SfntTableRecord>;
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength)
    ? data.buffer as ArrayBuffer
    : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

function fourChar(value: number): string {
  return String.fromCharCode(
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  );
}

function isSupportedSfntVersion(version: number): boolean {
  return version === SFNT_TTF || version === SFNT_OTTO;
}

function checkTableBounds(buf: ArrayBuffer, offset: number, length: number, label: string): void {
  if (offset > buf.byteLength || length > buf.byteLength - offset) {
    throw new Error(`Invalid font: ${label} table out of range`);
  }
}

/**
 * Read an sfnt table directory without parsing optional OpenType layout tables.
 *
 * Some real fonts use newer GDEF versions that opentype.js cannot parse yet.
 * Upload validation only needs to prove that the file is a structurally valid
 * sfnt face, so this inspects the directory and required table bounds directly.
 */
export function readSfntTables(buf: ArrayBuffer, directoryOffset = 0): SfntDirectory {
  const view = new DataView(buf);
  if (directoryOffset + 12 > buf.byteLength) {
    throw new Error("Invalid font: sfnt header truncated");
  }

  const sfntVersion = view.getUint32(directoryOffset, false);
  if (!isSupportedSfntVersion(sfntVersion)) {
    throw new Error(`Invalid font: unsupported sfnt signature ${fourChar(sfntVersion)}`);
  }

  const numTables = view.getUint16(directoryOffset + 4, false);
  if (numTables === 0 || numTables > MAX_TABLES_PER_FACE) {
    throw new Error(`Invalid font: bad table count ${numTables}`);
  }

  const directoryEnd = directoryOffset + 12 + numTables * 16;
  if (directoryEnd > buf.byteLength) {
    throw new Error("Invalid font: table directory truncated");
  }

  const tables = new Map<string, SfntTableRecord>();
  for (let i = 0; i < numTables; i++) {
    const recordOffset = directoryOffset + 12 + i * 16;
    const tag = String.fromCharCode(
      view.getUint8(recordOffset),
      view.getUint8(recordOffset + 1),
      view.getUint8(recordOffset + 2),
      view.getUint8(recordOffset + 3),
    );

    if (!/^[\x20-\x7E]{4}$/.test(tag)) {
      throw new Error(`Invalid font: table ${i} has invalid tag`);
    }
    if (tables.has(tag)) {
      throw new Error(`Invalid font: duplicate ${tag} table`);
    }

    const record = {
      tag,
      checksum: view.getUint32(recordOffset + 4, false),
      offset: view.getUint32(recordOffset + 8, false),
      length: view.getUint32(recordOffset + 12, false),
    };
    checkTableBounds(buf, record.offset, record.length, tag);
    tables.set(tag, record);
  }

  return { sfntVersion, numTables, tables };
}

function validateHeadTable(buf: ArrayBuffer, tables: Map<string, SfntTableRecord>): ValidationResult {
  const head = tables.get("head");
  if (!head || head.length < 54) {
    return { valid: false, error: "Invalid font: missing or truncated head table" };
  }

  const view = new DataView(buf);
  const magic = view.getUint32(head.offset + 12, false);
  if (magic !== 0x5f0f3cf5) {
    return { valid: false, error: "Invalid font: bad head table magic" };
  }

  const unitsPerEm = view.getUint16(head.offset + 18, false);
  if (unitsPerEm < 16 || unitsPerEm > 16384) {
    return { valid: false, error: "Invalid font: bad unitsPerEm" };
  }

  return { valid: true };
}

function validateMaxpTable(buf: ArrayBuffer, tables: Map<string, SfntTableRecord>): ValidationResult {
  const maxp = tables.get("maxp");
  if (!maxp || maxp.length < 6) {
    return { valid: false, error: "Invalid font: missing or truncated maxp table" };
  }

  const glyphCount = new DataView(buf).getUint16(maxp.offset + 4, false);
  if (glyphCount === 0) {
    return { valid: false, error: "Invalid font: no glyphs" };
  }

  return { valid: true };
}

function validateNameTable(buf: ArrayBuffer, tables: Map<string, SfntTableRecord>): ValidationResult {
  const name = tables.get("name");
  if (!name || name.length < 6) {
    return { valid: false, error: "Invalid font: missing or truncated name table" };
  }

  const view = new DataView(buf);
  const count = view.getUint16(name.offset + 2, false);
  const stringOffset = view.getUint16(name.offset + 4, false);
  if (count === 0 || count > 10000) {
    return { valid: false, error: "Invalid font: bad name record count" };
  }
  if (6 + count * 12 > name.length || stringOffset > name.length) {
    return { valid: false, error: "Invalid font: name table truncated" };
  }

  const tableEnd = name.offset + name.length;
  const storageStart = name.offset + stringOffset;
  for (let i = 0; i < count; i++) {
    const recordOffset = name.offset + 6 + i * 12;
    const length = view.getUint16(recordOffset + 8, false);
    const offset = view.getUint16(recordOffset + 10, false);
    const stringStart = storageStart + offset;
    if (stringStart > tableEnd || length > tableEnd - stringStart) {
      return { valid: false, error: "Invalid font: name string out of range" };
    }
  }

  return { valid: true };
}

function validateCmapTable(buf: ArrayBuffer, tables: Map<string, SfntTableRecord>): ValidationResult {
  const cmap = tables.get("cmap");
  if (!cmap || cmap.length < 4) {
    return { valid: false, error: "Invalid font: missing or truncated cmap table" };
  }

  const view = new DataView(buf);
  const count = view.getUint16(cmap.offset + 2, false);
  if (count === 0 || count > 1024) {
    return { valid: false, error: "Invalid font: bad cmap record count" };
  }
  if (4 + count * 8 > cmap.length) {
    return { valid: false, error: "Invalid font: cmap table truncated" };
  }

  for (let i = 0; i < count; i++) {
    const recordOffset = cmap.offset + 4 + i * 8;
    const subtableOffset = view.getUint32(recordOffset + 4, false);
    if (subtableOffset >= cmap.length) {
      return { valid: false, error: "Invalid font: cmap subtable out of range" };
    }
  }

  return { valid: true };
}

export function validateSfntStructure(buf: ArrayBuffer, directoryOffset = 0): ValidationResult {
  try {
    const { sfntVersion, tables } = readSfntTables(buf, directoryOffset);

    for (const tag of REQUIRED_COMMON_TABLES) {
      if (!tables.has(tag)) {
        return { valid: false, error: `Invalid font: missing ${tag} table` };
      }
    }

    const hasTrueTypeOutlines = tables.has("glyf") && tables.has("loca");
    const hasCffOutlines = tables.has("CFF ") || tables.has("CFF2");
    if (!hasTrueTypeOutlines && !hasCffOutlines) {
      return { valid: false, error: "Invalid font: missing outline table" };
    }
    if (sfntVersion === SFNT_OTTO && !hasCffOutlines) {
      return { valid: false, error: "Invalid OTF: missing CFF table" };
    }

    for (const check of [validateHeadTable, validateMaxpTable, validateNameTable, validateCmapTable]) {
      const result = check(buf, tables);
      if (!result.valid) return result;
    }

    return { valid: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { valid: false, error: msg };
  }
}

export function getTtcFaceOffsets(buf: ArrayBuffer): number[] {
  const view = new DataView(buf);
  if (buf.byteLength < 12) {
    throw new Error("Invalid TTC: header truncated");
  }
  if (view.getUint32(0, false) !== TTCF) {
    throw new Error("Invalid TTC: bad signature");
  }

  const version = view.getUint32(4, false);
  if (version !== 0x00010000 && version !== 0x00020000) {
    throw new Error("Invalid TTC: unsupported version");
  }

  const numFonts = view.getUint32(8, false);
  if (numFonts === 0 || numFonts > MAX_TTC_FACES) {
    throw new Error("Invalid TTC: bad face count");
  }
  if (12 + numFonts * 4 > buf.byteLength) {
    throw new Error("Invalid TTC: offset table truncated");
  }

  const offsets: number[] = [];
  for (let i = 0; i < numFonts; i++) {
    const offset = view.getUint32(12 + i * 4, false);
    if (offset + 12 > buf.byteLength) {
      throw new Error(`Invalid TTC: face ${i} offset out of range`);
    }
    offsets.push(offset);
  }

  return offsets;
}

function validateTtcStructure(buf: ArrayBuffer): ValidationResult {
  try {
    const offsets = getTtcFaceOffsets(buf);
    for (let i = 0; i < offsets.length; i++) {
      const result = validateSfntStructure(buf, offsets[i]);
      if (!result.valid) {
        return { valid: false, error: `Invalid TTC: face ${i}: ${result.error}` };
      }
    }
    return { valid: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { valid: false, error: msg };
  }
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
 * No file-size ceiling — local deployments have no memory constraints.
 */
export function validateFontFile(
  filename: string,
  data: Uint8Array,
): ValidationResult {
  // 1. Extension
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { valid: false, error: `Unsupported format: .${ext}` };
  }

  // 2. Magic bytes
  const magicResult = validateMagicBytes(data);
  if (!magicResult.valid) return magicResult;

  // 3. Structural validation - avoid full OpenType layout parsing here.
  // Optional tables such as GDEF can legally use versions unsupported by
  // opentype.js, but the font is still valid and should be uploadable.
  const buf = toArrayBuffer(data);
  const isTTC = data[0] === 0x74 && data[1] === 0x74 && data[2] === 0x63 && data[3] === 0x66;
  const structure = isTTC ? validateTtcStructure(buf) : validateSfntStructure(buf);
  return structure.valid
    ? { valid: true }
    : { valid: false, error: `Invalid font structure: ${structure.error}` };
}
