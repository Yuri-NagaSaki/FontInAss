import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createConnection } from "node:net";
import * as opentype from "opentype.js";
import type { ApiTokenApplication, ApiUploadResponse } from "@fontinass/contracts";
import { createApp } from "./app.js";
import { createContainer } from "./container.js";
import { loadRuntimeConfig, type RuntimeConfig } from "./runtime.js";

function fixtureFont(): Uint8Array<ArrayBuffer> {
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
  test.each(["content-length", "chunked"])("interrupted multipart uploads with %s release both slots on the real Bun HTTP server", async framing => {
    const directory = mkdtempSync(join(tmpdir(), "fontinass-upload-disconnect-"));
    const config = loadRuntimeConfig(directory);
    // Use only private fixtures even when the test runner inherits deployment env.
    Object.assign(config, {
      fontDirectory: join(directory, "fonts"), databasePath: join(directory, "data.db"),
      pendingDirectory: join(directory, "pending"), logDirectory: join(directory, "logs"),
      logLevel: "error", publicUploadRequestsPerMinute: 100,
    });
    const container = createContainer(config);
    const app = createApp(container);
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: app.fetch });
    const url = `http://127.0.0.1:${server.port}`;
    try {
      for (let round = 0; round < 3; round++) {
        const sockets = [0, 1].map(() => createConnection({ port: server.port!, host: "127.0.0.1" }));
        try {
          await Promise.all(sockets.map(socket => new Promise<void>((resolve, reject) => {
            socket.once("error", reject);
            socket.once("connect", () => {
              const part = '--broken\r\nContent-Disposition: form-data; name="file"; filename="partial.ttf"\r\n\r\npartial';
              const headers = 'POST /api/upload HTTP/1.1\r\nHost: localhost\r\nContent-Type: multipart/form-data; boundary=broken\r\n';
              const body = framing === "chunked"
                ? `Transfer-Encoding: chunked\r\n\r\n${Buffer.byteLength(part).toString(16)}\r\n${part}\r\n`
                : `Content-Length: 1000000\r\n\r\n${part}`;
              socket.write(headers + body, error => error ? reject(error) : resolve());
            });
          })));
          // Confirm both partial uploads reached admission before disconnecting.
          let busy = false;
          for (let attempt = 0; attempt < 50; attempt++) {
            const probe = await fetch(`${url}/api/upload`, { method: "POST", body: new FormData() });
            await probe.arrayBuffer();
            if (probe.status === 503) { busy = true; break; }
            await Bun.sleep(10);
          }
          expect(busy).toBe(true);
          expect((await fetch(`${url}/api/health`)).status).toBe(200);
        } finally { sockets.forEach(socket => socket.destroy()); }

        // A recovered endpoint must accept and parse a real font, not merely
        // return a healthy response from an unrelated endpoint.
        let recovered: Response | undefined;
        for (let attempt = 0; attempt < 50; attempt++) {
          const form = new FormData();
          form.append("file", new File([fixtureFont()], "recovery.ttf"));
          recovered = await fetch(`${url}/api/upload`, { method: "POST", body: form });
          if (recovered.status !== 503) break;
          await recovered.arrayBuffer();
          await Bun.sleep(10);
        }
        expect(recovered!.status).toBe(200);
        const result = await recovered!.json() as ApiUploadResponse;
        expect(result.summary.accepted + result.summary.duplicate).toBe(1);
      }
    } finally {
      await server.stop(true);
      container.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("separates limited public upload from reviewed member workspace access", async () => {
    const directory = mkdtempSync(join(tmpdir(), "fontinass-upload-flow-"));
    const config: RuntimeConfig = {
      port: 3000, apiKey: "admin-test-key", corsOrigin: "*", fontDirectory: join(directory, "fonts"),
      databasePath: join(directory, "data.db"), pendingDirectory: join(directory, "pending"), logDirectory: join(directory, "logs"),
      logLevel: "error", subsetConcurrency: 2, cacheMaxEntries: 0, cacheMaxBytes: 0, cacheTtlMs: 0, uploadTargetDirectory: "Contributions/",
      publicUploadMaxFiles: 1, publicUploadMaxFileSize: 100 * 1024 * 1024, publicUploadMaxBatchSize: 200 * 1024 * 1024,
      publicUploadRequestsPerMinute: 2, tokenApplicationDailyLimit: 3,
      archiveMaxFileSize: 200 * 1024 * 1024, archiveMaxUncompressed: 2 * 1024 * 1024 * 1024,
      contributionDailyLimit: 3, autoIndexIntervalHours: 4,
      subsetMaxFiles: 20, subsetMaxFileSize: 64 * 1024 * 1024, subsetMaxBatchSize: 256 * 1024 * 1024, activityRetentionDays: 30,
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
