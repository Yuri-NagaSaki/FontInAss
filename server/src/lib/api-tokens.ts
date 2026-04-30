/**
 * API upload token management.
 *
 * Tokens look like  fia_<8-char-prefix>_<48-char-secret>
 *   - `prefix` is stored as plaintext for fast indexed lookup
 *   - The full token is hashed with sha256 before storage; the plaintext is
 *     only ever returned to the admin once at creation time
 *
 * Auth: clients send the token in either the `X-Upload-Token` header or
 * `Authorization: Bearer <token>`.
 */

import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { getDb } from "../db.js";
import { log } from "../config.js";

const TOKEN_PREFIX_LEN = 8;
const TOKEN_SECRET_LEN = 48;
const TOKEN_NAMESPACE = "fia";

export interface ApiTokenRow {
  id: string;
  name: string;
  prefix: string;
  token_hash: string;
  enabled: number;
  note: string | null;
  upload_count: number;
  total_bytes: number;
  last_used_at: string | null;
  last_used_ip: string | null;
  created_at: string;
}

export interface ApiTokenView {
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

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function safeHexCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/** Generate a new opaque token. Returned plaintext is shown to admin once. */
function generateToken(): { token: string; prefix: string } {
  const prefix = randomBytes(TOKEN_PREFIX_LEN).toString("base64url").slice(0, TOKEN_PREFIX_LEN);
  const secret = randomBytes(TOKEN_SECRET_LEN).toString("base64url").slice(0, TOKEN_SECRET_LEN);
  return { token: `${TOKEN_NAMESPACE}_${prefix}_${secret}`, prefix };
}

function toView(row: ApiTokenRow): ApiTokenView {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    enabled: !!row.enabled,
    note: row.note,
    upload_count: row.upload_count,
    total_bytes: row.total_bytes,
    last_used_at: row.last_used_at,
    last_used_ip: row.last_used_ip,
    created_at: row.created_at,
  };
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export function listTokens(): ApiTokenView[] {
  const rows = getDb()
    .prepare<ApiTokenRow, []>(
      "SELECT * FROM api_upload_tokens ORDER BY created_at DESC",
    )
    .all();
  return rows.map(toView);
}

export function getTokenById(id: string): ApiTokenView | null {
  const row = getDb()
    .prepare<ApiTokenRow, [string]>("SELECT * FROM api_upload_tokens WHERE id = ?")
    .get(id);
  return row ? toView(row) : null;
}

export function createToken(input: {
  name: string;
  note?: string;
  enabled?: boolean;
}): { token: ApiTokenView; plaintext: string } {
  const id = crypto.randomUUID();
  const { token, prefix } = generateToken();
  const tokenHash = hashToken(token);
  const enabled = input.enabled === false ? 0 : 1;

  getDb()
    .prepare(
      `INSERT INTO api_upload_tokens (id, name, prefix, token_hash, enabled, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.name.trim(), prefix, tokenHash, enabled, input.note?.trim() || null);

  const view = getTokenById(id);
  if (!view) throw new Error("Token created but immediately missing");
  log("info", `[api-tokens] created token ${prefix}… (${input.name})`);
  return { token: view, plaintext: token };
}

export function updateToken(
  id: string,
  patch: { name?: string; note?: string | null; enabled?: boolean },
): ApiTokenView | null {
  const existing = getTokenById(id);
  if (!existing) return null;

  const fields: string[] = [];
  const params: unknown[] = [];

  if (patch.name !== undefined) {
    fields.push("name = ?");
    params.push(patch.name.trim());
  }
  if (patch.note !== undefined) {
    fields.push("note = ?");
    params.push(patch.note === null ? null : patch.note.trim() || null);
  }
  if (patch.enabled !== undefined) {
    fields.push("enabled = ?");
    params.push(patch.enabled ? 1 : 0);
  }

  if (fields.length === 0) return existing;

  params.push(id);
  getDb()
    .prepare(`UPDATE api_upload_tokens SET ${fields.join(", ")} WHERE id = ?`)
    .run(...params);

  return getTokenById(id);
}

export function deleteToken(id: string): boolean {
  const result = getDb()
    .prepare("DELETE FROM api_upload_tokens WHERE id = ?")
    .run(id);
  return (result.changes ?? 0) > 0;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export function extractToken(headerValue: string | null | undefined, bearer?: string | null): string | null {
  if (headerValue && headerValue.trim()) return headerValue.trim();
  if (bearer) {
    const m = bearer.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
  }
  return null;
}

/**
 * Validate a plaintext token. Returns the token row on success, null on failure.
 * Does NOT update last_used_at — caller should call `markTokenUsed` after a
 * successful operation so failed attempts don't bump the counter.
 */
export function verifyToken(plaintext: string): ApiTokenRow | null {
  if (!plaintext) return null;
  // Fixed format: <namespace>_<prefix:TOKEN_PREFIX_LEN>_<secret>
  // Parse by length, NOT by splitting on '_', because base64url alphabet
  // includes '_' (so the prefix and secret can themselves contain underscores).
  const nsPrefix = `${TOKEN_NAMESPACE}_`;
  if (!plaintext.startsWith(nsPrefix)) return null;
  const prefixStart = nsPrefix.length;
  const prefixEnd = prefixStart + TOKEN_PREFIX_LEN;
  if (plaintext.length <= prefixEnd + 1) return null;
  if (plaintext.charAt(prefixEnd) !== "_") return null;
  const prefix = plaintext.slice(prefixStart, prefixEnd);
  const secret = plaintext.slice(prefixEnd + 1);
  if (!prefix || !secret) return null;

  const row = getDb()
    .prepare<ApiTokenRow, [string]>(
      "SELECT * FROM api_upload_tokens WHERE prefix = ?",
    )
    .get(prefix);
  if (!row) return null;
  if (!row.enabled) return null;

  const candidateHash = hashToken(plaintext);
  if (!safeHexCompare(candidateHash, row.token_hash)) return null;

  return row;
}

export function markTokenUsed(id: string, addBytes: number, ip: string | null): void {
  getDb()
    .prepare(
      `UPDATE api_upload_tokens
         SET upload_count = upload_count + 1,
             total_bytes  = total_bytes + ?,
             last_used_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
             last_used_ip = ?
       WHERE id = ?`,
    )
    .run(addBytes, ip, id);
}

// ─── Upload history ───────────────────────────────────────────────────────────

export type UploadHistoryStatus = "success" | "duplicate" | "rejected" | "error";

export interface UploadHistoryRow {
  id: string;
  token_id: string;
  font_file_id: string | null;
  filename: string;
  size: number;
  sha256: string | null;
  status: UploadHistoryStatus;
  error: string | null;
  client_ip: string | null;
  user_agent: string | null;
  uploaded_at: string;
}

export function recordUpload(entry: {
  tokenId: string;
  fontFileId: string | null;
  filename: string;
  size: number;
  sha256: string | null;
  status: UploadHistoryStatus;
  error?: string | null;
  clientIp?: string | null;
  userAgent?: string | null;
}): void {
  getDb()
    .prepare(
      `INSERT INTO api_upload_history
         (id, token_id, font_file_id, filename, size, sha256, status, error, client_ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      crypto.randomUUID(),
      entry.tokenId,
      entry.fontFileId,
      entry.filename,
      entry.size,
      entry.sha256,
      entry.status,
      entry.error ?? null,
      entry.clientIp ?? null,
      entry.userAgent ?? null,
    );
}

export interface HistoryQuery {
  tokenId?: string;
  status?: UploadHistoryStatus;
  page?: number;
  limit?: number;
}

export function listHistory(query: HistoryQuery): {
  total: number;
  page: number;
  limit: number;
  data: UploadHistoryRow[];
} {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(200, Math.max(1, query.limit ?? 50));
  const offset = (page - 1) * limit;

  const where: string[] = [];
  const params: unknown[] = [];
  if (query.tokenId) {
    where.push("token_id = ?");
    params.push(query.tokenId);
  }
  if (query.status) {
    where.push("status = ?");
    params.push(query.status);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const db = getDb();
  const total =
    db
      .prepare<{ cnt: number }, unknown[]>(
        `SELECT COUNT(*) as cnt FROM api_upload_history ${clause}`,
      )
      .get(...params)?.cnt ?? 0;

  const data = db
    .prepare<UploadHistoryRow, unknown[]>(
      `SELECT * FROM api_upload_history ${clause}
         ORDER BY uploaded_at DESC
         LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);

  return { total, page, limit, data };
}

// ─── Aggregate stats ──────────────────────────────────────────────────────────

export interface TokenStats {
  totals: { tokens: number; uploads: number; bytes: number };
  byStatus: Record<UploadHistoryStatus, number>;
}

export function getStats(): TokenStats {
  const db = getDb();
  const tokens = db
    .prepare<{ cnt: number }, []>("SELECT COUNT(*) as cnt FROM api_upload_tokens")
    .get()?.cnt ?? 0;

  const totals = db
    .prepare<{ uploads: number; bytes: number }, []>(
      "SELECT COALESCE(SUM(upload_count),0) as uploads, COALESCE(SUM(total_bytes),0) as bytes FROM api_upload_tokens",
    )
    .get();

  const statusRows = db
    .prepare<{ status: string; cnt: number }, []>(
      "SELECT status, COUNT(*) as cnt FROM api_upload_history GROUP BY status",
    )
    .all();

  const byStatus = { success: 0, duplicate: 0, rejected: 0, error: 0 } as Record<UploadHistoryStatus, number>;
  for (const row of statusRows) {
    if (row.status in byStatus) {
      byStatus[row.status as UploadHistoryStatus] = row.cnt;
    }
  }

  return {
    totals: {
      tokens,
      uploads: totals?.uploads ?? 0,
      bytes: totals?.bytes ?? 0,
    },
    byStatus,
  };
}
