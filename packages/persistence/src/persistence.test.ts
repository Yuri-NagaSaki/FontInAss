import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteDatabase, SqliteUploadAccessRepository } from "./index.js";

const directories: string[] = [];
afterEach(() => {
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true });
});

describe("SqliteDatabase migrations", () => {
  test("upgrades the released v2 token tables and preserves counters and history", () => {
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
    `);
    old.query(`INSERT INTO api_tokens (id,name,prefix,token_hash,enabled,upload_count,total_bytes,created_at) VALUES ('t1','old','0123abcd','hash',1,7,123,'2026-07-22T00:00:00.000Z')`).run();
    old.query(`INSERT INTO api_upload_history (id,token_id,filename,size,status,uploaded_at) VALUES ('h1','t1','font.ttf',123,'success','2026-07-22T00:00:01.000Z')`).run();
    old.close();

    const migrated = new SqliteDatabase(path);
    const token = new SqliteUploadAccessRepository(migrated).findTokenById("t1");
    expect(token?.request_count).toBe(7);
    expect(token?.accepted_file_count).toBe(1);
    expect(token?.accepted_bytes).toBe(123);
    expect(migrated.raw.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version).toBe(2);
    expect(migrated.raw.query<{ name: string }, [string]>("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get("api_token_applications")?.name).toBe("api_token_applications");
    expect(migrated.raw.query<{ name: string }, [string]>("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get("public_font_upload_rate_limits")?.name).toBe("public_font_upload_rate_limits");

    const access = new SqliteUploadAccessRepository(migrated);
    expect(access.consumePublicUploadRateLimit("ip-a", "2026-07-22T08:00", 1)).toBeTrue();
    expect(access.consumePublicUploadRateLimit("ip-a", "2026-07-22T08:00", 1)).toBeFalse();
    access.revokeToken("t1");
    expect(migrated.raw.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM api_upload_history").get()?.count).toBe(1);
    migrated.close();
  });
});
