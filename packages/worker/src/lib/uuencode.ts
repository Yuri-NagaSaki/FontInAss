/**
 * UUencode implementation matching the ASS [Fonts] section format.
 *
 * Spec: https://github.com/weizhenye/ASS/wiki/ASS-字幕格式规范#9-附录-b---内嵌字体图片编码
 * This is a TypeScript port of the Cython uuencode implementation in fontInAss.
 *
 * Key differences from standard uuencode:
 * - No length prefix per line
 * - offset = 33 (standard)
 * - line width = 80 encoded chars (= 60 input bytes per line)
 */

const CHUNK_SIZE = 80; // encoded chars per line
const OFFSET = 33;

const CHR_MAP = new Uint8Array(64);
for (let i = 0; i < 64; i++) CHR_MAP[i] = OFFSET + i;

/**
 * Encode binary data to ASS-compatible uuencoded string.
 */
export function uuencode(data: Uint8Array): string {
  const dataLen = data.length;
  if (dataLen === 0) return "";

  const remainder = dataLen % 3;
  const fullGroups = Math.floor(dataLen / 3);

  // Pre-calculate output size: 4 chars per 3 bytes + newlines every CHUNK_SIZE chars
  const encodedSize = fullGroups * 4 + (remainder > 0 ? remainder + 1 : 0);
  const newlines = Math.floor((encodedSize - 1) / CHUNK_SIZE);
  const outputSize = encodedSize + newlines;

  const out = new Uint8Array(outputSize);
  let outIdx = 0;
  let counter = CHUNK_SIZE;

  const addChar = (c: number) => {
    out[outIdx++] = c;
    counter -= 1;
    if (counter === 0) {
      out[outIdx++] = 10; // '\n'
      counter = CHUNK_SIZE;
    }
  };

  // Process full 3-byte groups
  for (let i = 0; i < dataLen - remainder; i += 3) {
    const packed = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    addChar(CHR_MAP[(packed >> 18) & 0x3F]);
    addChar(CHR_MAP[(packed >> 12) & 0x3F]);
    addChar(CHR_MAP[(packed >> 6) & 0x3F]);
    addChar(CHR_MAP[packed & 0x3F]);
  }

  // Handle remaining bytes
  if (remainder === 1) {
    const packed = data[dataLen - 1] << 16;
    addChar(CHR_MAP[(packed >> 18) & 0x3F]);
    addChar(CHR_MAP[(packed >> 12) & 0x3F]);
  } else if (remainder === 2) {
    const packed = (data[dataLen - 2] << 16) | (data[dataLen - 1] << 8);
    addChar(CHR_MAP[(packed >> 18) & 0x3F]);
    addChar(CHR_MAP[(packed >> 12) & 0x3F]);
    addChar(CHR_MAP[(packed >> 6) & 0x3F]);
  }

  // Remove trailing newline if present
  let finalLen = outIdx;
  if (finalLen > 0 && out[finalLen - 1] === 10) finalLen--;

  return new TextDecoder("ascii").decode(out.slice(0, finalLen));
}

/**
 * Decode ASS-compatible uuencoded string back to binary.
 * Used by the frontend to extract embedded fonts from processed subtitles.
 */
export function uudecode(encoded: string): Uint8Array {
  const lines = encoded.split("\n");
  const chunks: Uint8Array[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    const bytes = new Uint8Array(line.length);
    for (let i = 0; i < line.length; i++) {
      bytes[i] = line.charCodeAt(i) - OFFSET;
    }

    // Decode groups of 4 → 3 bytes
    const outBytes: number[] = [];
    for (let i = 0; i + 3 < bytes.length; i += 4) {
      outBytes.push((bytes[i] << 2) | (bytes[i + 1] >> 4));
      outBytes.push(((bytes[i + 1] & 0xF) << 4) | (bytes[i + 2] >> 2));
      outBytes.push(((bytes[i + 2] & 0x3) << 6) | bytes[i + 3]);
    }
    const rem = bytes.length % 4;
    if (rem === 2) {
      outBytes.push((bytes[bytes.length - 2] << 2) | (bytes[bytes.length - 1] >> 4));
    } else if (rem === 3) {
      outBytes.push((bytes[bytes.length - 3] << 2) | (bytes[bytes.length - 2] >> 4));
      outBytes.push(((bytes[bytes.length - 2] & 0xF) << 4) | (bytes[bytes.length - 1] >> 2));
    }
    chunks.push(new Uint8Array(outBytes));
  }

  const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
