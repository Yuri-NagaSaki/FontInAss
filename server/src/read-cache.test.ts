import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActivityLog } from "@fontinass/activity-log";
import { DefaultArchiveLibrary, type PublishedArchiveStore } from "@fontinass/archive-library";
import { SqliteActivityRepository, SqliteArchiveRepository, SqliteDatabase } from "@fontinass/persistence";

test("read caches are invalidated by successful writes and pruning", async () => {
  const directory = mkdtempSync(join(tmpdir(), "fontinass-read-cache-"));
  const db = new SqliteDatabase(join(directory, "db.sqlite"));
  const published: PublishedArchiveStore = {
    isConfigured: () => true, async put() {}, async get() { return { bytes: new Uint8Array(), contentLength: 0 }; },
    async delete() {}, async exists() { return true; }, publicUrl: key => `https://example.test/${key}`,
    async readManifest() { return null; }, async writeManifest() {},
  };
  try {
    const activity = new ActivityLog(new SqliteActivityRepository(db));
    expect(activity.stats().total).toBe(0);
    activity.record({ filename: "fixture.ass", clientIp: null, code: 200, messages: [], missingFonts: [], fontCount: 1, fileSize: 10, elapsedMs: 1 });
    expect(activity.stats().total).toBe(1);
    activity.prune("9999-01-01");
    expect(activity.stats().total).toBe(0);

    const archives = new DefaultArchiveLibrary(new SqliteArchiveRepository(db), published,
      { async put() { return "fixture"; }, async get() { return null; }, async delete() {} },
      { async inspect() { return { valid: true, type: "zip", filenames: ["a.ass"], subtitleFormats: ["ass"], subtitleCount: 1 }; } },
      { maxFileSize: 100, dailyContributionLimit: 3 });
    expect(archives.listPublished()).toHaveLength(0);
    const record = await archives.publish({ filename: "a.zip", bytes: new Uint8Array([1]), metadata: {
      name_cn: "Fixture", letter: "F", season: "1", sub_group: "Test", languages: ["简体中文"], has_fonts: true,
    } });
    expect(archives.listPublished()).toHaveLength(1);
    await archives.edit(record.id, { sub_group: "Updated" });
    expect(archives.listPublished()[0].sub_group).toBe("Updated");
    await archives.remove(record.id);
    expect(archives.listPublished()).toHaveLength(0);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
