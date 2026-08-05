import { hc } from "hono/client";
import type { AppType } from "@fontinass/server/app";
import type {
  ApiHistoryResponse,
  ApiToken,
  ApiTokenApplication,
  ApiTokenApplicationAdmin,
  ApiTokenApplicationList,
  ApiTokenApplicationStatus,
  ApiTokenStats,
  ApiUploadResponse,
  ApiUploadHistoryItem,
  ApiUploadResult,
  ApiUploadStatus,
  ArchiveMetadata,
  ArchivePatch,
  ArchivePreview,
  BrowseFile,
  BrowseResponse,
  DedupResponse,
  DuplicateGroup,
  FontAccessSession,
  FontItem,
  FontListResponse,
  FontStats,
  IndexFontsResponse,
  LogStats,
  MissingFontRanking,
  ProcessingLog,
  ProcessingLogList,
  PublicFontUploadPolicy,
  ScanFontsResponse,
  SharedArchive,
  SubsetOptions,
  UploadResult,
  WhoAmIResponse,
} from "@fontinass/contracts";

export type {
  ApiHistoryResponse,
  ApiToken,
  ApiTokenApplication,
  ApiTokenApplicationAdmin,
  ApiTokenApplicationList,
  ApiTokenApplicationStatus,
  ApiTokenStats,
  ApiUploadResponse,
  ApiUploadHistoryItem,
  ApiUploadResult,
  ApiUploadStatus,
  ArchivePreview,
  BrowseFile,
  BrowseResponse,
  DedupResponse,
  DuplicateGroup,
  FontAccessSession,
  FontItem,
  FontListResponse,
  FontStats,
  IndexFontsResponse,
  LogStats,
  MissingFontRanking,
  ProcessingLog,
  ProcessingLogList,
  PublicFontUploadPolicy,
  ScanFontsResponse,
  SharedArchive,
  UploadResult,
  WhoAmIResponse,
};
export type ScanLocalResult = ScanFontsResponse;
export type IndexFolderResponse = IndexFontsResponse;

const configuredBase = (import.meta as unknown as { env: { VITE_API_BASE_URL?: string } }).env.VITE_API_BASE_URL?.replace(/\/+$/, "") ?? "";
const origin = configuredBase || window.location.origin;
const api = hc<AppType>(origin).api;
const KEY_STORAGE = "fontinass_api_key";
export const API_KEY_CHANGED_EVENT = "fontinass:api-key-changed";

function notifyApiKeyChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(API_KEY_CHANGED_EVENT));
  }
}

export function getApiKey(): string { return localStorage.getItem(KEY_STORAGE) ?? ""; }
export function setApiKey(key: string): void {
  if (key) localStorage.setItem(KEY_STORAGE, key);
  else localStorage.removeItem(KEY_STORAGE);
  notifyApiKeyChanged();
}
export function clearApiKey(): void {
  localStorage.removeItem(KEY_STORAGE);
  notifyApiKeyChanged();
}

function authHeaders(): Record<string, string> {
  const key = getApiKey();
  return key ? { "X-API-Key": key } : {};
}

