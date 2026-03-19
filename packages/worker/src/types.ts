// Cloudflare Worker environment bindings
export interface Env {
  FONTS_BUCKET: R2Bucket;
  DB: D1Database;
  CACHE: KVNamespace;
  ASSETS: Fetcher;
  API_KEY: string;
  CORS_ORIGIN: string;
}

// Database row types
export interface FontFileRow {
  id: string;
  filename: string;
  r2_key: string;
  size: number;
  created_at: string;
}

export interface FontInfoRow {
  id: string;
  file_id: string;
  font_index: number;
  weight: number;
  bold: number;
  italic: number;
}

export interface FontNameRow {
  name_lower: string;
  font_info_id: string;
}

// Font lookup result
export interface FontMatch {
  r2_key: string;
  font_index: number;
  weight: number;
  bold: boolean;
  italic: boolean;
}

// ASS analysis result: map from (fontName, weight, italic) to codepoint set
export type FontCharMap = Map<string, Set<number>>;

// Key encoding for FontCharMap
export function makeFontKey(name: string, weight: number, italic: boolean): string {
  return `${name.toLowerCase()}|${weight}|${italic ? 1 : 0}`;
}

export function parseFontKey(key: string): [string, number, boolean] {
  const parts = key.split("|");
  return [parts[0], parseInt(parts[1]), parts[2] === "1"];
}

// Subsetting result for a single font
export interface SubsetResult {
  fontName: string;
  encodedData: string; // uuencoded subset font
  missingGlyphs: string; // characters not found in font
  error: string | null;
}

// API response codes (matching fontInAss convention)
export const CODE = {
  OK: 200,
  WARN: 201, // success with warnings (missing glyphs)
  MISSING_FONT: 300, // fonts not available (strict check)
  CLIENT_ERROR: 400, // bad request
  SERVER_ERROR: 500,
} as const;

export interface SubsetApiResult {
  code: number;
  message: string[] | null;
  data: Uint8Array | null;
}
