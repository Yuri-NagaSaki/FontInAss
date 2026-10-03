import { getTtcFaceOffsets, readSfntTables, validateFontFile, type SfntTableRecord } from "./font-validator.js";

export interface FontFaceMetadata {
  index: number;
  familyNames: string[];
  weight: number;
  bold: boolean;
  italic: boolean;
}

export class OpenTypeFontInspector {
  inspect(bytes: Uint8Array): FontFaceMetadata[] {
    return parseFontMetadata(bytes);
  }

  validate(filename: string, bytes: Uint8Array): { valid: boolean; error?: string } {
    return validateFontFile(filename, bytes);
  }
}

function isTtc(data: Uint8Array): boolean {
  return data[0] === 0x74 && data[1] === 0x74 && data[2] === 0x63 && data[3] === 0x66;
}

const FALLBACK_NAME_IDS = new Set([1, 4, 6, 16]);

function decodeUtf16Be(bytes: Uint8Array): string {
  const units: number[] = [];
  for (let index = 0; index + 1 < bytes.length; index += 2) units.push((bytes[index] << 8) | bytes[index + 1]);
  let result = "";
  for (let index = 0; index < units.length; index += 8192) result += String.fromCharCode(...units.slice(index, index + 8192));
  return result;
}

function decodeName(platformId: number, encodingId: number, bytes: Uint8Array): string {
  if (platformId === 0 || platformId === 3) return decodeUtf16Be(bytes);
  if (platformId === 1) {
    try { return new TextDecoder("macintosh").decode(bytes); } catch { return new TextDecoder("latin1").decode(bytes); }
  }
  if (bytes.length >= 2 && bytes.length % 2 === 0 && bytes[0] === 0) return decodeUtf16Be(bytes);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return encodingId === 0 ? new TextDecoder("latin1").decode(bytes) : decodeUtf16Be(bytes); }
}

function parseNamesFromSfnt(buffer: ArrayBuffer, tables: Map<string, SfntTableRecord>): string[] {
  const table = tables.get("name");
  if (!table || table.length < 6) return [];
  const view = new DataView(buffer);
  const count = view.getUint16(table.offset + 2, false);
  const storageStart = table.offset + view.getUint16(table.offset + 4, false);
  const tableEnd = table.offset + table.length;
  const byNameId = new Map<number, { primary: Set<string>; fallback: Set<string> }>();
  for (let index = 0; index < count; index++) {
    const offset = table.offset + 6 + index * 12;
    if (offset + 12 > tableEnd) break;
    const platformId = view.getUint16(offset, false);
    const encodingId = view.getUint16(offset + 2, false);
    const nameId = view.getUint16(offset + 6, false);
    if (!FALLBACK_NAME_IDS.has(nameId)) continue;
    const length = view.getUint16(offset + 8, false);
    const start = storageStart + view.getUint16(offset + 10, false);
    if (start > tableEnd || length > tableEnd - start) continue;
    const decoded = decodeName(platformId, encodingId, new Uint8Array(buffer, start, length)).replace(/\0/g, "").replace(/\s+/g, " ").trim();
    if (!decoded) continue;
    const bucket = byNameId.get(nameId) ?? { primary: new Set<string>(), fallback: new Set<string>() };
    (platformId === 0 || platformId === 3 ? bucket.primary : bucket.fallback).add(decoded);
    byNameId.set(nameId, bucket);
  }
  const result = new Set<string>();
  for (const id of [16, 1, 4, 6]) {
    const bucket = byNameId.get(id);
    if (!bucket) continue;
    for (const value of bucket.primary.size ? bucket.primary : bucket.fallback) result.add(value);
  }
  return [...result];
}

function parseStyle(buffer: ArrayBuffer, tables: Map<string, SfntTableRecord>) {
  const view = new DataView(buffer);
  let weight = 400;
  let bold = false;
  let italic = false;
  const os2 = tables.get("OS/2");
  if (os2 && os2.length >= 64) {
    const candidate = view.getUint16(os2.offset + 4, false);
    if (candidate >= 1 && candidate <= 1000) weight = candidate;
    const selection = view.getUint16(os2.offset + 62, false);
    bold ||= Boolean(selection & 0x20);
    italic ||= Boolean(selection & 0x01);
  }
  const head = tables.get("head");
  if (head && head.length >= 46) {
    const style = view.getUint16(head.offset + 44, false);
    bold ||= Boolean(style & 0x01);
    italic ||= Boolean(style & 0x02);
  }
  return { weight, bold, italic };
}

function fallback(buffer: ArrayBuffer, directoryOffset: number, index: number): FontFaceMetadata | null {
  try {
    const { tables } = readSfntTables(buffer, directoryOffset);
    return { index, familyNames: parseNamesFromSfnt(buffer, tables), ...parseStyle(buffer, tables) };
  } catch { return null; }
}

export function parseFontMetadata(bytes: Uint8Array): FontFaceMetadata[] {
  const buffer = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer as ArrayBuffer
    : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  let offsets: number[];
  try { offsets = isTtc(bytes) ? getTtcFaceOffsets(buffer) : [0]; } catch { return []; }
  return offsets.flatMap((offset, index) => {
    const face = fallback(buffer, offset, index);
    return face ? [face] : [];
  });
}
