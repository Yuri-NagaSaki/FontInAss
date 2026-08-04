import type {
  AccessReceipt,
  ApiUploadResponse,
  ApiUploadResult,
  ArchiveMetadata,
  ArchivePatch,
  ArchivePreview,
  BrowseFile,
  BrowseResponse,
  DedupResponse,
  DuplicateGroup,
  FontItem,
  FontListResponse,
  FontStats,
  IndexFontsResponse,
  LogStats,
  MissingFontRanking,
  ProcessingLog,
  ProcessingLogList,
  ProgrammaticCredential,
  ProgrammaticCredentialCreated,
  ProgrammaticCredentialScope,
  PublicFontUploadPolicy,
  ScanFontsResponse,
  SharedArchive,
  SubsetOptions,
  UploadResult,
  WorkspaceArchive,
  WorkspaceArchiveMetadata,
  WorkspaceSessionResponse,
} from "@fontinass/contracts";

export type {
  AccessReceipt,
  ApiUploadResponse,
  ApiUploadResult,
  ArchivePreview,
  BrowseFile,
  BrowseResponse,
  DedupResponse,
  DuplicateGroup,
  FontItem,
  FontListResponse,
  FontStats,
  IndexFontsResponse,
  LogStats,
  MissingFontRanking,
  ProcessingLog,
  ProcessingLogList,
  ProgrammaticCredential,
  ProgrammaticCredentialCreated,
  ProgrammaticCredentialScope,
  PublicFontUploadPolicy,
  ScanFontsResponse,
  SharedArchive,
  UploadResult,
  WorkspaceArchive,
  WorkspaceArchiveMetadata,
  WorkspaceSessionResponse,
};
export type ScanLocalResult = ScanFontsResponse;
export type IndexFolderResponse = IndexFontsResponse;

const configuredBase = (
  import.meta as unknown as { env: { VITE_API_BASE_URL?: string } }
).env.VITE_API_BASE_URL?.replace(/\/+$/, "") ?? "";
let cachedSession: WorkspaceSessionResponse | null = null;

function url(path: string): string {
  return `${configuredBase}${path}`;
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as {
      error?: string;
      retryable?: boolean;
    };
    const error = new Error(body.error ?? `HTTP ${response.status}`);
    Object.assign(error, { status: response.status, retryable: body.retryable });
    throw error;
  }
  return response.json() as Promise<T>;
}

function csrfHeaders(): Record<string, string> {
  if (!cachedSession?.authenticated) throw new Error("unauthenticated");
  return { "X-CSRF-Token": cachedSession.csrfToken };
}

function sessionFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url(path), { ...init, credentials: "same-origin" });
}

export async function fetchWorkspaceSession(): Promise<WorkspaceSessionResponse> {
  cachedSession = await json<WorkspaceSessionResponse>(
    await sessionFetch("/api/auth/session", { cache: "no-store" }),
  );
  return cachedSession;
}

export function loginWithAniBT(returnTo = "/workspace"): void {
  window.location.assign(
    url(`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`),
  );
}

export async function logoutWorkspace(global = false): Promise<void> {
  const result = await json<{ ok: true; logoutUrl: string | null }>(
    await sessionFetch("/api/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify({ global }),
    }),
  );
  cachedSession = { authenticated: false };
  if (result.logoutUrl) window.location.assign(result.logoutUrl);
}

export async function listWorkspaceFonts(
  organizationId: string,
  page = 1,
  limit = 50,
  search = "",
): Promise<FontListResponse> {
  const query = new URLSearchParams({
    organizationId,
    page: String(page),
    limit: String(limit),
    search,
  });
  return json(
    await sessionFetch(`/api/workspace/fonts?${query}`, { cache: "no-store" }),
  );
}

export async function uploadWorkspaceFonts(
  organizationId: string,
  files: File[],
): Promise<ApiUploadResponse> {
  const form = new FormData();
  files.forEach((file) => form.append("file", file));
  return json(
    await sessionFetch("/api/workspace/fonts", {
      method: "POST",
      headers: { ...csrfHeaders(), "X-Organization-ID": organizationId },
      body: form,
    }),
  );
}

