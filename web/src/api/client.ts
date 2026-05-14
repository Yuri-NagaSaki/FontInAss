/**
 * API client for the FontInAss Local backend.
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
  return new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
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

export interface ListKeysResponse {
  keys: { key: string; size: number }[];
  nextCursor: string | null;
  done: boolean;
}

export interface SubsetOptions {
  fontsCheck?: boolean;
  clearFonts?: boolean;
  fontNameMode?: "preserve" | "alias";
  srtFormat?: string;
  srtStyle?: string;
  signal?: AbortSignal;
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
  targetDir?: string,
  onProgress?: (done: number, total: number) => void,
): Promise<UploadResult[]> {
  const results: UploadResult[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const form = new FormData();
    form.append("file", f);
    const extraHeaders: Record<string, string> = {};
    if (targetDir) {
      const dir = targetDir.trim().replace(/\/?$/, "/");
      extraHeaders["X-Target-Dir"] = dir;
    }
    try {
      const res = await fetch(`${BASE}/api/fonts`, {
        method: "POST",
        headers: { ...authHeaders(), ...extraHeaders },
        body: form,
      });
      if (!res.ok) {
        // Parse error body — server may return { error } or { results: [{error}] }
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        const errMsg = (body.error as string) || `Upload failed (HTTP ${res.status})`;
        results.push({ filename: f.name, id: "", faces: 0, error: errMsg });
      } else {
        const json = await res.json() as { results: UploadResult[] };
        results.push(...(json.results ?? []));
      }
    } catch (e) {
      results.push({ filename: f.name, id: "", faces: 0, error: String(e) });
    }
    onProgress?.(i + 1, files.length);
  }
  return results;
}

/**
 * Public font upload — no API key required.
 * Calls POST /api/upload with strict server-side validation.
 */
