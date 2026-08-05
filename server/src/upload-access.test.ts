import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as opentype from "opentype.js";
import type { ApiTokenApplication, ApiUploadResponse } from "@fontinass/contracts";
import { createApp } from "./app.js";
import { createContainer } from "./container.js";
import type { RuntimeConfig } from "./runtime.js";

function fixtureFont(): Uint8Array {
  const path = new opentype.Path();
  path.moveTo(80, 0); path.lineTo(300, 700); path.lineTo(520, 0); path.close();
  const font = new opentype.Font({
    familyName: "UploadAccessFixture", styleName: "Regular", unitsPerEm: 1000, ascender: 880, descender: -120,
    glyphs: [
      new opentype.Glyph({ name: ".notdef", advanceWidth: 500, path: new opentype.Path() }),
      new opentype.Glyph({ name: "A", unicode: 65, advanceWidth: 600, path }),
    ],
  });
  return new Uint8Array(font.toArrayBuffer());
}

describe("font access HTTP flow", () => {
  test("separates limited public upload from reviewed member workspace access", async () => {
    const directory = mkdtempSync(join(tmpdir(), "fontinass-upload-flow-"));
    const config: RuntimeConfig = {
      port: 3000, apiKey: "admin-test-key", corsOrigin: "*", fontDirectory: join(directory, "fonts"),
      databasePath: join(directory, "data.db"), pendingDirectory: join(directory, "pending"), logDirectory: join(directory, "logs"),
      logLevel: "error", subsetConcurrency: 2, cacheMaxEntries: 0, uploadTargetDirectory: "Contributions/",
      publicUploadMaxFiles: 1, publicUploadMaxFileSize: 100 * 1024 * 1024, publicUploadMaxBatchSize: 200 * 1024 * 1024,
      publicUploadRequestsPerMinute: 2, tokenApplicationDailyLimit: 3,
      archiveMaxFileSize: 200 * 1024 * 1024, archiveMaxUncompressed: 2 * 1024 * 1024 * 1024,
      contributionDailyLimit: 3, autoIndexIntervalHours: 4,
      r2: { accountId: "", accessKeyId: "", secretAccessKey: "", bucketName: "", publicUrl: "" },
    };
    const container = createContainer(config);
    const app = createApp(container);
    try {
      mkdirSync(config.logDirectory, { recursive: true });
      await container.bootstrap();
      const applyResponse = await app.request("/api/token-applications", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicant_name: "Atlas Subs", contact: "atlas@example.com", purpose: "Upload release fonts for subtitle production" }),
      });
      expect(applyResponse.status).toBe(201);
      const receipt = await applyResponse.json() as { application: ApiTokenApplication; recovery_secret: string };

      const pendingResponse = await app.request(`/api/token-applications/${receipt.application.id}`, {
        headers: { "X-Application-Secret": receipt.recovery_secret },
      });
      expect((await pendingResponse.json() as { application: ApiTokenApplication }).application.status).toBe("pending");

      const reviewResponse = await app.request(`/api/tokens/applications/${receipt.application.id}/review`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-API-Key": config.apiKey },
        body: JSON.stringify({ decision: "approve", public_note: "Approved for release fonts" }),
      });
      expect(reviewResponse.status).toBe(200);

      const claimResponse = await app.request(`/api/token-applications/${receipt.application.id}/claim`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: receipt.recovery_secret }),
      });
      expect(claimResponse.status).toBe(200);
      const claimed = await claimResponse.json() as { token: { id: string }; plaintext: string };
      expect(claimed.plaintext).toBe(receipt.recovery_secret);

      const headers = { Authorization: `Bearer ${claimed.plaintext}` };
      expect((await app.request("/api/v1/whoami", { headers })).status).toBe(200);
      const workspaceHeaders = { "X-API-Key": claimed.plaintext };
      const sessionResponse = await app.request("/api/access/whoami", { headers: workspaceHeaders });
      expect(sessionResponse.status).toBe(200);
      expect((await sessionResponse.json() as { role: string }).role).toBe("member");
      expect((await app.request("/api/fonts?page=1&limit=100&search=", { headers: workspaceHeaders })).status).toBe(200);
      expect((await app.request("/api/fonts/stats", { headers: workspaceHeaders })).status).toBe(401);
      expect((await app.request("/api/tokens", { headers: workspaceHeaders })).status).toBe(401);

      const backendForm = new FormData();
      backendForm.append("file", new File([fixtureFont()], "backend-a.ttf"));
      backendForm.append("file", new File([fixtureFont()], "backend-b.ttf"));
      const backendUpload = await app.request("/api/fonts", { method: "POST", headers: workspaceHeaders, body: backendForm });
      expect(backendUpload.status).toBe(200);
      const backendResults = (await backendUpload.json() as { results: Array<{ id: string }> }).results;
      expect(backendResults).toHaveLength(2);
      expect((await app.request(`/api/fonts/${backendResults[0].id}/download`, { headers: workspaceHeaders })).status).toBe(200);

      const oversizedPublicBatch = new FormData();
      oversizedPublicBatch.append("file", new File([fixtureFont()], "public-a.ttf"));
      oversizedPublicBatch.append("file", new File([fixtureFont()], "public-b.ttf"));
      expect((await app.request("/api/upload", { method: "POST", body: oversizedPublicBatch })).status).toBe(400);

      const publicForm = new FormData();
      publicForm.append("file", new File([fixtureFont()], "public.ttf"));
      const publicResponse = await app.request("/api/upload", { method: "POST", body: publicForm });
      expect(publicResponse.status).toBe(200);
      expect((await publicResponse.json() as ApiUploadResponse).results[0].status).toBe("duplicate");

      const memberForm = new FormData();
      memberForm.append("file", new File([fixtureFont()], "member-a.ttf"));
      memberForm.append("file", new File([fixtureFont()], "member-b.ttf"));
      const memberResponse = await app.request("/api/v1/upload", { method: "POST", headers, body: memberForm });
      expect(memberResponse.status).toBe(200);
      expect((await memberResponse.json() as ApiUploadResponse).results).toHaveLength(2);

      const ownHistory = await app.request("/api/v1/history?page=1&limit=20", { headers });
      expect((await ownHistory.json() as { total: number }).total).toBe(4);

      const revoke = await app.request(`/api/tokens/${claimed.token.id}`, { method: "DELETE", headers: { "X-API-Key": config.apiKey } });
      expect(revoke.status).toBe(200);
      expect((await app.request("/api/v1/whoami", { headers })).status).toBe(401);
      expect((await app.request("/api/fonts?page=1&limit=20&search=", { headers: workspaceHeaders })).status).toBe(401);
      const adminHistory = await app.request(`/api/tokens/${claimed.token.id}/history?page=1&limit=20`, { headers: { "X-API-Key": config.apiKey } });
      expect((await adminHistory.json() as { total: number }).total).toBe(4);
    } finally {
      container.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
