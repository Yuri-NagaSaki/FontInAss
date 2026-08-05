import { Database, type SQLQueryBindings } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  FontCatalogRepository,
  FontFaceMetadata,
  FontFileRecord,
  FontLookupRow,
} from "@fontinass/font-catalog";
import type { ArchiveRecord, ArchiveRepository } from "@fontinass/archive-library";
import type {
  LoginTransactionRecord,
  ProgrammaticCredentialRecord,
  WebSessionRecord,
  WorkspaceAccessRepository,
} from "@fontinass/access-control";
import type { ActivityRepository, ProcessingEventInput } from "@fontinass/activity-log";
import type {
  AccessReceipt,
  OidcWorkspaceIdentity,
  LogStats,
  MissingFontRanking,
  ProcessingLogList,
} from "@fontinass/contracts";

const SCHEMA = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
PRAGMA synchronous=NORMAL;

CREATE TABLE IF NOT EXISTS font_files (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  size INTEGER NOT NULL CHECK(size >= 0),
  sha256 TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
DROP INDEX IF EXISTS idx_font_files_sha256;
CREATE INDEX IF NOT EXISTS idx_font_files_sha256 ON font_files(sha256) WHERE sha256 IS NOT NULL;

CREATE TABLE IF NOT EXISTS font_faces (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES font_files(id) ON DELETE CASCADE,
  face_index INTEGER NOT NULL,
  weight INTEGER NOT NULL,
  bold INTEGER NOT NULL CHECK(bold IN (0,1)),
  italic INTEGER NOT NULL CHECK(italic IN (0,1)),
  UNIQUE(file_id, face_index)
);
CREATE INDEX IF NOT EXISTS idx_font_faces_file ON font_faces(file_id);

CREATE TABLE IF NOT EXISTS font_names (
  name_lower TEXT NOT NULL,
  face_id TEXT NOT NULL REFERENCES font_faces(id) ON DELETE CASCADE,
  PRIMARY KEY(name_lower, face_id)
);
CREATE INDEX IF NOT EXISTS idx_font_names_lower ON font_names(name_lower);

CREATE TABLE IF NOT EXISTS archives (
  id TEXT PRIMARY KEY,
  name_cn TEXT NOT NULL,
  letter TEXT NOT NULL,
  season TEXT NOT NULL,
  sub_group TEXT NOT NULL,
  languages_json TEXT NOT NULL DEFAULT '[]',
  subtitle_formats_json TEXT NOT NULL DEFAULT '[]',
  episode_count INTEGER NOT NULL DEFAULT 0,
  has_fonts INTEGER NOT NULL DEFAULT 0 CHECK(has_fonts IN (0,1)),
  filename TEXT NOT NULL,
  storage_key TEXT UNIQUE,
  file_size INTEGER NOT NULL DEFAULT 0,
  file_count INTEGER NOT NULL DEFAULT 0,
  pending_path TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending','published','rejected','expired')),
  contributor TEXT,
  sub_entries_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  ,organization_id TEXT
  ,organization_name TEXT
  ,uploader_fingerprint TEXT
  ,actor_kind TEXT CHECK(actor_kind IS NULL OR actor_kind IN ('session','credential','operator','legacy'))
  ,actor_id_fingerprint TEXT
);
CREATE INDEX IF NOT EXISTS idx_archives_status_sort ON archives(status, letter, name_cn, season);

CREATE TABLE IF NOT EXISTS upload_rate_limits (
  ip_hash TEXT NOT NULL,
  upload_date TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(ip_hash, upload_date)
);

CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  application_id TEXT UNIQUE,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  note TEXT,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK(request_count >= 0),
  accepted_file_count INTEGER NOT NULL DEFAULT 0 CHECK(accepted_file_count >= 0),
  accepted_bytes INTEGER NOT NULL DEFAULT 0 CHECK(accepted_bytes >= 0),
  last_used_at TEXT,
  last_used_ip TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  revoked_at TEXT,
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS api_token_applications (
  id TEXT PRIMARY KEY,
  applicant_name TEXT NOT NULL,
  contact TEXT NOT NULL,
  purpose TEXT NOT NULL,
  expected_volume TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','claimed')),
  credential_prefix TEXT NOT NULL UNIQUE,
  credential_hash TEXT NOT NULL,
  public_note TEXT,
  admin_note TEXT,
  request_ip_hash TEXT NOT NULL,
  token_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reviewed_at TEXT,
  claimed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_token_applications_status_time ON api_token_applications(status, created_at DESC);

CREATE TABLE IF NOT EXISTS api_application_rate_limits (
  ip_hash TEXT NOT NULL,
  application_date TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(ip_hash, application_date)
);

CREATE TABLE IF NOT EXISTS api_token_rate_limits (
  token_id TEXT NOT NULL,
  minute_bucket TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(token_id, minute_bucket)
);

CREATE TABLE IF NOT EXISTS public_font_upload_rate_limits (
  ip_hash TEXT NOT NULL,
  minute_bucket TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(ip_hash, minute_bucket)
);

CREATE TABLE IF NOT EXISTS api_upload_history (
  id TEXT PRIMARY KEY,
  token_id TEXT NOT NULL REFERENCES api_tokens(id) ON DELETE CASCADE,
  font_file_id TEXT,
  filename TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT,
  status TEXT NOT NULL CHECK(status IN ('success','duplicate','rejected','error')),
  error TEXT,
  client_ip TEXT,
  user_agent TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_upload_history_token_time ON api_upload_history(token_id, uploaded_at DESC);

CREATE TABLE IF NOT EXISTS processing_events (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  client_ip TEXT,
  code INTEGER NOT NULL,
  messages_json TEXT NOT NULL DEFAULT '[]',
  missing_fonts_json TEXT NOT NULL DEFAULT '[]',
  font_count INTEGER NOT NULL DEFAULT 0,
  file_size INTEGER NOT NULL DEFAULT 0,
  elapsed_ms INTEGER NOT NULL DEFAULT 0,
  processed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_processing_events_time ON processing_events(processed_at DESC);
CREATE INDEX IF NOT EXISTS idx_processing_events_code ON processing_events(code);

CREATE TABLE IF NOT EXISTS resolved_fonts (
  font_name TEXT PRIMARY KEY,
  resolved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS oidc_identities (
  user_id TEXT PRIMARY KEY,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  display_name TEXT NOT NULL,
  picture TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE(issuer, subject)
);

CREATE TABLE IF NOT EXISTS oidc_login_transactions (
  id TEXT PRIMARY KEY,
  state_fingerprint TEXT NOT NULL UNIQUE,
  sealed_payload TEXT NOT NULL,
  return_to TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_oidc_login_transactions_expiry ON oidc_login_transactions(expires_at);

CREATE TABLE IF NOT EXISTS web_sessions (
  id TEXT PRIMARY KEY,
  token_fingerprint TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES oidc_identities(user_id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  picture TEXT,
  csrf_fingerprint TEXT NOT NULL,
  sealed_id_token TEXT,
  authenticated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  idle_expires_at TEXT NOT NULL,
  absolute_expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_web_sessions_user_active ON web_sessions(user_id, revoked_at, idle_expires_at);

CREATE TABLE IF NOT EXISTS programmatic_credentials (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES oidc_identities(user_id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL,
  organization_name TEXT NOT NULL,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL UNIQUE,
  suffix TEXT NOT NULL,
  credential_fingerprint TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK(generation >= 1),
  created_at TEXT NOT NULL,
  authorized_at TEXT NOT NULL,
  last_used_at TEXT,
  expires_at TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_programmatic_credentials_owner_time ON programmatic_credentials(owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_programmatic_credentials_org_time ON programmatic_credentials(organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS credential_creation_rate_limits (
  owner_fingerprint TEXT NOT NULL,
  hour_bucket TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(owner_fingerprint, hour_bucket)
);

CREATE TABLE IF NOT EXISTS access_receipts (
  id TEXT PRIMARY KEY,
  actor_kind TEXT NOT NULL CHECK(actor_kind IN ('session','credential','operator','legacy')),
  actor_fingerprint TEXT NOT NULL,
  organization_id TEXT,
  capability TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK(resource_type IN ('font','archive','credential','session','system')),
  resource_fingerprint TEXT,
  outcome TEXT NOT NULL CHECK(outcome IN ('allowed','denied','completed','revoked')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_access_receipts_time ON access_receipts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_receipts_org_time ON access_receipts(organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS font_upload_receipts (
  id TEXT PRIMARY KEY,
  credential_id TEXT REFERENCES programmatic_credentials(id) ON DELETE SET NULL,
  legacy_token_id TEXT,
  actor_kind TEXT NOT NULL CHECK(actor_kind IN ('session','credential','operator','legacy')),
  actor_fingerprint TEXT NOT NULL,
  organization_id TEXT,
  font_file_id TEXT,
  filename TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT,
  status TEXT NOT NULL CHECK(status IN ('success','duplicate','rejected','error')),
  error TEXT,
  client_ip_fingerprint TEXT,
  user_agent TEXT,
  uploaded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_font_upload_receipts_credential_time ON font_upload_receipts(credential_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_font_upload_receipts_org_time ON font_upload_receipts(organization_id, uploaded_at DESC);
`;

const POST_MIGRATION_SCHEMA = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_tokens_application
  ON api_tokens(application_id)
  WHERE application_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_archives_organization_time
  ON archives(organization_id, created_at DESC);
`;

const SCHEMA_VERSION = 3;

function migrate(database: Database): void {
  const current = database.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0;
  if (current >= SCHEMA_VERSION) return;

  database.transaction(() => {
    if (current < 2) {
      addColumn(database, "api_tokens", "application_id", "TEXT");
      addColumn(database, "api_tokens", "request_count", "INTEGER NOT NULL DEFAULT 0");
      addColumn(database, "api_tokens", "accepted_file_count", "INTEGER NOT NULL DEFAULT 0");
      addColumn(database, "api_tokens", "accepted_bytes", "INTEGER NOT NULL DEFAULT 0");
      addColumn(database, "api_tokens", "revoked_at", "TEXT");
      addColumn(database, "api_tokens", "expires_at", "TEXT");

      if (columnExists(database, "api_tokens", "upload_count")) {
        database.run("UPDATE api_tokens SET request_count = upload_count WHERE request_count = 0");
      }
      if (columnExists(database, "api_tokens", "total_bytes")) {
        database.run("UPDATE api_tokens SET accepted_bytes = total_bytes WHERE accepted_bytes = 0");
      }
      database.run(`
        UPDATE api_tokens SET accepted_file_count = (
          SELECT COUNT(*) FROM api_upload_history h
          WHERE h.token_id = api_tokens.id AND h.status IN ('success','duplicate')
        ) WHERE accepted_file_count = 0
      `);
      database.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_api_tokens_application ON api_tokens(application_id) WHERE application_id IS NOT NULL");
    }

    if (current < 3) {
      addColumn(database, "api_tokens", "application_id", "TEXT");
      addColumn(database, "api_tokens", "request_count", "INTEGER NOT NULL DEFAULT 0");
      addColumn(database, "api_tokens", "accepted_file_count", "INTEGER NOT NULL DEFAULT 0");
      addColumn(database, "api_tokens", "accepted_bytes", "INTEGER NOT NULL DEFAULT 0");
      addColumn(database, "api_tokens", "revoked_at", "TEXT");
      addColumn(database, "api_tokens", "expires_at", "TEXT");
      if (columnExists(database, "api_tokens", "upload_count")) {
        database.run("UPDATE api_tokens SET request_count = upload_count WHERE request_count = 0");
      }
      if (columnExists(database, "api_tokens", "total_bytes")) {
        database.run("UPDATE api_tokens SET accepted_bytes = total_bytes WHERE accepted_bytes = 0");
      }
      database.run(`
        UPDATE api_tokens SET accepted_file_count = (
          SELECT COUNT(*) FROM api_upload_history h
          WHERE h.token_id = api_tokens.id AND h.status IN ('success','duplicate')
        ) WHERE accepted_file_count = 0
      `);
      addColumn(database, "archives", "organization_id", "TEXT");
      addColumn(database, "archives", "organization_name", "TEXT");
      addColumn(database, "archives", "uploader_fingerprint", "TEXT");
      addColumn(database, "archives", "actor_kind", "TEXT");
      addColumn(database, "archives", "actor_id_fingerprint", "TEXT");
      database.run("CREATE INDEX IF NOT EXISTS idx_archives_organization_time ON archives(organization_id, created_at DESC)");

      const revokedAt = new Date().toISOString();
      database.query(
        "UPDATE api_tokens SET enabled = 0, revoked_at = COALESCE(revoked_at, ?) WHERE enabled = 1 OR revoked_at IS NULL",
      ).run(revokedAt);
      database.run(`
        INSERT OR IGNORE INTO font_upload_receipts (
          id, legacy_token_id, actor_kind, actor_fingerprint, organization_id,
          font_file_id, filename, size, sha256, status, error,
          client_ip_fingerprint, user_agent, uploaded_at
        )
        SELECT
          id, token_id, 'legacy', substr(token_id, 1, 16), NULL,
          font_file_id, filename, size, sha256, status, error,
          client_ip, user_agent, uploaded_at
        FROM api_upload_history
      `);
    }
    database.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  })();
}

function columnExists(database: Database, table: string, column: string): boolean {
  return database.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all().some((entry) => entry.name === column);
}

function addColumn(database: Database, table: string, column: string, definition: string): void {
  if (!columnExists(database, table, column)) database.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export class SqliteDatabase {
  readonly raw: Database;

  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.raw = new Database(path, { create: true });
    this.raw.run(SCHEMA);
    migrate(this.raw);
    this.raw.run(POST_MIGRATION_SCHEMA);
  }

  ping(): void {
    this.raw.query("SELECT 1").get();
  }

  close(): void {
    this.raw.close();
  }
}

type LoginTransactionRow = {
  id: string;
  state_fingerprint: string;
  sealed_payload: string;
  return_to: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
};

type WebSessionRow = {
  id: string;
  token_fingerprint: string;
  user_id: string;
  display_name: string;
  picture: string | null;
  csrf_fingerprint: string;
  sealed_id_token: string | null;
  authenticated_at: string;
  created_at: string;
  last_seen_at: string;
  idle_expires_at: string;
  absolute_expires_at: string;
  revoked_at: string | null;
};

type ProgrammaticCredentialRow = {
  id: string;
  owner_user_id: string;
  organization_id: string;
  organization_name: string;
  name: string;
  prefix: string;
  suffix: string;
  credential_fingerprint: string;
  scopes_json: string;
  generation: number;
  created_at: string;
  authorized_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
};

type AccessReceiptRow = {
  id: string;
  actor_kind: AccessReceipt["actorKind"];
  actor_fingerprint: string;
  organization_id: string | null;
  capability: AccessReceipt["capability"];
  resource_type: AccessReceipt["resourceType"];
  resource_fingerprint: string | null;
  outcome: AccessReceipt["outcome"];
  created_at: string;
};

function toLoginTransaction(row: LoginTransactionRow): LoginTransactionRecord {
  return {
    id: row.id,
    stateFingerprint: row.state_fingerprint,
    sealedPayload: row.sealed_payload,
    returnTo: row.return_to,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
  };
}

function toWebSession(row: WebSessionRow): WebSessionRecord {
  return {
    id: row.id,
    tokenFingerprint: row.token_fingerprint,
    userId: row.user_id,
    displayName: row.display_name,
    picture: row.picture,
    csrfFingerprint: row.csrf_fingerprint,
    sealedIdToken: row.sealed_id_token,
    authenticatedAt: row.authenticated_at,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    idleExpiresAt: row.idle_expires_at,
    absoluteExpiresAt: row.absolute_expires_at,
    revokedAt: row.revoked_at,
  };
}

function parseScopes(value: string): ProgrammaticCredentialRecord["scopes"] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (scope): scope is ProgrammaticCredentialRecord["scopes"][number] =>
        scope === "fonts.read" ||
        scope === "fonts.write" ||
        scope === "subtitles.read" ||
        scope === "subtitles.write",
    );
  } catch {
    return [];
  }
}

function toProgrammaticCredential(
  row: ProgrammaticCredentialRow,
): ProgrammaticCredentialRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    name: row.name,
    prefix: row.prefix,
    suffix: row.suffix,
    credentialFingerprint: row.credential_fingerprint,
    scopes: parseScopes(row.scopes_json),
    generation: row.generation,
    createdAt: row.created_at,
    authorizedAt: row.authorized_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

function toAccessReceipt(row: AccessReceiptRow): AccessReceipt {
  return {
    id: row.id,
    actorKind: row.actor_kind,
    actorFingerprint: row.actor_fingerprint,
    organizationId: row.organization_id,
    capability: row.capability,
    resourceType: row.resource_type,
    resourceFingerprint: row.resource_fingerprint,
    outcome: row.outcome,
    createdAt: row.created_at,
  };
}

export class SqliteWorkspaceAccessRepository
  implements WorkspaceAccessRepository
{
  constructor(private readonly database: SqliteDatabase) {}

  insertLoginTransaction(record: LoginTransactionRecord): void {
    this.database.raw.query(`
      INSERT INTO oidc_login_transactions (
        id, state_fingerprint, sealed_payload, return_to,
        created_at, expires_at, consumed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.stateFingerprint,
      record.sealedPayload,
      record.returnTo,
      record.createdAt,
      record.expiresAt,
      record.consumedAt,
    );
  }

  consumeLoginTransaction(
    stateFingerprint: string,
    now: string,
  ): LoginTransactionRecord | null {
    return this.database.raw.transaction(() => {
      const row = this.database.raw.query<LoginTransactionRow, [string, string]>(`
        SELECT * FROM oidc_login_transactions
        WHERE state_fingerprint = ? AND consumed_at IS NULL AND expires_at > ?
      `).get(stateFingerprint, now);
      if (!row) return null;
      const result = this.database.raw.query(`
        UPDATE oidc_login_transactions SET consumed_at = ?
        WHERE id = ? AND consumed_at IS NULL
      `).run(now, row.id);
      return result.changes === 1
        ? toLoginTransaction({ ...row, consumed_at: now })
        : null;
    })();
  }

  upsertIdentity(identity: OidcWorkspaceIdentity, now: string): void {
    this.database.raw.query(`
      INSERT INTO oidc_identities (
        user_id, issuer, subject, display_name, picture, first_seen_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        issuer = excluded.issuer,
        subject = excluded.subject,
        display_name = excluded.display_name,
        picture = excluded.picture,
        last_seen_at = excluded.last_seen_at
    `).run(
      identity.userId,
      identity.issuer,
      identity.subject,
      identity.displayName,
      identity.picture,
      now,
      now,
    );
  }

  insertSession(record: WebSessionRecord): void {
    this.database.raw.query(`
      INSERT INTO web_sessions (
        id, token_fingerprint, user_id, display_name, picture,
        csrf_fingerprint, sealed_id_token, authenticated_at, created_at,
        last_seen_at, idle_expires_at, absolute_expires_at, revoked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.tokenFingerprint,
      record.userId,
      record.displayName,
      record.picture,
      record.csrfFingerprint,
      record.sealedIdToken,
      record.authenticatedAt,
      record.createdAt,
      record.lastSeenAt,
      record.idleExpiresAt,
      record.absoluteExpiresAt,
      record.revokedAt,
    );
  }

  findSessionById(id: string): WebSessionRecord | null {
    const row = this.database.raw
      .query<WebSessionRow, [string]>("SELECT * FROM web_sessions WHERE id = ?")
      .get(id);
    return row ? toWebSession(row) : null;
  }

  findSessionByFingerprint(fingerprint: string): WebSessionRecord | null {
    const row = this.database.raw.query<WebSessionRow, [string]>(`
      SELECT * FROM web_sessions WHERE token_fingerprint = ?
    `).get(fingerprint);
    return row ? toWebSession(row) : null;
  }

  touchSession(id: string, lastSeenAt: string, idleExpiresAt: string): void {
    this.database.raw.query(`
      UPDATE web_sessions SET last_seen_at = ?, idle_expires_at = ?
      WHERE id = ? AND revoked_at IS NULL
    `).run(lastSeenAt, idleExpiresAt, id);
  }

  revokeSession(id: string, revokedAt: string): void {
    this.database.raw.query(`
      UPDATE web_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?
    `).run(revokedAt, id);
  }

  revokeSessionsByUser(userId: string, revokedAt: string): number {
    return Number(this.database.raw.query(`
      UPDATE web_sessions SET revoked_at = ?
      WHERE user_id = ? AND revoked_at IS NULL
    `).run(revokedAt, userId).changes);
  }

  findCredentialByPrefix(prefix: string): ProgrammaticCredentialRecord | null {
    const row = this.database.raw.query<ProgrammaticCredentialRow, [string]>(`
      SELECT * FROM programmatic_credentials WHERE prefix = ?
    `).get(prefix);
    return row ? toProgrammaticCredential(row) : null;
  }

  insertCredential(record: ProgrammaticCredentialRecord): void {
    this.database.raw.query(`
      INSERT INTO programmatic_credentials (
        id, owner_user_id, organization_id, organization_name, name,
        prefix, suffix, credential_fingerprint, scopes_json, generation,
        created_at, authorized_at, last_used_at, expires_at, revoked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.ownerUserId,
      record.organizationId,
      record.organizationName,
      record.name,
      record.prefix,
      record.suffix,
      record.credentialFingerprint,
      JSON.stringify(record.scopes),
      record.generation,
      record.createdAt,
      record.authorizedAt,
      record.lastUsedAt,
      record.expiresAt,
      record.revokedAt,
    );
  }

  listCredentialsByOwner(userId: string): ProgrammaticCredentialRecord[] {
    return this.database.raw.query<ProgrammaticCredentialRow, [string]>(`
      SELECT * FROM programmatic_credentials
      WHERE owner_user_id = ? ORDER BY created_at DESC
    `).all(userId).map(toProgrammaticCredential);
  }

  listCredentials(): ProgrammaticCredentialRecord[] {
    return this.database.raw.query<ProgrammaticCredentialRow, []>(`
      SELECT * FROM programmatic_credentials ORDER BY created_at DESC
    `).all().map(toProgrammaticCredential);
  }

  countActiveCredentials(
    userId: string,
    organizationId: string,
    now: string,
  ): { user: number; organization: number } {
    const user = this.database.raw.query<{ count: number }, [string, string]>(`
      SELECT COUNT(*) AS count FROM programmatic_credentials
      WHERE owner_user_id = ? AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
    `).get(userId, now)?.count ?? 0;
    const organization = this.database.raw.query<
      { count: number },
      [string, string]
    >(`
      SELECT COUNT(*) AS count FROM programmatic_credentials
      WHERE organization_id = ? AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
    `).get(organizationId, now)?.count ?? 0;
    return { user, organization };
  }

  consumeCredentialCreationRateLimit(
    ownerFingerprint: string,
    hourBucket: string,
    limit: number,
  ): boolean {
    return this.database.raw.transaction(() => {
      const current = this.database.raw
        .query<{ count: number }, [string, string]>(`
          SELECT count FROM credential_creation_rate_limits
          WHERE owner_fingerprint = ? AND hour_bucket = ?
        `)
        .get(ownerFingerprint, hourBucket)?.count ?? 0;
      if (current >= limit) return false;
      this.database.raw.query(`
        INSERT INTO credential_creation_rate_limits (
          owner_fingerprint, hour_bucket, count
        ) VALUES (?, ?, 1)
        ON CONFLICT(owner_fingerprint, hour_bucket)
        DO UPDATE SET count = count + 1
      `).run(ownerFingerprint, hourBucket);
      return true;
    })();
  }

  revokeCredential(
    id: string,
    revokedAt: string,
  ): ProgrammaticCredentialRecord | null {
    this.database.raw.query(`
      UPDATE programmatic_credentials
      SET revoked_at = COALESCE(revoked_at, ?)
      WHERE id = ?
    `).run(revokedAt, id);
    const row = this.database.raw.query<ProgrammaticCredentialRow, [string]>(`
      SELECT * FROM programmatic_credentials WHERE id = ?
    `).get(id);
    return row ? toProgrammaticCredential(row) : null;
  }

  touchCredential(id: string, lastUsedAt: string): void {
    this.database.raw.query(`
      UPDATE programmatic_credentials SET last_used_at = ?
      WHERE id = ? AND revoked_at IS NULL
    `).run(lastUsedAt, id);
  }

  insertAccessReceipt(receipt: AccessReceipt): void {
    this.database.raw.query(`
      INSERT INTO access_receipts (
        id, actor_kind, actor_fingerprint, organization_id, capability,
        resource_type, resource_fingerprint, outcome, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      receipt.id,
      receipt.actorKind,
      receipt.actorFingerprint,
      receipt.organizationId,
      receipt.capability,
      receipt.resourceType,
      receipt.resourceFingerprint,
      receipt.outcome,
      receipt.createdAt,
    );
  }

  listAccessReceipts(limit: number): AccessReceipt[] {
    return this.database.raw.query<AccessReceiptRow, [number]>(`
      SELECT * FROM access_receipts ORDER BY created_at DESC LIMIT ?
    `).all(limit).map(toAccessReceipt);
  }

  listAccessReceiptsForActors(
    actorFingerprints: string[],
    limit: number,
  ): AccessReceipt[] {
    if (actorFingerprints.length === 0) return [];
    const placeholders = actorFingerprints.map(() => "?").join(", ");
    return this.database.raw
      .query<AccessReceiptRow, SQLQueryBindings[]>(`
        SELECT * FROM access_receipts
        WHERE actor_fingerprint IN (${placeholders})
        ORDER BY created_at DESC LIMIT ?
      `)
      .all(...actorFingerprints, limit)
      .map(toAccessReceipt);
  }
}

export class SqlitePublicUploadRateLimitRepository {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly requestsPerMinute: number,
  ) {}

  consumePublicUploadRateLimit(ipHash: string): boolean {
    const minute = new Date().toISOString().slice(0, 16);
    return this.database.raw.transaction(() => {
      const current = this.database.raw
        .query<{ count: number }, [string, string]>(`
          SELECT count FROM public_font_upload_rate_limits
          WHERE ip_hash = ? AND minute_bucket = ?
        `)
        .get(ipHash, minute)?.count ?? 0;
      if (current >= this.requestsPerMinute) return false;
      this.database.raw.query(`
        INSERT INTO public_font_upload_rate_limits (ip_hash, minute_bucket, count)
        VALUES (?, ?, 1)
        ON CONFLICT(ip_hash, minute_bucket) DO UPDATE SET count = count + 1
      `).run(ipHash, minute);
      return true;
    })();
  }
}

interface FontFileRow {
  id: string;
  filename: string;
  storage_key: string;
  size: number;
  sha256: string | null;
  created_at: string;
}

interface LookupRow {
  name_lower: string;
  face_index: number;
  weight: number;
  bold: number;
  italic: number;
  storage_key: string;
  size: number;
}

function toRecord(row: FontFileRow): FontFileRecord {
  return { id: row.id, filename: row.filename, key: row.storage_key, size: row.size, sha256: row.sha256, createdAt: row.created_at };
}

function toLookup(row: LookupRow): FontLookupRow {
  return {
    nameLower: row.name_lower,
    fontIndex: row.face_index,
    weight: row.weight,
    bold: row.bold === 1,
    italic: row.italic === 1,
    key: row.storage_key,
    size: row.size ?? 0,
  };
}

function chunks<T>(items: T[], size = 500): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(",");
}

export class SqliteFontCatalogRepository implements FontCatalogRepository {
  constructor(private readonly database: SqliteDatabase) {}

  lookupByNames(names: string[]): FontLookupRow[] {
    const rows: LookupRow[] = [];
    for (const part of chunks(names)) {
      if (!part.length) continue;
      rows.push(...this.database.raw.query<LookupRow, string[]>(`
        SELECT n.name_lower, f.face_index, f.weight, f.bold, f.italic, ff.storage_key, ff.size
        FROM font_names n JOIN font_faces f ON f.id = n.face_id JOIN font_files ff ON ff.id = f.file_id
        WHERE n.name_lower IN (${placeholders(part.length)})
      `).all(...part));
    }
    return rows.map(toLookup);
  }

  lookupByLooseNames(normalizedNames: string[]): FontLookupRow[] {
    const rows: LookupRow[] = [];
    const expression = "lower(replace(replace(replace(n.name_lower, ' ', ''), '-', ''), '_', ''))";
    for (const part of chunks([...new Set(normalizedNames)], 200)) {
      if (!part.length) continue;
      rows.push(...this.database.raw.query<LookupRow, string[]>(`
        SELECT ${expression} AS name_lower, f.face_index, f.weight, f.bold, f.italic, ff.storage_key, ff.size
        FROM font_names n JOIN font_faces f ON f.id = n.face_id JOIN font_files ff ON ff.id = f.file_id
        WHERE ${expression} IN (${placeholders(part.length)})
      `).all(...part));
    }
    return rows.map(toLookup);
  }

  findExistingKeys(keys: string[]): Set<string> {
    const found = new Set<string>();
    for (const part of chunks(keys)) {
      if (!part.length) continue;
      const rows = this.database.raw.query<{ storage_key: string }, string[]>(
        `SELECT storage_key FROM font_files WHERE storage_key IN (${placeholders(part.length)})`,
      ).all(...part);
      for (const row of rows) found.add(row.storage_key);
    }
    return found;
  }

  insertFile(file: Omit<FontFileRecord, "createdAt">, faces: FontFaceMetadata[]): void {
    this.database.raw.transaction(() => {
      this.database.raw.query("INSERT INTO font_files (id, filename, storage_key, size, sha256) VALUES (?, ?, ?, ?, ?)")
        .run(file.id, file.filename, file.key, file.size, file.sha256);
      this.insertFaces(file.id, faces);
    })();
  }

  replaceFaces(fileId: string, faces: FontFaceMetadata[]): void {
    this.database.raw.transaction(() => {
      this.database.raw.query("DELETE FROM font_faces WHERE file_id = ?").run(fileId);
      this.insertFaces(fileId, faces);
    })();
  }

  private insertFaces(fileId: string, faces: FontFaceMetadata[]): void {
    const faceStatement = this.database.raw.query("INSERT INTO font_faces (id, file_id, face_index, weight, bold, italic) VALUES (?, ?, ?, ?, ?, ?)");
    const nameStatement = this.database.raw.query("INSERT OR IGNORE INTO font_names (name_lower, face_id) VALUES (?, ?)");
    for (const face of faces) {
      const faceId = crypto.randomUUID();
      faceStatement.run(faceId, fileId, face.index, face.weight, Number(face.bold), Number(face.italic));
      for (const name of new Set(face.familyNames.map((value) => value.trim().toLowerCase()).filter(Boolean))) nameStatement.run(name, faceId);
    }
  }

  listBrokenFiles(): FontFileRecord[] {
    return this.database.raw.query<FontFileRow, []>(`
      SELECT ff.* FROM font_files ff WHERE NOT EXISTS (
        SELECT 1 FROM font_faces f JOIN font_names n ON n.face_id = f.id WHERE f.file_id = ff.id
      )
    `).all().map(toRecord);
  }

  listFileEntries(): FontFileRecord[] {
    return this.database.raw.query<FontFileRow, []>("SELECT * FROM font_files ORDER BY created_at, id").all().map(toRecord);
  }

  listFiles(query: { page: number; limit: number; search: string }) {
    const offset = (query.page - 1) * query.limit;
    const pattern = `%${query.search.toLowerCase()}%`;
    const where = query.search ? "WHERE lower(ff.filename) LIKE ? OR n.name_lower LIKE ?" : "";
    const parameters: SQLQueryBindings[] = query.search ? [pattern, pattern] : [];
    const total = this.database.raw.query<{ count: number }, SQLQueryBindings[]>(`
      SELECT COUNT(DISTINCT ff.id) AS count FROM font_files ff
      LEFT JOIN font_faces f ON f.file_id = ff.id LEFT JOIN font_names n ON n.face_id = f.id ${where}
    `).get(...parameters)?.count ?? 0;
    const rows = this.database.raw.query<{
      id: string; filename: string; size: number; created_at: string; names_json: string; weight: number | null; bold: number | null; italic: number | null;
    }, SQLQueryBindings[]>(`
      SELECT ff.id, ff.filename, ff.size, ff.created_at,
        json_group_array(DISTINCT n.name_lower) AS names_json,
        COALESCE(MIN(f.weight), 400) AS weight, COALESCE(MAX(f.bold), 0) AS bold, COALESCE(MAX(f.italic), 0) AS italic
      FROM font_files ff LEFT JOIN font_faces f ON f.file_id = ff.id LEFT JOIN font_names n ON n.face_id = f.id
      ${where} GROUP BY ff.id ORDER BY ff.created_at DESC LIMIT ? OFFSET ?
    `).all(...parameters, query.limit, offset);
    return {
      total, page: query.page, limit: query.limit,
      data: rows.map((row) => ({
        id: row.id, filename: row.filename, size: row.size, created_at: row.created_at,
        names: (JSON.parse(row.names_json) as Array<string | null>).filter((name): name is string => Boolean(name)),
        weight: row.weight ?? 400, bold: row.bold === 1, italic: row.italic === 1,
      })),
    };
  }

  countByTopFolder(): Array<{ prefix: string; count: number }> {
    return this.database.raw.query<{ prefix: string; count: number }, []>(`
      SELECT CASE WHEN instr(storage_key, '/') > 0 THEN substr(storage_key, 1, instr(storage_key, '/')) ELSE '(root)/' END AS prefix,
      COUNT(*) AS count FROM font_files GROUP BY prefix
    `).all();
  }

  findById(id: string): FontFileRecord | null {
    const row = this.database.raw.query<FontFileRow, [string]>("SELECT * FROM font_files WHERE id = ?").get(id);
    return row ? toRecord(row) : null;
  }

  findByKey(key: string): FontFileRecord | null {
    const row = this.database.raw.query<FontFileRow, [string]>("SELECT * FROM font_files WHERE storage_key = ?").get(key);
    return row ? toRecord(row) : null;
  }

  findBySha256(sha256: string): (FontFileRecord & { faces: number }) | null {
    const row = this.database.raw.query<FontFileRow & { faces: number }, [string]>(`
      SELECT ff.*, (SELECT COUNT(*) FROM font_faces f WHERE f.file_id = ff.id) AS faces FROM font_files ff WHERE sha256 = ? LIMIT 1
    `).get(sha256);
    return row ? { ...toRecord(row), faces: row.faces } : null;
  }

  setSha256(id: string, sha256: string): void {
    this.database.raw.query("UPDATE font_files SET sha256 = ? WHERE id = ?").run(sha256, id);
  }

  deleteByIds(ids: string[]): FontFileRecord[] {
    if (!ids.length) return [];
    const deleted: FontFileRecord[] = [];
    this.database.raw.transaction(() => {
      for (const part of chunks(ids)) {
        const rows = this.database.raw.query<FontFileRow, string[]>(`SELECT * FROM font_files WHERE id IN (${placeholders(part.length)})`).all(...part);
        deleted.push(...rows.map(toRecord));
        this.database.raw.query(`DELETE FROM font_files WHERE id IN (${placeholders(part.length)})`).run(...part);
      }
    })();
    return deleted;
  }
}

interface ArchiveRow {
  id: string;
  name_cn: string;
  letter: string;
  season: string;
  sub_group: string;
  languages_json: string;
  subtitle_formats_json: string;
  episode_count: number;
  has_fonts: number;
  filename: string;
  storage_key: string | null;
  file_size: number;
  file_count: number;
  pending_path: string | null;
  status: ArchiveRecord["status"];
  contributor: string | null;
  sub_entries_json: string;
  created_at: string;
  updated_at: string;
  organization_id: string | null;
  organization_name: string | null;
  uploader_fingerprint: string | null;
  actor_kind: ArchiveRecord["actor_kind"];
  actor_id_fingerprint: string | null;
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function toArchiveRecord(row: ArchiveRow): ArchiveRecord {
  return {
    id: row.id,
    name_cn: row.name_cn,
    letter: row.letter,
    season: row.season,
    sub_group: row.sub_group,
    languages: parseStringArray(row.languages_json),
    subtitle_formats: parseStringArray(row.subtitle_formats_json),
    episode_count: row.episode_count,
    has_fonts: row.has_fonts === 1,
    filename: row.filename,
    r2_key: row.storage_key,
    file_size: row.file_size,
    file_count: row.file_count,
    download_url: null,
    pending_path: row.pending_path,
    status: row.status,
    contributor: row.contributor,
    sub_entries: parseStringArray(row.sub_entries_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
    organization_id: row.organization_id,
    organization_name: row.organization_name,
    uploader_fingerprint: row.uploader_fingerprint,
    actor_kind: row.actor_kind,
    actor_id_fingerprint: row.actor_id_fingerprint,
  };
}

export class SqliteArchiveRepository implements ArchiveRepository {
  constructor(private readonly database: SqliteDatabase) {}

  listPublished(): ArchiveRecord[] {
    return this.database.raw.query<ArchiveRow, []>("SELECT * FROM archives WHERE status = 'published' ORDER BY letter, name_cn, season, filename").all().map(toArchiveRecord);
  }

  listPending(): ArchiveRecord[] {
    return this.database.raw.query<ArchiveRow, []>("SELECT * FROM archives WHERE status = 'pending' ORDER BY created_at DESC").all().map(toArchiveRecord);
  }

  listByOrganization(organizationId: string): ArchiveRecord[] {
    return this.database.raw.query<ArchiveRow, [string]>(`
      SELECT * FROM archives
      WHERE organization_id = ?
      ORDER BY created_at DESC
    `).all(organizationId).map(toArchiveRecord);
  }

  findById(id: string): ArchiveRecord | null {
    const row = this.database.raw.query<ArchiveRow, [string]>("SELECT * FROM archives WHERE id = ?").get(id);
    return row ? toArchiveRecord(row) : null;
  }

  findByStorageKey(key: string): ArchiveRecord | null {
    const row = this.database.raw.query<ArchiveRow, [string]>("SELECT * FROM archives WHERE storage_key = ?").get(key);
    return row ? toArchiveRecord(row) : null;
  }

  insert(record: ArchiveRecord): void {
    this.database.raw.query(`
      INSERT INTO archives (
        id, name_cn, letter, season, sub_group, languages_json, subtitle_formats_json,
        episode_count, has_fonts, filename, storage_key, file_size, file_count,
        pending_path, status, contributor, sub_entries_json, created_at, updated_at,
        organization_id, organization_name, uploader_fingerprint, actor_kind,
        actor_id_fingerprint
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id, record.name_cn, record.letter, record.season, record.sub_group,
      JSON.stringify(record.languages), JSON.stringify(record.subtitle_formats), record.episode_count,
      Number(record.has_fonts), record.filename, record.r2_key, record.file_size, record.file_count,
      record.pending_path, record.status, record.contributor, JSON.stringify(record.sub_entries),
      record.created_at, record.updated_at,
      record.organization_id, record.organization_name,
      record.uploader_fingerprint, record.actor_kind,
      record.actor_id_fingerprint,
    );
  }

  update(id: string, patch: Partial<ArchiveRecord>): ArchiveRecord | null {
    const columns: Array<[keyof ArchiveRecord, string, (value: ArchiveRecord[keyof ArchiveRecord] | undefined) => SQLQueryBindings]> = [
      ["name_cn", "name_cn", identity], ["letter", "letter", identity], ["season", "season", identity],
      ["sub_group", "sub_group", identity], ["languages", "languages_json", (value) => JSON.stringify(value)],
      ["subtitle_formats", "subtitle_formats_json", JSON.stringify], ["episode_count", "episode_count", identity],
      ["has_fonts", "has_fonts", (value) => Number(value)], ["filename", "filename", identity],
      ["r2_key", "storage_key", identity], ["file_size", "file_size", identity], ["file_count", "file_count", identity],
      ["pending_path", "pending_path", identity], ["status", "status", identity], ["contributor", "contributor", identity],
      ["sub_entries", "sub_entries_json", (value) => JSON.stringify(value)], ["updated_at", "updated_at", identity],
      ["organization_id", "organization_id", identity], ["organization_name", "organization_name", identity],
      ["uploader_fingerprint", "uploader_fingerprint", identity], ["actor_kind", "actor_kind", identity],
      ["actor_id_fingerprint", "actor_id_fingerprint", identity],
    ];
    const assignments: string[] = [];
    const values: SQLQueryBindings[] = [];
    for (const [key, column, encode] of columns) {
      if (!(key in patch)) continue;
      assignments.push(`${column} = ?`);
      values.push(encode(patch[key]));
    }
    if (!assignments.length) return this.findById(id);
    this.database.raw.query(`UPDATE archives SET ${assignments.join(", ")} WHERE id = ?`).run(...values, id);
    return this.findById(id);
  }

  delete(id: string): ArchiveRecord | null {
    const record = this.findById(id);
    if (!record) return null;
    this.database.raw.query("DELETE FROM archives WHERE id = ?").run(id);
    return record;
  }

  replacePublished(records: ArchiveRecord[]): void {
    this.database.raw.transaction(() => {
      this.database.raw.query("DELETE FROM archives WHERE status = 'published'").run();
      for (const record of records) this.insert(record);
    })();
  }

  consumeRateLimit(ipHash: string, date: string, limit: number): boolean {
    return this.database.raw.transaction(() => {
      const current = this.database.raw.query<{ count: number }, [string, string]>(
        "SELECT count FROM upload_rate_limits WHERE ip_hash = ? AND upload_date = ?",
      ).get(ipHash, date)?.count ?? 0;
      if (current >= limit) return false;
      this.database.raw.query(`
        INSERT INTO upload_rate_limits (ip_hash, upload_date, count) VALUES (?, ?, 1)
        ON CONFLICT(ip_hash, upload_date) DO UPDATE SET count = count + 1
      `).run(ipHash, date);
      return true;
    })();
  }

  expirePending(before: string): ArchiveRecord[] {
    const records = this.database.raw.query<ArchiveRow, [string]>(
      "SELECT * FROM archives WHERE status = 'pending' AND created_at < ?",
    ).all(before).map(toArchiveRecord);
    if (records.length) {
      this.database.raw.query("UPDATE archives SET status = 'expired', pending_path = NULL, updated_at = ? WHERE status = 'pending' AND created_at < ?")
        .run(new Date().toISOString(), before);
    }
    return records;
  }
}

function identity(value: ArchiveRecord[keyof ArchiveRecord] | undefined): SQLQueryBindings {
  if (value === undefined) return null;
  if (Array.isArray(value)) return JSON.stringify(value);
  return value;
}

interface ProcessingRow {
  id: string; filename: string; code: number; messages_json: string; missing_fonts_json: string;
  font_count: number; file_size: number; elapsed_ms: number; processed_at: string;
}

function toProcessingLog(row: ProcessingRow) {
  return {
    id: row.id, filename: row.filename, code: row.code, messages: parseStringArray(row.messages_json),
    missing_fonts: parseStringArray(row.missing_fonts_json), font_count: row.font_count,
    file_size: row.file_size, elapsed_ms: row.elapsed_ms, processed_at: row.processed_at,
  };
}

export class SqliteActivityRepository implements ActivityRepository {
  constructor(private readonly database: SqliteDatabase) {}

  insert(input: ProcessingEventInput): void {
    this.database.raw.query(`
      INSERT INTO processing_events (id, filename, client_ip, code, messages_json, missing_fonts_json, font_count, file_size, elapsed_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), input.filename, input.clientIp, input.code, JSON.stringify(input.messages), JSON.stringify(input.missingFonts), input.fontCount, input.fileSize, input.elapsedMs);
  }

  list(query: { page: number; limit: number; search: string; code?: number }): ProcessingLogList {
    const conditions: string[] = [];
    const parameters: SQLQueryBindings[] = [];
    if (query.search) { conditions.push("(lower(filename) LIKE ? OR lower(missing_fonts_json) LIKE ?)"); parameters.push(`%${query.search}%`, `%${query.search}%`); }
    if (query.code !== undefined) { conditions.push("code = ?"); parameters.push(query.code); }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const total = this.database.raw.query<{ count: number }, SQLQueryBindings[]>(`SELECT COUNT(*) AS count FROM processing_events ${where}`).get(...parameters)?.count ?? 0;
    const rows = this.database.raw.query<ProcessingRow, SQLQueryBindings[]>(`
      SELECT id, filename, code, messages_json, missing_fonts_json, font_count, file_size, elapsed_ms, processed_at
      FROM processing_events ${where} ORDER BY processed_at DESC LIMIT ? OFFSET ?
    `).all(...parameters, query.limit, (query.page - 1) * query.limit);
    return { total, page: query.page, limit: query.limit, data: rows.map(toProcessingLog) };
  }

  missingFonts(limit: number, showResolved: boolean): { total: number; data: MissingFontRanking[] } {
    const resolved = new Map(this.database.raw.query<{ font_name: string; resolved_at: string }, []>("SELECT * FROM resolved_fonts").all().map((row) => [row.font_name, row.resolved_at]));
    const counts = new Map<string, number>();
    for (const row of this.database.raw.query<{ missing_fonts_json: string }, []>("SELECT missing_fonts_json FROM processing_events WHERE missing_fonts_json <> '[]'").all()) {
      for (const name of parseStringArray(row.missing_fonts_json)) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    let data = [...counts].map(([font_name, count]) => ({ font_name, count, resolved: resolved.has(font_name), resolved_at: resolved.get(font_name) ?? null }));
    if (!showResolved) data = data.filter((item) => !item.resolved);
    data.sort((a, b) => b.count - a.count || a.font_name.localeCompare(b.font_name));
    return { total: data.length, data: data.slice(0, limit) };
  }

  resolveFont(name: string): void {
    this.database.raw.query("INSERT OR IGNORE INTO resolved_fonts (font_name) VALUES (?)").run(name);
  }

  unresolveFont(name: string): void {
    this.database.raw.query("DELETE FROM resolved_fonts WHERE font_name = ?").run(name);
  }

  stats(today: string): LogStats {
    const total = this.database.raw.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM processing_events").get()?.count ?? 0;
    const todayCount = this.database.raw.query<{ count: number }, [string]>("SELECT COUNT(*) AS count FROM processing_events WHERE processed_at >= ?").get(today)?.count ?? 0;
    const counts = new Map(this.database.raw.query<{ code: number; count: number }, []>("SELECT code, COUNT(*) AS count FROM processing_events GROUP BY code").all().map((row) => [row.code, row.count]));
    const success = counts.get(200) ?? 0;
    const warnings = counts.get(201) ?? 0;
    const totalMissingFonts = this.database.raw.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM processing_events WHERE missing_fonts_json <> '[]'").get()?.count ?? 0;
    return { total, today: todayCount, success, warnings, errors: total - success - warnings, totalMissingFonts };
  }
}
