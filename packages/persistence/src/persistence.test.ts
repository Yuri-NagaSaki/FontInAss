import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  SqliteDatabase,
  SqlitePublicUploadRateLimitRepository,
  SqliteWorkspaceAccessRepository,
} from "./index.js";

const directories: string[] = [];
afterEach(() => {
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true });
});

describe("SqliteDatabase migrations", () => {
  test("upgrades the released v2 fixture to v3, revokes legacy tokens and preserves receipts", () => {
    const directory = mkdtempSync(join(tmpdir(), "fontinass-migration-"));
    directories.push(directory);
    const path = join(directory, "old.db");
    const old = new Database(path, { create: true });
    old.run(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE api_tokens (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, prefix TEXT NOT NULL UNIQUE, token_hash TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1, note TEXT, upload_count INTEGER NOT NULL DEFAULT 0,
        total_bytes INTEGER NOT NULL DEFAULT 0, last_used_at TEXT, last_used_ip TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE api_upload_history (
        id TEXT PRIMARY KEY, token_id TEXT NOT NULL REFERENCES api_tokens(id) ON DELETE CASCADE,
        font_file_id TEXT, filename TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, sha256 TEXT,
        status TEXT NOT NULL, error TEXT, client_ip TEXT, user_agent TEXT, uploaded_at TEXT NOT NULL
      );
      CREATE TABLE archives (
        id TEXT PRIMARY KEY, name_cn TEXT NOT NULL, letter TEXT NOT NULL, season TEXT NOT NULL,
        sub_group TEXT NOT NULL, languages_json TEXT NOT NULL DEFAULT '[]',
        subtitle_formats_json TEXT NOT NULL DEFAULT '[]', episode_count INTEGER NOT NULL DEFAULT 0,
        has_fonts INTEGER NOT NULL DEFAULT 0, filename TEXT NOT NULL, storage_key TEXT UNIQUE,
        file_size INTEGER NOT NULL DEFAULT 0, file_count INTEGER NOT NULL DEFAULT 0,
        pending_path TEXT, status TEXT NOT NULL, contributor TEXT,
        sub_entries_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      );
    `);
    old.query(`INSERT INTO api_tokens (id,name,prefix,token_hash,enabled,upload_count,total_bytes,created_at) VALUES ('t1','old','0123abcd','hash',1,7,123,'2026-07-22T00:00:00.000Z')`).run();
    old.query(`INSERT INTO api_upload_history (id,token_id,filename,size,status,uploaded_at) VALUES ('h1','t1','font.ttf',123,'success','2026-07-22T00:00:01.000Z')`).run();
    old.run("PRAGMA user_version = 2");
    old.close();

    const migrated = new SqliteDatabase(path);
    const token = migrated.raw
      .query<{
        request_count: number;
        accepted_file_count: number;
        accepted_bytes: number;
        enabled: number;
        revoked_at: string | null;
      }, [string]>(`
        SELECT request_count, accepted_file_count, accepted_bytes, enabled, revoked_at
        FROM api_tokens WHERE id = ?
      `)
      .get("t1");
    expect(token?.request_count).toBe(7);
    expect(token?.accepted_file_count).toBe(1);
    expect(token?.accepted_bytes).toBe(123);
    expect(token?.enabled).toBe(0);
    expect(token?.revoked_at).not.toBeNull();
    expect(migrated.raw.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version).toBe(3);
    expect(migrated.raw.query<{ name: string }, [string]>("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get("api_token_applications")?.name).toBe("api_token_applications");
    expect(migrated.raw.query<{ name: string }, [string]>("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get("public_font_upload_rate_limits")?.name).toBe("public_font_upload_rate_limits");
    expect(
      migrated.raw
        .query<{ name: string }, [string]>(
          "SELECT name FROM sqlite_master WHERE type='index' AND name=?",
        )
        .get("idx_archives_organization_time")?.name,
    ).toBe("idx_archives_organization_time");
    expect(
      migrated.raw
        .query<{ name: string }, [string]>(
          "SELECT name FROM sqlite_master WHERE type='index' AND name=?",
        )
        .get("idx_api_tokens_application")?.name,
    ).toBe("idx_api_tokens_application");
    for (const table of [
      "oidc_identities",
      "oidc_login_transactions",
      "web_sessions",
      "programmatic_credentials",
      "access_receipts",
      "font_upload_receipts",
    ]) {
      expect(
        migrated.raw
          .query<{ name: string }, [string]>(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
          )
          .get(table)?.name,
      ).toBe(table);
    }
    expect(
      migrated.raw
        .query<{ count: number }, []>(
          "SELECT COUNT(*) AS count FROM font_upload_receipts WHERE legacy_token_id = 't1' AND actor_kind = 'legacy'",
        )
        .get()?.count,
    ).toBe(1);

    const publicUploads = new SqlitePublicUploadRateLimitRepository(migrated, 1);
    expect(publicUploads.consumePublicUploadRateLimit("ip-a")).toBeTrue();
    expect(publicUploads.consumePublicUploadRateLimit("ip-a")).toBeFalse();
    expect(migrated.raw.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM api_upload_history").get()?.count).toBe(1);
    migrated.close();

    const reopened = new SqliteDatabase(path);
    expect(
      reopened.raw
        .query<{ count: number }, []>(
          "SELECT COUNT(*) AS count FROM font_upload_receipts WHERE legacy_token_id = 't1'",
        )
        .get()?.count,
    ).toBe(1);
    expect(new SqliteWorkspaceAccessRepository(reopened).listCredentials()).toEqual([]);
    reopened.close();
  });
});
