import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "./app.js";
import { createContainer } from "./container.js";
import type { RuntimeConfig } from "./runtime.js";

const directories: string[] = [];
afterEach(() => {
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true });
});

function testConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  const directory = mkdtempSync(join(tmpdir(), "fontinass-http-"));
  directories.push(directory);
  return {
    port: 3000, apiKey: "admin-test-key", corsOrigin: "*", fontDirectory: join(directory, "fonts"),
    databasePath: join(directory, "data.db"), pendingDirectory: join(directory, "pending"), logDirectory: join(directory, "logs"),
    logLevel: "error", subsetConcurrency: 2, cacheMaxEntries: 0, cacheMaxBytes: 1024, cacheTtlMs: 60_000,
    uploadTargetDirectory: "Contributions/",
    publicUploadMaxFiles: 1, publicUploadMaxFileSize: 100 * 1024 * 1024, publicUploadMaxBatchSize: 200 * 1024 * 1024,
    publicUploadRequestsPerMinute: 2, tokenApplicationDailyLimit: 3,
    archiveMaxFileSize: 200 * 1024 * 1024, archiveMaxUncompressed: 2 * 1024 * 1024 * 1024,
    contributionDailyLimit: 3, autoIndexIntervalHours: 4,
    subsetMaxFiles: 20, subsetMaxFileSize: 64 * 1024, subsetMaxBatchSize: 128 * 1024,
    activityRetentionDays: 30,
    r2: { accountId: "", accessKeyId: "", secretAccessKey: "", bucketName: "", publicUrl: "" },
    ...overrides,
  };
}

describe("health and subset limits", () => {
  test("GET /api/health is unauthenticated and returns the v2 contract", async () => {
    const config = testConfig();
    mkdirSync(config.logDirectory, { recursive: true });
    const container = createContainer(config);
    const app = createApp(container);
    try {
      await container.bootstrap();
      const response = await app.request("/api/health");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "ok", version: 2 });
    } finally {
      container.close();
    }
  });

  test("rejects a subtitle larger than SUBSET_MAX_FILE_SIZE", async () => {
    const config = testConfig({ subsetMaxFileSize: 32 });
    mkdirSync(config.logDirectory, { recursive: true });
    const container = createContainer(config);
    const app = createApp(container);
    try {
      await container.bootstrap();
      const response = await app.request("/api/subset", { method: "POST", body: new Uint8Array(64) });
      expect(response.headers.get("X-Code")).toBe("400");
      const messages = JSON.parse(Buffer.from(response.headers.get("X-Message") ?? "", "base64").toString()) as string[];
      expect(messages.join(" ")).toMatch(/too large|size limit/i);
    } finally {
      container.close();
    }
  });
});