export async function verifyFontAccess(key = getApiKey()): Promise<FontAccessSession> {
  const normalized = key.trim();
  if (!normalized) throw new Error("Access key is required");
  return json(await fetch(manualUrl("/api/access/whoami"), { headers: { "X-API-Key": normalized } }));
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function manualUrl(path: string): string { return `${configuredBase}${path}`; }

export async function listFonts(page = 1, limit = 50, search = ""): Promise<FontListResponse> {
  return json(await api.fonts.$get({ query: { page, limit, search } }, { headers: authHeaders() }));
}

export async function uploadFonts(files: File[], targetDir?: string, onProgress?: (done: number, total: number) => void): Promise<UploadResult[]> {
  const results: UploadResult[] = [];
  for (let index = 0; index < files.length; index++) {
    const form = new FormData();
    form.append("file", files[index]);
    const response = await fetch(manualUrl("/api/fonts"), { method: "POST", headers: { ...authHeaders(), ...(targetDir ? { "X-Target-Dir": targetDir } : {}) }, body: form });
    if (response.ok) results.push(...(await response.json() as { results: UploadResult[] }).results);
    else results.push({ filename: files[index].name, id: "", faces: 0, error: (await response.json().catch(() => ({})) as { error?: string }).error ?? `HTTP ${response.status}` });
    onProgress?.(index + 1, files.length);
  }
  return results;
}

export async function getPublicFontUploadPolicy(): Promise<PublicFontUploadPolicy> {
  return json(await fetch(manualUrl("/api/upload/policy")));
}

export async function uploadFontsPublic(files: File[]): Promise<ApiUploadResponse> {
  const form = new FormData();
  files.forEach((file) => form.append("file", file));
  const response = await fetch(manualUrl("/api/upload"), { method: "POST", body: form });
  const body = await response.json().catch(() => ({})) as Partial<ApiUploadResponse> & { error?: string };
  if (Array.isArray(body.results) && body.summary) return body as ApiUploadResponse;
  throw new Error(body.error ?? `HTTP ${response.status}`);
}

export async function deleteFont(id: string): Promise<void> {
  await json(await api.fonts[":id"].$delete({ param: { id } }, { headers: authHeaders() }));
}

export async function deleteFontsBatch(ids: string[]): Promise<number> {
  const result = await json<{ deleted: number }>(await api.fonts.$delete({ json: { ids } }, { headers: authHeaders() }));
  return result.deleted;
}

export async function downloadFontFile(id: string): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(manualUrl(`/api/fonts/${encodeURIComponent(id)}/download`), { headers: authHeaders() });
  if (!response.ok) throw new Error(await response.text());
  return { blob: await response.blob(), filename: filenameFromContentDisposition(response.headers.get("content-disposition"), "font") };
}

export async function browseR2(prefix = "", _cursor?: string): Promise<BrowseResponse> {
  return json(await api.fonts.browse.$get({ query: { prefix } }, { headers: authHeaders() }));
}

export async function indexR2Folder(prefix: string, _cursor?: string, batchSize = 20): Promise<IndexFontsResponse> {
  return json(await api.fonts.index.$post({ json: { prefix, batch_size: batchSize } }, { headers: authHeaders() }));
}

export async function indexR2Keys(keys: string[]): Promise<IndexFontsResponse> {
  return json(await api.fonts.index.$post({ json: { keys, batch_size: 100 } }, { headers: authHeaders() }));
}

export async function listR2Keys(prefix: string, cursor?: string, limit = 500): Promise<{ keys: Array<{ key: string; size: number }>; nextCursor: string | null; done: boolean }> {
  return json(await api.fonts.keys.$get({ query: { prefix, cursor: Number(cursor ?? 0), limit } }, { headers: authHeaders() }));
}

export async function getFontStats(): Promise<FontStats> { return json(await api.fonts.stats.$get({}, { headers: authHeaders() })); }
export async function scanLocalFonts(): Promise<ScanFontsResponse> { return json(await api.fonts.scan.$post({}, { headers: authHeaders() })); }
export async function findDuplicateFonts(): Promise<{ groups: DuplicateGroup[]; total: number }> { return json(await api.fonts.duplicates.$get({}, { headers: authHeaders() })); }
export async function dedupFonts(): Promise<DedupResponse> { return json(await api.fonts.deduplicate.$post({}, { headers: authHeaders() })); }

export interface SubsetFileResult { code: number; messages: string[]; data: Uint8Array | null }
export async function subsetFile(file: File, options: Partial<SubsetOptions> & { signal?: AbortSignal } = {}): Promise<SubsetFileResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/octet-stream",
    "X-Filename": base64Encode(file.name),
    "X-Fonts-Check": options.fontsCheck ? "1" : "0",
    "X-Clear-Fonts": options.clearFonts ? "1" : "0",
  };
  if (options.fontNameMode) headers["X-Font-Name-Mode"] = options.fontNameMode;
  if (options.fontAliasSalt) headers["X-Font-Alias-Salt"] = base64Encode(options.fontAliasSalt);
  if (options.srtFormat) headers["X-Srt-Format"] = base64Encode(options.srtFormat);
  if (options.srtStyle) headers["X-Srt-Style"] = base64Encode(options.srtStyle);
  const response = await fetch(manualUrl("/api/subset"), { method: "POST", headers, body: await file.arrayBuffer(), signal: options.signal });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const messageHeader = response.headers.get("x-message") ?? "";
  return { code: Number.parseInt(response.headers.get("x-code") ?? "500", 10), messages: messageHeader ? JSON.parse(base64Decode(messageHeader)) as string[] : [], data: bytes.byteLength ? bytes : null };
}