export async function downloadWorkspaceFont(
  organizationId: string,
  id: string,
): Promise<{ blob: Blob; filename: string }> {
  const response = await sessionFetch(
    `/api/workspace/fonts/${encodeURIComponent(id)}/download`,
    { headers: { "X-Organization-ID": organizationId }, cache: "no-store" },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return {
    blob: await response.blob(),
    filename: filenameFromContentDisposition(
      response.headers.get("content-disposition"),
      "font",
    ),
  };
}

export async function listWorkspaceArchives(
  organizationId: string,
): Promise<WorkspaceArchive[]> {
  return json(
    await sessionFetch(
      `/api/workspace/archives?organizationId=${encodeURIComponent(organizationId)}`,
      { cache: "no-store" },
    ),
  );
}

export async function uploadWorkspaceArchive(
  organizationId: string,
  file: File,
  metadata: WorkspaceArchiveMetadata,
): Promise<WorkspaceArchive> {
  const form = new FormData();
  form.append("organizationId", organizationId);
  form.append("file", file);
  form.append("metadata", JSON.stringify(metadata));
  return json(
    await sessionFetch("/api/workspace/archives", {
      method: "POST",
      headers: csrfHeaders(),
      body: form,
    }),
  );
}

export async function downloadWorkspaceArchiveSource(
  organizationId: string,
  id: string,
): Promise<{ blob: Blob; filename: string }> {
  const response = await sessionFetch(
    `/api/workspace/archives/${encodeURIComponent(id)}/source`,
    { headers: { "X-Organization-ID": organizationId }, cache: "no-store" },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return {
    blob: await response.blob(),
    filename: filenameFromContentDisposition(
      response.headers.get("content-disposition"),
      "subtitles.zip",
    ),
  };
}

export async function listProgrammaticCredentials(): Promise<
  ProgrammaticCredential[]
> {
  return (
    await json<{ data: ProgrammaticCredential[] }>(
      await sessionFetch("/api/workspace/credentials", { cache: "no-store" }),
    )
  ).data;
}

export async function listProgrammaticCredentialActivity(
  limit = 100,
): Promise<AccessReceipt[]> {
  return (
    await json<{ data: AccessReceipt[] }>(
      await sessionFetch(`/api/workspace/credentials/activity?limit=${limit}`, {
        cache: "no-store",
      }),
    )
  ).data;
}

export async function createProgrammaticCredential(input: {
  organizationId: string;
  name: string;
  scopes: ProgrammaticCredentialScope[];
  expiresAt?: string | null;
  confirmation: string;
}): Promise<ProgrammaticCredentialCreated> {
  return json(
    await sessionFetch("/api/workspace/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify(input),
    }),
  );
}

export async function revokeProgrammaticCredential(
  id: string,
): Promise<ProgrammaticCredential> {
  return (
    await json<{ credential: ProgrammaticCredential }>(
      await sessionFetch(
        `/api/workspace/credentials/${encodeURIComponent(id)}`,
        { method: "DELETE", headers: csrfHeaders() },
      ),
    )
  ).credential;
}

export async function listAdminCredentials(): Promise<ProgrammaticCredential[]> {
  return (
    await json<{ data: ProgrammaticCredential[] }>(
      await sessionFetch("/api/admin/credentials", { cache: "no-store" }),
    )
  ).data;
}

export async function revokeAdminCredential(id: string): Promise<void> {
  await json(
    await sessionFetch(`/api/admin/credentials/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: csrfHeaders(),
    }),
  );
}

export async function listAccessReceipts(limit = 100): Promise<AccessReceipt[]> {
  return (
    await json<{ data: AccessReceipt[] }>(
      await sessionFetch(`/api/admin/receipts?limit=${limit}`, {
        cache: "no-store",
      }),
    )
  ).data;
}

export async function listFonts(
  page = 1,
  limit = 50,
  search = "",
): Promise<FontListResponse> {
  const query = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    search,
  });
  return json(await sessionFetch(`/api/admin/fonts?${query}`));
}

export async function uploadFonts(
  files: File[],
  targetDir?: string,
  onProgress?: (done: number, total: number) => void,
): Promise<UploadResult[]> {
  const results: UploadResult[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const form = new FormData();
    form.append("file", files[index]);
    const response = await sessionFetch("/api/admin/fonts", {
      method: "POST",
      headers: {
        ...csrfHeaders(),
        ...(targetDir ? { "X-Target-Dir": targetDir } : {}),
      },
      body: form,
    });
    if (response.ok) {
      results.push(...(await response.json() as { results: UploadResult[] }).results);
    } else {
      const body = await response.json().catch(() => ({})) as { error?: string };
      results.push({
        filename: files[index].name,
        id: "",
        faces: 0,
        error: body.error ?? `HTTP ${response.status}`,
      });
    }
    onProgress?.(index + 1, files.length);
  }
  return results;
}

export async function deleteFont(id: string): Promise<void> {
  await json(
    await sessionFetch(`/api/admin/fonts/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: csrfHeaders(),
    }),
  );
}

