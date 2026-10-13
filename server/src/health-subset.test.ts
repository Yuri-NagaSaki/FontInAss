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
  test.each(["raw", "multipart"])("accepts a 20 MiB subtitle via %s without truncation", async protocol => {
    const config = testConfig({ subsetMaxFileSize: 32 * 1024 * 1024, subsetMaxBatchSize: 64 * 1024 * 1024 });
    const container = createContainer(config);
    const bytes = new Uint8Array(20 * 1024 * 1024).fill(65);
    const expectedHash = Bun.hash(bytes);
    let processedBytes = 0;
    container.subtitles = { async process(input) {
      processedBytes = input.bytes.byteLength;
      expect(Bun.hash(input.bytes)).toBe(expectedHash);
      return { code: 200, messages: [], data: new Uint8Array([65]), fontCount: 1 };
    } };
    const form = new FormData();
    form.append("file", new File([bytes], "large.ass"));
    const app = createApp(container);
    try {
      const response = await app.request("/api/subset", { method: "POST", body: protocol === "raw" ? bytes : form });
      expect(response.status).toBe(200);
      expect(response.headers.get("X-Code")).toBe("200");
      expect(await response.text()).toBe("A");
      expect(processedBytes).toBe(bytes.byteLength);
    } finally { container.close(); }
  });

  test.each([
    { sizes: [32], accepted: true },
    { sizes: [33], accepted: false, message: "large-0.ass exceeds the size limit (size 33 bytes; limit 32 bytes)" },
    { sizes: [32, 32], accepted: true },
    { sizes: [32, 32, 1], accepted: false, message: "Subtitle batch exceeds the size limit (size 65 bytes; limit 64 bytes)" },
  ])("enforces multipart file and batch boundaries: $sizes", async ({ sizes, accepted, message }) => {
    const container = createContainer(testConfig({ subsetMaxFileSize: 32, subsetMaxBatchSize: 64 }));
    let processed = 0;
    container.subtitles = { async process() {
      processed++;
      return { code: 200, messages: [], data: new Uint8Array([65]), fontCount: 1 };
    } };
    const form = new FormData();
    sizes.forEach((size, index) => form.append("file", new File([new Uint8Array(size)], `large-${index}.ass`)));
    try {
      const response = await createApp(container).request("/api/subset", { method: "POST", body: form });
      expect(processed).toBe(accepted ? sizes.length : 0);
      if (accepted && sizes.length > 1) {
        const result = await response.json() as { results: Array<{ code: number }> };
        expect(result.results.map(item => item.code)).toEqual(sizes.map(() => 200));
      } else {
        expect(response.headers.get("X-Code")).toBe(accepted ? "200" : "400");
        if (!accepted) {
          expect(JSON.parse(Buffer.from(response.headers.get("X-Message")!, "base64").toString())).toEqual([message]);
        }
      }
    } finally { container.close(); }
  });

  test("bounds all concurrent requests before reading bodies and releases slots", async () => {
    const config = testConfig({ subsetConcurrency: 1 });
    mkdirSync(config.logDirectory, { recursive: true });
    const container = createContainer(config);
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    container.subtitles = { async process() { entered(); await waiting; return { code: 200, messages: [], data: new Uint8Array([1]), fontCount: 0 }; } };
    const app = createApp(container);
    try {
      const first = app.request("/api/subset", { method: "POST", body: "A" });
      await started;
      const second = await app.request("/api/subset", { method: "POST", body: "B" });
      expect(second.status).toBe(503);
      expect(second.headers.get("Retry-After")).toBe("2");
      expect((await app.request("/api/health")).status).toBe(200);
      release();
      expect((await first).status).toBe(200);
      expect((await app.request("/api/subset", { method: "POST", body: "C" })).status).toBe(200);
    } finally { release(); container.close(); }
  });

  test("rejects oversized streaming bodies without Content-Length", async () => {
    const config = testConfig({ subsetMaxFileSize: 8 });
    mkdirSync(config.logDirectory, { recursive: true });
    const container = createContainer(config);
    try {
      const app = createApp(container);
      const response = await app.request("/api/subset", { method: "POST", body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(16)); controller.close(); } }) });
      expect(response.headers.get("X-Code")).toBe("400");
    } finally { container.close(); }
  });

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