export async function listSharedArchives(): Promise<SharedArchive[]> { return json(await api.archives.$get()); }
export async function listPendingArchives(): Promise<SharedArchive[]> { return json(await api.archives.pending.$get({}, { headers: authHeaders() })); }

export async function uploadSharedArchive(file: File, metadata: ArchiveMetadata): Promise<{ id: string; download_url: string | null; filename: string; status: string }> {
  const form = new FormData(); form.append("file", file); form.append("metadata", JSON.stringify(metadata));
  return json(await fetch(manualUrl("/api/archives/upload"), { method: "POST", headers: authHeaders(), body: form }));
}

export function contributeArchive(file: File, metadata: ArchiveMetadata, onProgress?: (percent: number) => void): Promise<{ id: string; status: string; message: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const form = new FormData(); form.append("file", file); form.append("metadata", JSON.stringify(metadata));
    const xhr = new XMLHttpRequest(); xhr.open("POST", manualUrl("/api/archives/contribute"));
    xhr.upload.addEventListener("progress", (event) => { if (event.lengthComputable) onProgress?.(Math.round(event.loaded / event.total * 100)); });
    xhr.addEventListener("load", () => xhr.status >= 200 && xhr.status < 300 ? resolvePromise(JSON.parse(xhr.responseText)) : rejectPromise(new Error(parseXhrError(xhr))));
    xhr.addEventListener("error", () => rejectPromise(new Error("Network error")));
    xhr.addEventListener("abort", () => rejectPromise(new Error("Upload aborted")));
    xhr.send(form);
  });
}

export async function approveArchive(id: string): Promise<{ id: string; status: string }> { return json(await api.archives[":id"].approve.$post({ param: { id } }, { headers: authHeaders() })); }
export async function rejectArchive(id: string): Promise<{ id: string; status: string }> { return json(await api.archives[":id"].reject.$post({ param: { id } }, { headers: authHeaders() })); }
export async function deleteArchive(id: string): Promise<void> { await json(await api.archives[":id"].$delete({ param: { id } }, { headers: authHeaders() })); }
export async function editArchive(id: string, patch: ArchivePatch): Promise<SharedArchive> { return json(await api.archives[":id"].$put({ param: { id }, json: patch }, { headers: authHeaders() })); }
export async function previewArchive(id: string): Promise<ArchivePreview> { return json(await api.archives[":id"].preview.$get({ param: { id } }, { headers: authHeaders() })); }
export async function downloadArchiveFile(id: string): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(manualUrl(`/api/archives/${encodeURIComponent(id)}/file`), { headers: authHeaders() });
  if (!response.ok) throw new Error(await response.text());
  return { blob: await response.blob(), filename: filenameFromContentDisposition(response.headers.get("content-disposition"), "archive") };
}

export async function listProcessingLogs(page = 1, limit = 50, search = "", code?: number): Promise<ProcessingLogList> {
  return json(await api.activity.$get({ query: { page, limit, search, ...(code === undefined ? {} : { code }) } }, {}));
}
export async function getMissingFonts(limit = 20, showResolved = false): Promise<MissingFontRanking[]> {
  const result = await json<{ total: number; data: MissingFontRanking[] }>(await api.activity["missing-fonts"].$get({ query: { limit, show_resolved: String(showResolved) as "true" | "false" } }));
  return result.data;
}
export async function resolveMissingFont(fontName: string): Promise<void> { await json(await api.activity["missing-fonts"].resolve.$post({ json: { font_name: fontName } }, { headers: authHeaders() })); }
export async function unresolveMissingFont(fontName: string): Promise<void> { await json(await api.activity["missing-fonts"].unresolve.$post({ json: { font_name: fontName } }, { headers: authHeaders() })); }
export async function getLogStats(): Promise<LogStats> { return json(await api.activity.stats.$get()); }

export async function applyForUploadAccess(input: { applicant_name: string; contact: string; purpose: string; expected_volume?: string }): Promise<{ application: ApiTokenApplication; recovery_secret: string }> {
  return json(await api["token-applications"].$post({ json: input }));
}

export async function getUploadAccessApplication(id: string, secret: string): Promise<ApiTokenApplication> {
  const response = await fetch(manualUrl(`/api/token-applications/${encodeURIComponent(id)}`), {
    headers: { "X-Application-Secret": secret },
  });
  return (await json<{ application: ApiTokenApplication }>(response)).application;
}