export async function deleteFontsBatch(ids: string[]): Promise<number> {
  return (
    await json<{ deleted: number }>(
      await sessionFetch("/api/admin/fonts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ ids }),
      }),
    )
  ).deleted;
}

export async function downloadFontFile(
  id: string,
): Promise<{ blob: Blob; filename: string }> {
  const response = await sessionFetch(
    `/api/admin/fonts/${encodeURIComponent(id)}/download`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return {
    blob: await response.blob(),
    filename: filenameFromContentDisposition(
      response.headers.get("content-disposition"),
      "font",
    ),
  };
}

export async function browseR2(prefix = ""): Promise<BrowseResponse> {
  return json(
    await sessionFetch(`/api/admin/fonts/browse?prefix=${encodeURIComponent(prefix)}`),
  );
}

export async function indexR2Folder(
  prefix: string,
  _cursor?: string,
  batchSize = 20,
): Promise<IndexFontsResponse> {
  return json(
    await sessionFetch("/api/admin/fonts/index", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify({ prefix, batch_size: batchSize }),
    }),
  );
}

export async function indexR2Keys(keys: string[]): Promise<IndexFontsResponse> {
  return json(
    await sessionFetch("/api/admin/fonts/index", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify({ keys, batch_size: 100 }),
    }),
  );
}

export async function listR2Keys(
  prefix: string,
  cursor?: string,
  limit = 500,
): Promise<{
  keys: Array<{ key: string; size: number }>;
  nextCursor: string | null;
  done: boolean;
}> {
  const query = new URLSearchParams({
    prefix,
    cursor: cursor ?? "0",
    limit: String(limit),
  });
  const result = await json<{
    keys: Array<{ key: string; size: number }>;
    done: boolean;
  }>(await sessionFetch(`/api/admin/fonts/keys?${query}`));
  return { ...result, nextCursor: null };
}

export async function getFontStats(): Promise<FontStats> {
  return json(await sessionFetch("/api/admin/fonts/stats"));
}
export async function scanLocalFonts(): Promise<ScanFontsResponse> {
  return json(
    await sessionFetch("/api/admin/fonts/scan", {
      method: "POST",
      headers: csrfHeaders(),
    }),
  );
}
export async function findDuplicateFonts(): Promise<{
  groups: DuplicateGroup[];
  total: number;
}> {
  return json(await sessionFetch("/api/admin/fonts/duplicates"));
}
export async function dedupFonts(): Promise<DedupResponse> {
  return json(
    await sessionFetch("/api/admin/fonts/deduplicate", {
      method: "POST",
      headers: csrfHeaders(),
    }),
  );
}

export interface SubsetFileResult {
  code: number;
  messages: string[];
  data: Uint8Array | null;
}
export async function subsetFile(
  file: File,
  options: Partial<SubsetOptions> & { signal?: AbortSignal } = {},
): Promise<SubsetFileResult> {
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
  const response = await fetch(url("/api/subset"), {
    method: "POST",
    headers,
    body: await file.arrayBuffer(),
    signal: options.signal,
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const messageHeader = response.headers.get("x-message") ?? "";
  return {
    code: Number.parseInt(response.headers.get("x-code") ?? "500", 10),
    messages: messageHeader
      ? JSON.parse(base64Decode(messageHeader)) as string[]
      : [],
    data: bytes.byteLength ? bytes : null,
  };
}

export async function getPublicFontUploadPolicy(): Promise<PublicFontUploadPolicy> {
  return json(await fetch(url("/api/upload/policy")));
}

export async function uploadFontsPublic(files: File[]): Promise<ApiUploadResponse> {
  const form = new FormData();
  files.forEach((file) => form.append("file", file));
  return json(await fetch(url("/api/upload"), { method: "POST", body: form }));
}

export async function listSharedArchives(): Promise<SharedArchive[]> {
  return json(await fetch(url("/api/archives")));
}

export function contributeArchive(
  file: File,
  metadata: ArchiveMetadata,
  onProgress?: (percent: number) => void,
): Promise<{ id: string; status: string; message: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const form = new FormData();
    form.append("file", file);
    form.append("metadata", JSON.stringify(metadata));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url("/api/archives/contribute"));
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    });
    xhr.addEventListener("load", () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolvePromise(JSON.parse(xhr.responseText))
        : rejectPromise(new Error(parseXhrError(xhr))),
    );
    xhr.addEventListener("error", () => rejectPromise(new Error("Network error")));
    xhr.addEventListener("abort", () => rejectPromise(new Error("Upload aborted")));
    xhr.send(form);
  });
}

