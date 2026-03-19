/**
 * API client for the FontInAss Worker backend.
 */

const BASE = (import.meta as unknown as { env: { VITE_API_BASE_URL?: string } }).env.VITE_API_BASE_URL || "";

// ─── API Key management ───────────────────────────────────────────────────────

const KEY_STORAGE = "fontinass_api_key";

export function getApiKey(): string {
  return localStorage.getItem(KEY_STORAGE) ?? "";
}

export function setApiKey(key: string): void {
  if (key) {
    localStorage.setItem(KEY_STORAGE, key);
  } else {
    localStorage.removeItem(KEY_STORAGE);
  }
}

export function clearApiKey(): void {
  localStorage.removeItem(KEY_STORAGE);
}

function authHeaders(): Record<string, string> {
  const key = getApiKey();
  return key ? { "X-API-Key": key } : {};
}

function base64Encode(str: string): string {
  return btoa(unescape(encodeURIComponent(str)));
}

function base64Decode(b64: string): string {
  return decodeURIComponent(escape(atob(b64)));
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FontItem {
  id: string;
  filename: string;
  size: number;
  created_at: string;
  names: string;
  weight: number;
  bold: number;
  italic: number;
}

export interface FontListResponse {
  total: number;
  page: number;
  limit: number;
  data: FontItem[];
}

export interface UploadResult {
  filename: string;
  id: string;
  faces: number;
  error?: string;
}

export interface BrowseFile {
  key: string;
  name: string;
  size: number;
  indexed: boolean;
}

export interface BrowseResponse {
  folders: string[];
  files: BrowseFile[];
  cursor: string | null;
  done: boolean;
}

export interface IndexFolderResponse {
  indexed: number;
  skipped: number;
  errors: string[];
  nextCursor: string | null;
  done: boolean;
}

export interface SubsetOptions {
  fontsCheck?: boolean;
  clearFonts?: boolean;
  srtFormat?: string;
  srtStyle?: string;
}

export interface SubsetFileResult {
  code: number;
  messages: string[];
  data: Uint8Array | null;
}

// ─── Fonts API ────────────────────────────────────────────────────────────────

export async function listFonts(page = 1, limit = 50, search = ""): Promise<FontListResponse> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (search) params.set("search", search);
  const res = await fetch(`${BASE}/api/fonts?${params}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/**
 * Upload fonts sequentially (one per POST) to avoid CF Workers 100 MB body limit.
 * `onProgress(done, total)` is called after each successful/failed upload.
 */
export async function uploadFonts(
  files: File[],
  onProgress?: (done: number, total: number) => void,
): Promise<UploadResult[]> {
  const results: UploadResult[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const form = new FormData();
    form.append("file", f);
    try {
      const res = await fetch(`${BASE}/api/fonts`, {
        method: "POST",
        headers: authHeaders(),
        body: form,
      });
      const json = await res.json() as { results: UploadResult[] };
      results.push(...(json.results ?? []));
    } catch (e) {
      results.push({ filename: f.name, id: "", faces: 0, error: String(e) });
    }
    onProgress?.(i + 1, files.length);
  }
  return results;
}

export async function deleteFont(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/fonts/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function deleteFontsBatch(ids: string[]): Promise<number> {
  const res = await fetch(`${BASE}/api/fonts`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ ids }),
  });
  const json = await res.json() as { deleted: number };
  return json.deleted ?? 0;
}

export async function browseR2(prefix = "", cursor?: string): Promise<BrowseResponse> {
  const params = new URLSearchParams({ prefix });
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(`${BASE}/api/fonts/browse?${params}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function indexR2Folder(
  prefix: string,
  cursor?: string,
  batchSize = 5,
): Promise<IndexFolderResponse> {
  const res = await fetch(`${BASE}/api/fonts/index-folder`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ prefix, cursor, batchSize }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function indexR2Keys(r2Keys: string[]): Promise<IndexFolderResponse> {
  const res = await fetch(`${BASE}/api/fonts/index-folder`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ r2Keys }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─── Subset API (public, no auth) ─────────────────────────────────────────────

export async function subsetFile(file: File, opts: SubsetOptions = {}): Promise<SubsetFileResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/octet-stream",
    "X-Filename": base64Encode(file.name),
    "X-Fonts-Check": opts.fontsCheck ? "1" : "0",
    "X-Clear-Fonts": opts.clearFonts ? "1" : "0",
  };
  if (opts.srtFormat) headers["X-Srt-Format"] = base64Encode(opts.srtFormat);
  if (opts.srtStyle) headers["X-Srt-Style"] = base64Encode(opts.srtStyle);

  const res = await fetch(`${BASE}/api/subset`, {
    method: "POST",
    headers,
    body: await file.arrayBuffer(),
  });

  const code = parseInt(res.headers.get("x-code") ?? "500", 10);
  const msgHeader = res.headers.get("x-message") ?? "";
  let messages: string[] = [];
  if (msgHeader) {
    try {
      const decoded = base64Decode(msgHeader);
      const parsed = JSON.parse(decoded);
      messages = Array.isArray(parsed) ? parsed : [String(parsed)];
    } catch {
      messages = [msgHeader];
    }
  }

  const arrayBuffer = await res.arrayBuffer();
  const data = arrayBuffer.byteLength > 0 ? new Uint8Array(arrayBuffer) : null;

  return { code, messages, data };
}

export { base64Encode, base64Decode };