export async function claimUploadAccessApplication(id: string, secret: string): Promise<{ application: ApiTokenApplication; token: ApiToken; plaintext: string }> {
  return json(await api["token-applications"][":id"].claim.$post({ param: { id }, json: { secret } }));
}

export async function listUploadAccessApplications(page = 1, limit = 50, status?: ApiTokenApplicationStatus): Promise<ApiTokenApplicationList> {
  return json(await api.tokens.applications.$get({ query: { page, limit, ...(status ? { status } : {}) } }, { headers: authHeaders() }));
}

export async function reviewUploadAccessApplication(id: string, input: { decision: "approve" | "reject"; public_note?: string | null; admin_note?: string | null }): Promise<ApiTokenApplicationAdmin> {
  return (await json<{ application: ApiTokenApplicationAdmin }>(
    await api.tokens.applications[":id"].review.$post({ param: { id }, json: input }, { headers: authHeaders() }),
  )).application;
}

export async function verifyUploadCredential(credential: string): Promise<WhoAmIResponse> {
  return json(await fetch(manualUrl("/api/v1/whoami"), { headers: { Authorization: `Bearer ${credential}` } }));
}

export async function getMyUploadHistory(credential: string, page = 1, limit = 20, status?: ApiUploadStatus): Promise<ApiHistoryResponse> {
  const query = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (status) query.set("status", status);
  return json(await fetch(manualUrl(`/api/v1/history?${query}`), { headers: { Authorization: `Bearer ${credential}` } }));
}

export async function uploadFontsWithCredential(files: File[], credential: string): Promise<ApiUploadResponse> {
  const form = new FormData();
  files.forEach((file) => form.append("file", file));
  const response = await fetch(manualUrl("/api/v1/upload"), {
    method: "POST",
    headers: { Authorization: `Bearer ${credential}` },
    body: form,
  });
  const body = await response.json().catch(() => ({})) as Partial<ApiUploadResponse> & { error?: string };
  if (Array.isArray(body.results) && body.summary) return body as ApiUploadResponse;
  throw new Error(body.error ?? `HTTP ${response.status}`);
}

export async function listApiTokens(): Promise<ApiToken[]> { return (await json<{ data: ApiToken[] }>(await api.tokens.$get({}, { headers: authHeaders() }))).data; }
export async function getApiTokenStats(): Promise<ApiTokenStats> { return json(await api.tokens.stats.$get({}, { headers: authHeaders() })); }
export async function createApiToken(input: { name: string; note?: string }): Promise<{ token: ApiToken; plaintext: string }> { return json(await api.tokens.$post({ json: { ...input, enabled: true } }, { headers: authHeaders() })); }
export async function updateApiToken(id: string, patch: { name?: string; note?: string | null; enabled?: boolean }): Promise<ApiToken> {
  return (await json<{ token: ApiToken }>(await api.tokens[":id"].$patch({ param: { id }, json: patch }, { headers: authHeaders() }))).token;
}
export async function deleteApiToken(id: string): Promise<void> { await json(await api.tokens[":id"].$delete({ param: { id } }, { headers: authHeaders() })); }
export async function getApiTokenHistory(id: string, page = 1, limit = 50, status?: ApiUploadStatus): Promise<ApiHistoryResponse> {
  return json(await api.tokens[":id"].history.$get({ param: { id }, query: { page, limit, ...(status ? { status } : {}) } }, { headers: authHeaders() }));
}
export async function getAllApiHistory(page = 1, limit = 50, status?: ApiUploadStatus): Promise<ApiHistoryResponse> {
  return json(await api.tokens.history.$get({ query: { page, limit, ...(status ? { status } : {}) } }, { headers: authHeaders() }));
}

export function base64Encode(value: string): string { return btoa(unescape(encodeURIComponent(value))); }
export function base64Decode(value: string): string { return new TextDecoder().decode(Uint8Array.from(atob(value), (character) => character.charCodeAt(0))); }

function filenameFromContentDisposition(value: string | null, fallback: string): string {
  if (!value) return fallback;
  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) try { return decodeURIComponent(encoded); } catch { return encoded; }
  return value.match(/filename="([^"]+)"/i)?.[1] ?? value.match(/filename=([^;]+)/i)?.[1]?.trim() ?? fallback;
}

function parseXhrError(xhr: XMLHttpRequest): string {
  try { return (JSON.parse(xhr.responseText) as { error?: string }).error ?? `HTTP ${xhr.status}`; } catch { return `HTTP ${xhr.status}`; }
}
