import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as opentype from "opentype.js";
import {
  FONTINASS_ENTITLEMENT_VERSION,
  type FontInAssEntitlementResponse,
  type ProgrammaticCredentialCreated,
  type WorkspaceSession,
} from "@fontinass/contracts";
import { InMemoryEntitlementProvider } from "@fontinass/access-control";
import { createApp } from "./app.js";
import { createContainer } from "./container.js";
import type { RuntimeConfig } from "./runtime.js";

function fixtureFont(): ArrayBuffer {
  const path = new opentype.Path();
  path.moveTo(80, 0);
  path.lineTo(300, 700);
  path.lineTo(520, 0);
  path.close();
  const font = new opentype.Font({
    familyName: "WorkspaceFixture",
    styleName: "Regular",
    unitsPerEm: 1000,
    ascender: 880,
    descender: -120,
    glyphs: [
      new opentype.Glyph({
        name: ".notdef",
        advanceWidth: 500,
        path: new opentype.Path(),
      }),
      new opentype.Glyph({
        name: "A",
        unicode: 65,
        advanceWidth: 600,
        path,
      }),
    ],
  });
  return font.toArrayBuffer();
}

function testConfig(directory: string): RuntimeConfig {
  return {
    environment: "test",
    port: 3000,
    operatorCredential: "operator-test-key-that-is-long-enough",
    publicOrigin: "http://localhost",
    corsOrigin: "http://localhost",
    fontDirectory: join(directory, "fonts"),
    databasePath: join(directory, "data.db"),
    pendingDirectory: join(directory, "pending"),
    logDirectory: join(directory, "logs"),
    logLevel: "error",
    subsetConcurrency: 2,
    cacheMaxEntries: 0,
    uploadTargetDirectory: "Contributions/",
    publicUploadMaxFiles: 1,
    publicUploadMaxFileSize: 100 * 1024 * 1024,
    publicUploadMaxBatchSize: 200 * 1024 * 1024,
    publicUploadRequestsPerMinute: 2,
    archiveMaxFileSize: 200 * 1024 * 1024,
    archiveMaxUncompressed: 2 * 1024 * 1024 * 1024,
    contributionDailyLimit: 3,
    autoIndexIntervalHours: 4,
    oidc: {
      issuer: "https://oauth.anibt.net",
      clientId: "test-client",
      clientSecret: "test-client-secret-that-is-long-enough",
      redirectUri: "http://localhost/api/auth/callback",
      postLogoutRedirectUri: "http://localhost/",
      scopes: "openid profile anibt:user_id",
      timeoutMs: 5_000,
    },
    entitlement: {
      origin: "https://anibt.net",
      keyId: "test-entitlement",
      signingSecret: "test-entitlement-secret-that-is-long-enough",
      timeoutMs: 5_000,
    },
    workspaceAccess: {
      fingerprintSecret: "test-fingerprint-secret-that-is-long-enough",
      encryptionSecret: "test-encryption-secret-that-is-long-enough",
      loginTransactionTtlMs: 10 * 60_000,
      sessionIdleTtlMs: 12 * 60 * 60_000,
      sessionAbsoluteTtlMs: 7 * 24 * 60 * 60_000,
      recentAuthTtlMs: 10 * 60_000,
      maxCredentialsPerUser: 5,
      maxCredentialsPerOrganization: 25,
      credentialCreationsPerHour: 10,
      maxCredentialTtlMs: 365 * 24 * 60 * 60_000,
    },
    r2: {
      accountId: "",
      accessKeyId: "",
      secretAccessKey: "",
      bucketName: "",
      publicUrl: "",
    },
  };
}

function entitlement(input: {
  organizations?: FontInAssEntitlementResponse["organizations"];
  canManage?: boolean;
}): FontInAssEntitlementResponse {
  return {
    version: FONTINASS_ENTITLEMENT_VERSION,
    accountStatus: "active",
    organizations: input.organizations ?? [],
    canManage: input.canManage ?? false,
    checkedAt: Date.now(),
  };
}

function sessionHeaders(token: string, csrfToken?: string) {
  return {
    Cookie: `fontinass_session=${token}`,
    Origin: "http://localhost",
    ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
  };
}