export async function listPendingArchives(): Promise<SharedArchive[]> {
  return json(await sessionFetch("/api/admin/archives/pending"));
}
export async function uploadSharedArchive(
  file: File,
  metadata: ArchiveMetadata,
): Promise<SharedArchive> {
  const form = new FormData();
  form.append("file", file);
  form.append("metadata", JSON.stringify(metadata));
  return json(
    await sessionFetch("/api/admin/archives/upload", {
      method: "POST",
      headers: csrfHeaders(),
      body: form,
    }),
  );
}
export async function approveArchive(id: string): Promise<SharedArchive> {
  return json(
    await sessionFetch(`/api/admin/archives/${encodeURIComponent(id)}/approve`, {
      method: "POST",
      headers: csrfHeaders(),
    }),
  );
}
export async function rejectArchive(id: string): Promise<SharedArchive> {
  return json(
    await sessionFetch(`/api/admin/archives/${encodeURIComponent(id)}/reject`, {
      method: "POST",
      headers: csrfHeaders(),
    }),
  );
}
export async function deleteArchive(id: string): Promise<void> {
  await json(
    await sessionFetch(`/api/admin/archives/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: csrfHeaders(),
    }),
  );
}
export async function editArchive(
  id: string,
  patch: ArchivePatch,
): Promise<SharedArchive> {
  return json(
    await sessionFetch(`/api/admin/archives/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify(patch),
    }),
  );
}
export async function previewArchive(id: string): Promise<ArchivePreview> {
  return json(
    await sessionFetch(`/api/admin/archives/${encodeURIComponent(id)}/preview`),
  );
}
export async function downloadArchiveFile(
  id: string,
): Promise<{ blob: Blob; filename: string }> {
  const response = await sessionFetch(
    `/api/admin/archives/${encodeURIComponent(id)}/source`,
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return {
    blob: await response.blob(),
    filename: filenameFromContentDisposition(
      response.headers.get("content-disposition"),
      "archive",
    ),
  };
}

export async function listProcessingLogs(
  page = 1,
  limit = 50,
  search = "",
  code?: number,
): Promise<ProcessingLogList> {
  const query = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    search,
  });
  if (code !== undefined) query.set("code", String(code));
  return json(await sessionFetch(`/api/admin/activity?${query}`));
}
export async function getMissingFonts(
  limit = 20,
  showResolved = false,
): Promise<MissingFontRanking[]> {
  return (
    await json<{ data: MissingFontRanking[] }>(
      await sessionFetch(
        `/api/admin/activity/missing-fonts?limit=${limit}&show_resolved=${showResolved}`,
      ),
    )
  ).data;
}
export async function resolveMissingFont(fontName: string): Promise<void> {
  await json(
    await sessionFetch("/api/admin/activity/missing-fonts/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify({ font_name: fontName }),
    }),
  );
}
export async function unresolveMissingFont(fontName: string): Promise<void> {
  await json(
    await sessionFetch("/api/admin/activity/missing-fonts/unresolve", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify({ font_name: fontName }),
    }),
  );
}
export async function getLogStats(): Promise<LogStats> {
  return json(await sessionFetch("/api/admin/activity/stats"));
}

export function base64Encode(value: string): string {
  return btoa(unescape(encodeURIComponent(value)));
}
export function base64Decode(value: string): string {
  return new TextDecoder().decode(
    Uint8Array.from(atob(value), (character) => character.charCodeAt(0)),
  );
}

function filenameFromContentDisposition(
  value: string | null,
  fallback: string,
): string {
  if (!value) return fallback;
  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
  return (
    value.match(/filename="([^"]+)"/i)?.[1] ??
    value.match(/filename=([^;]+)/i)?.[1]?.trim() ??
    fallback
  );
}

function parseXhrError(xhr: XMLHttpRequest): string {
  try {
    return (JSON.parse(xhr.responseText) as { error?: string }).error ??
      `HTTP ${xhr.status}`;
  } catch {
    return `HTTP ${xhr.status}`;
  }
}