export async function uploadFontsPublic(
  files: File[],
  onProgress?: (done: number, total: number) => void,
): Promise<UploadResult[]> {
  const results: UploadResult[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const form = new FormData();
    form.append("file", f);
    try {
      const res = await fetch(`${BASE}/api/upload`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        const errMsg = (body.error as string) || `Upload failed (HTTP ${res.status})`;
        results.push({ filename: f.name, id: "", faces: 0, error: errMsg });
      } else {
        const json = await res.json() as { results: UploadResult[] };
        results.push(...(json.results ?? []));
      }
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
  batchSize = 10,
): Promise<IndexFolderResponse> {
  const res = await fetch(`${BASE}/api/fonts/index-folder`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ prefix, cursor, batchSize }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listR2Keys(prefix: string, cursor?: string, limit = 500): Promise<ListKeysResponse> {
  const params = new URLSearchParams({ prefix, limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(`${BASE}/api/fonts/list-keys?${params}`, { headers: authHeaders() });
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

export interface FontStats {
  total: number;
  folders: Array<{ prefix: string; count: number }>;
}

export async function getFontStats(): Promise<FontStats> {
  const res = await fetch(`${BASE}/api/fonts/stats`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─── Local-only: Scan local font directory ─────────────────────────────────────

export interface ScanLocalResult {
  total: number;
  indexed: number;
  skipped: number;
  purged: number;
  errors: string[];
}

export async function scanLocalFonts(): Promise<ScanLocalResult> {
  const res = await fetch(`${BASE}/api/fonts/scan-local`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─── Local-only: Repair stale DB keys (e.g. migrated from R2) ─────────────────

export interface RepairKeysResult {
  total: number;
  ok: number;
  updated: number;
  deleted: number;
}

export async function repairFontKeys(): Promise<RepairKeysResult> {
  const res = await fetch(`${BASE}/api/fonts/repair-keys`, {
    method: "POST",
    headers: authHeaders(),
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
  if (opts.fontNameMode) headers["X-Font-Name-Mode"] = opts.fontNameMode;
  if (opts.srtFormat) headers["X-Srt-Format"] = base64Encode(opts.srtFormat);
  if (opts.srtStyle) headers["X-Srt-Style"] = base64Encode(opts.srtStyle);

  const res = await fetch(`${BASE}/api/subset`, {
    method: "POST",
    headers,
    body: await file.arrayBuffer(),
    signal: opts.signal,
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

// ─── Sharing API ──────────────────────────────────────────────────────────────

export interface SharedArchive {
  id: string;
  name_cn: string;
  letter: string;
  season: string;
  sub_group: string;
  languages: string;       // JSON array string
  subtitle_format: string; // JSON array string
  episode_count: number;
  has_fonts: number;
  filename: string;
  r2_key: string | null;
  file_size: number;
  file_count: number;
  download_url: string | null;
  local_path: string | null;
  status: string;
  contributor: string | null;
  sub_entries: string | null;
  created_at: string;
  updated_at: string;
}

export async function listSharedArchives(): Promise<SharedArchive[]> {
  const res = await fetch(`${BASE}/api/sharing/archives`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listPendingArchives(): Promise<SharedArchive[]> {
  const res = await fetch(`${BASE}/api/sharing/pending`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function uploadSharedArchive(
  file: File,
  metadata: {
    name_cn: string;
    letter: string;
    season: string;
    sub_group: string;
    languages: string[];
    has_fonts: boolean;
  },
): Promise<{ id: string; download_url: string | null; filename: string; status: string }> {
  const form = new FormData();
  form.append("file", file);
  form.append("metadata", JSON.stringify(metadata));
  const res = await fetch(`${BASE}/api/sharing/upload`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error((body.error as string) || `Upload failed (HTTP ${res.status})`);
  }
  return res.json();
}

export function contributeArchive(
  file: File,
  metadata: {
    name_cn: string;
    letter: string;
    season: string;
    sub_group: string;
    languages: string[];
    has_fonts: boolean;
    contributor?: string;
  },
  onProgress?: (percent: number) => void,
): Promise<{ id: string; status: string; message: string }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    form.append("metadata", JSON.stringify(metadata));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}/api/sharing/contribute`);
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch { resolve({ id: "", status: "ok", message: "" }); }
      } else {
        try {
          const body = JSON.parse(xhr.responseText);
          reject(new Error(body.error || `Contribute failed (HTTP ${xhr.status})`));
        } catch {
          reject(new Error(`Contribute failed (HTTP ${xhr.status})`));
        }
      }
    });
    xhr.addEventListener("error", () => reject(new Error("Network error")));
    xhr.addEventListener("abort", () => reject(new Error("Upload aborted")));
    xhr.send(form);
  });
}

export async function approveArchive(id: string): Promise<{ id: string; status: string }> {
  const res = await fetch(`${BASE}/api/sharing/archives/${id}/approve`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function rejectArchive(id: string): Promise<{ id: string; status: string }> {
  const res = await fetch(`${BASE}/api/sharing/archives/${id}/reject`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteArchive(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/sharing/archives/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await res.text());
}

export function importIndexSSE(onMessage: (data: any) => void, onDone: () => void, onError: (err: string) => void): void {
  const key = getApiKey();
  const headers: Record<string, string> = { "X-API-Key": key };

  fetch(`${BASE}/api/sharing/import-index`, {
    method: "POST",
    headers,
  }).then(async (res) => {
    if (!res.ok) {
      onError(`HTTP ${res.status}: ${await res.text()}`);
      return;
    }
    const reader = res.body?.getReader();
    if (!reader) { onError("No response body"); return; }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("data:")) {
          try {
            const data = JSON.parse(line.slice(5).trim());
            onMessage(data);
            if (data.phase === "done" || data.phase === "error") {
              onDone();
              return;
            }
          } catch { /* skip malformed */ }
        }
      }
    }
    onDone();
  }).catch((e) => onError(String(e)));
}

/** Edit archive metadata. */
export async function editArchive(
  id: string,
  data: Partial<{
    name_cn: string;
    letter: string;
    season: string;
    sub_group: string;
    languages: string[];
    has_fonts: boolean;
    episode_count: number;
  }>,
): Promise<SharedArchive> {
  const res = await fetch(`${BASE}/api/sharing/archives/${id}`, {
    method: "PUT",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error((body.error as string) || `Edit failed (HTTP ${res.status})`);
  }
  return res.json();
}

/** Preview archive ZIP contents (file listing). */
export async function previewArchive(id: string): Promise<{
  filename: string;
  totalFiles: number;
  subtitleFiles: number;
  files: { name: string; ext: string; isSubtitle: boolean }[];
}> {
  const res = await fetch(`${BASE}/api/sharing/archives/${id}/preview`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** Download archive file. Returns the file blob. */
export async function downloadArchiveFile(id: string): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(`${BASE}/api/sharing/archives/${id}/download-file`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await res.text());
  const cd = res.headers.get("content-disposition");
  const filename = cd?.match(/filename="?(.+?)"?$/)?.[1] ?? "archive";
  const blob = await res.blob();
  return { blob, filename };
}

/** Upload to an existing anime/season directory. */
export async function uploadToExisting(
  file: File,
  metadata: {
    name_cn: string;
    letter: string;
    season: string;
    sub_group: string;
    languages: string[];
    has_fonts: boolean;
  },
): Promise<{ id: string; status: string; filename: string; download_url?: string }> {
  const form = new FormData();
  form.append("file", file);
  form.append("name_cn", metadata.name_cn);
  form.append("letter", metadata.letter);
  form.append("season", metadata.season);
  form.append("sub_group", metadata.sub_group);
  form.append("languages", JSON.stringify(metadata.languages));
  form.append("has_fonts", String(metadata.has_fonts));
  const res = await fetch(`${BASE}/api/sharing/upload-to-existing`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error((body.error as string) || `Upload failed (HTTP ${res.status})`);
  }
  return res.json();
}

// ─── Font Dedup API ───────────────────────────────────────────────────────────

export interface DuplicateGroup {
  hash: string;
  size: number;
  files: { id: string; r2_key: string; filename: string }[];
}

export async function findDuplicateFonts(): Promise<{ groups: DuplicateGroup[]; total: number }> {
  const res = await fetch(`${BASE}/api/fonts/duplicates`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function dedupFonts(): Promise<{ groups: number; removed: number; freedBytes: number }> {
  const res = await fetch(`${BASE}/api/fonts/dedup`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─── Processing Logs API ──────────────────────────────────────────────────────

export interface ProcessingLog {
  id: string;
  filename: string;
  client_ip: string;
  code: number;
  messages: string | null;
  missing_fonts: string | null;
  font_count: number;
  file_size: number;
  elapsed_ms: number;
  processed_at: string;
}

export interface ProcessingLogList {
  total: number;
  page: number;
  limit: number;
  data: ProcessingLog[];
}

export interface MissingFontRanking {
  font_name: string;
  count: number;
  resolved: boolean;
  resolved_at: string | null;
}

export interface LogStats {
  total: number;
  today: number;
  success: number;
  warnings: number;
  errors: number;
  totalMissingFonts: number;
}

export async function listProcessingLogs(
  page = 1,
  limit = 50,
  search = "",
  code?: number,
): Promise<ProcessingLogList> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (search) params.set("search", search);
  if (code !== undefined) params.set("code", String(code));
  const res = await fetch(`${BASE}/api/logs?${params}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getMissingFonts(limit = 20, showResolved = false): Promise<MissingFontRanking[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (showResolved) params.set("show_resolved", "true");
  const res = await fetch(`${BASE}/api/logs/missing-fonts?${params}`);
  if (!res.ok) throw new Error(await res.text());
  const json = await res.json();
  return json.data ?? json;
}

export async function resolveMissingFont(fontName: string): Promise<void> {
  const res = await fetch(`${BASE}/api/logs/missing-fonts/resolve`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ font_name: fontName }),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function unresolveMissingFont(fontName: string): Promise<void> {
  const res = await fetch(`${BASE}/api/logs/missing-fonts/unresolve`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ font_name: fontName }),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function getLogStats(): Promise<LogStats> {
  const res = await fetch(`${BASE}/api/logs/stats`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
// ─── API Upload Tokens (admin) ────────────────────────────────────────────────

export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  enabled: boolean;
  note: string | null;
  upload_count: number;
  total_bytes: number;
  last_used_at: string | null;
  last_used_ip: string | null;
  created_at: string;
}

export interface ApiTokenStats {
  totals: { tokens: number; uploads: number; bytes: number };
  byStatus: { success: number; duplicate: number; rejected: number; error: number };
}

export type ApiUploadStatus = "success" | "duplicate" | "rejected" | "error";

export interface ApiUploadHistoryItem {
  id: string;
  token_id: string;
  font_file_id: string | null;
  filename: string;
  size: number;
  sha256: string | null;
  status: ApiUploadStatus;
  error: string | null;
  client_ip: string | null;
  user_agent: string | null;
  uploaded_at: string;
}

export interface ApiHistoryResponse {
  total: number;
  page: number;
  limit: number;
  data: ApiUploadHistoryItem[];
  token?: ApiToken;
}

export async function listApiTokens(): Promise<ApiToken[]> {
  const res = await fetch(`${BASE}/api/api-tokens`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  const json = await res.json() as { data: ApiToken[] };
  return json.data ?? [];
}

export async function getApiTokenStats(): Promise<ApiTokenStats> {
  const res = await fetch(`${BASE}/api/api-tokens/stats`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createApiToken(input: { name: string; note?: string }): Promise<{ token: ApiToken; plaintext: string }> {
  const res = await fetch(`${BASE}/api/api-tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error((body.error as string) || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function updateApiToken(
  id: string,
  patch: { name?: string; note?: string | null; enabled?: boolean },
): Promise<ApiToken> {
  const res = await fetch(`${BASE}/api/api-tokens/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await res.text());
  const json = await res.json() as { token: ApiToken };
  return json.token;
}

export async function deleteApiToken(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/api-tokens/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function getApiTokenHistory(
  id: string,
  page = 1,
  limit = 50,
  status?: ApiUploadStatus,
): Promise<ApiHistoryResponse> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (status) params.set("status", status);
  const res = await fetch(`${BASE}/api/api-tokens/${id}/history?${params}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getAllApiHistory(
  page = 1,
  limit = 50,
  status?: ApiUploadStatus,
): Promise<ApiHistoryResponse> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (status) params.set("status", status);
  const res = await fetch(`${BASE}/api/api-tokens/history?${params}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