describe("OIDC member workspace HTTP flow", () => {
  test("separates public, Cookie, Bearer and administrator capabilities", async () => {
    const directory = mkdtempSync(join(tmpdir(), "fontinass-workspace-flow-"));
    const config = testConfig(directory);
    const entitlements = new Map<string, FontInAssEntitlementResponse>([
      [
        "member-user",
        entitlement({
          organizations: [
            {
              organizationId: "org-atlas",
              name: "Atlas Subs",
              slug: "atlas",
              role: "member",
            },
          ],
        }),
      ],
      ["admin-user", entitlement({ canManage: true })],
      ["non-member", entitlement({})],
    ]);
    const container = createContainer(
      config,
      { entitlementProvider: new InMemoryEntitlementProvider(entitlements) },
    );
    const app = createApp(container);
    try {
      mkdirSync(config.logDirectory, { recursive: true });
      await container.bootstrap();

      await expect(
        container.workspaceAccess.establishSession(
          {
            issuer: config.oidc.issuer,
            subject: "pairwise-non-member",
            userId: "non-member",
            displayName: "No Membership",
            picture: null,
          },
          null,
        ),
      ).rejects.toMatchObject({ code: "access_denied" });

      const member = await container.workspaceAccess.establishSession(
        {
          issuer: config.oidc.issuer,
          subject: "pairwise-member",
          userId: "member-user",
          displayName: "Atlas Member",
          picture: null,
        },
        "test-id-token",
      );
      const memberHeaders = sessionHeaders(
        member.token,
        member.principal.kind === "session"
          ? member.principal.csrfToken
          : undefined,
      );

      const sessionResponse = await app.request("/api/auth/session", {
        headers: { Cookie: memberHeaders.Cookie },
      });
      expect(sessionResponse.status).toBe(200);
      const session = await sessionResponse.json() as WorkspaceSession;
      expect(session.authenticated).toBeTrue();
      expect(session.organizations[0]?.organizationId).toBe("org-atlas");

      expect((await app.request("/api/token-applications")).status).toBe(404);
      expect((await app.request("/api/access/whoami")).status).toBe(404);

      const fontList = await app.request(
        "/api/workspace/fonts?page=1&limit=20&search=&organizationId=org-atlas",
        { headers: { Cookie: memberHeaders.Cookie } },
      );
      expect(fontList.status).toBe(200);
      expect(
        (
          await app.request("/api/admin/fonts/stats", {
            headers: { Cookie: memberHeaders.Cookie },
          })
        ).status,
      ).toBe(403);

      const createCredential = await app.request(
        "/api/workspace/credentials",
        {
          method: "POST",
          headers: {
            ...memberHeaders,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            organizationId: "org-atlas",
            name: "Release automation",
            confirmation: "Release automation",
            scopes: ["fonts.read", "fonts.write"],
          }),
        },
      );
      expect(createCredential.status).toBe(201);
      expect(createCredential.headers.get("cache-control")).toContain("no-store");
      const created = await createCredential.json() as ProgrammaticCredentialCreated;
      expect(created.plaintext.startsWith("fia_")).toBeTrue();

      const listed = await (
        await app.request("/api/workspace/credentials", {
          headers: { Cookie: memberHeaders.Cookie },
        })
      ).text();
      expect(listed).not.toContain(created.plaintext);
      const persisted = JSON.stringify(
        container.database.raw
          .query("SELECT * FROM programmatic_credentials")
          .all(),
      );
      expect(persisted).not.toContain(created.plaintext);

      const bearer = { Authorization: `Bearer ${created.plaintext}` };
      expect((await app.request("/api/v1/whoami", { headers: bearer })).status).toBe(200);
      expect(
        (
          await app.request("/api/operator/health", {
            headers: bearer,
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await app.request("/api/operator/health", {
            headers: {
              "X-FontInAss-Operator-Credential": created.plaintext,
            },
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await app.request("/api/operator/health", {
            headers: {
              "X-FontInAss-Operator-Credential": config.operatorCredential,
            },
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await app.request("/api/v1/whoami", {
            headers: {
              "X-FontInAss-Operator-Credential": config.operatorCredential,
            },
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await app.request("/api/auth/session", {
            headers: {
              "X-FontInAss-Operator-Credential": config.operatorCredential,
            },
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await app.request("/api/v1/whoami", {
            headers: { ...bearer, Cookie: memberHeaders.Cookie },
          })
        ).status,
      ).toBe(400);

      const workspaceUploadForm = new FormData();
      workspaceUploadForm.append(
        "file",
        new File([fixtureFont()], "workspace.ttf"),
      );
      const workspaceUpload = await app.request("/api/workspace/fonts", {
        method: "POST",
        headers: { ...memberHeaders, "X-Organization-ID": "org-atlas" },
        body: workspaceUploadForm,
      });
      expect(workspaceUpload.status).toBe(200);

      const programmaticUploadForm = new FormData();
      programmaticUploadForm.append(
        "file",
        new File([fixtureFont()], "programmatic.ttf"),
      );
      expect(
        (
          await app.request("/api/v1/upload", {
            method: "POST",
            headers: bearer,
            body: programmaticUploadForm,
          })
        ).status,
      ).toBe(200);

      const publicUploadForm = new FormData();
      publicUploadForm.append("file", new File([fixtureFont()], "public.ttf"));
      expect(
        (
          await app.request("/api/upload", {
            method: "POST",
            body: publicUploadForm,
          })
        ).status,
      ).toBe(200);

      const admin = await container.workspaceAccess.establishSession(
        {
          issuer: config.oidc.issuer,
          subject: "pairwise-admin",
          userId: "admin-user",
          displayName: "FontInAss Administrator",
          picture: null,
        },
        null,
      );
      const adminHeaders = sessionHeaders(
        admin.token,
        admin.principal.kind === "session"
          ? admin.principal.csrfToken
          : undefined,
      );
      expect(
        (
          await app.request("/api/admin/fonts/stats", {
            headers: { Cookie: adminHeaders.Cookie },
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await app.request("/api/admin/credentials", {
            headers: { Cookie: adminHeaders.Cookie },
          })
        ).status,
      ).toBe(200);

      const revoke = await app.request(
        `/api/workspace/credentials/${created.credential.id}`,
        { method: "DELETE", headers: memberHeaders },
      );
      expect(revoke.status).toBe(200);
      expect((await app.request("/api/v1/whoami", { headers: bearer })).status).toBe(401);

      entitlements.set("member-user", entitlement({}));
      expect(
        (
          await app.request(
            "/api/workspace/fonts?page=1&limit=20&search=&organizationId=org-atlas",
            { headers: { Cookie: memberHeaders.Cookie } },
          )
        ).status,
      ).toBe(403);
    } finally {
      container.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
