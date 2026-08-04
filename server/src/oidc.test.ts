import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  FONTINASS_ENTITLEMENT_VERSION,
  type FontInAssEntitlementResponse,
} from "@fontinass/contracts";
import {
  InMemoryEntitlementProvider,
  WorkspaceAccess,
} from "@fontinass/access-control";
import {
  SqliteDatabase,
  SqliteWorkspaceAccessRepository,
} from "@fontinass/persistence";
import { OidcBff } from "./oidc.js";

const directories: string[] = [];
const servers: Bun.Server<unknown>[] = [];

afterEach(() => {
  while (servers.length) servers.pop()?.stop(true);
  while (directories.length) {
    rmSync(directories.pop()!, { recursive: true, force: true });
  }
});

type FailureMode =
  | "none"
  | "nonce"
  | "issuer"
  | "audience"
  | "expired"
  | "userinfo"
  | "pkce";

async function mockIssuer(mode: FailureMode) {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  Object.assign(publicJwk, { kid: "test-key", alg: "RS256", use: "sig" });
  let issuer = "";
  let expectedNonce = "";
  let expectedChallenge = "";
  const clientId = "fontinass-test-client";
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (
        url.pathname === "/.well-known/openid-configuration" ||
        url.pathname === "/.well-known/oauth-authorization-server"
      ) {
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          userinfo_endpoint: `${issuer}/userinfo`,
          jwks_uri: `${issuer}/jwks`,
          end_session_endpoint: `${issuer}/logout`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code"],
          subject_types_supported: ["pairwise"],
          id_token_signing_alg_values_supported: ["RS256"],
          token_endpoint_auth_methods_supported: ["client_secret_basic"],
          code_challenge_methods_supported: ["S256"],
        });
      }
      if (url.pathname === "/jwks") {
        return Response.json({ keys: [publicJwk] });
      }
      if (url.pathname === "/token") {
        const form = new URLSearchParams(await request.text());
        const verifier = form.get("code_verifier") ?? "";
        const challenge = createHash("sha256")
          .update(verifier)
          .digest("base64url");
        if (mode === "pkce" || challenge !== expectedChallenge) {
          return Response.json(
            { error: "invalid_grant" },
            { status: 400 },
          );
        }
        const now = Math.floor(Date.now() / 1_000);
        const idToken = await signJwt(keyPair.privateKey, {
          iss: mode === "issuer" ? `${issuer}/wrong` : issuer,
          aud: mode === "audience" ? "wrong-client" : clientId,
          sub: "pairwise-subject",
          iat: now,
          exp: mode === "expired" ? now - 3_600 : now + 300,
          nonce: mode === "nonce" ? "wrong-nonce" : expectedNonce,
          name: "Atlas Member",
          "https://anibt.net/claims/user_id": "stable-user-id",
        });
        return Response.json({
          access_token: "opaque-access-token",
          token_type: "Bearer",
          expires_in: 300,
          id_token: idToken,
        });
      }
      if (url.pathname === "/userinfo") {
        return Response.json({
          sub: mode === "userinfo" ? "different-subject" : "pairwise-subject",
          preferred_username: "Atlas Member",
          "https://anibt.net/claims/user_id": "stable-user-id",
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  servers.push(server);
  issuer = server.url.origin;
  return {
    issuer,
    clientId,
    setAuthorization(input: { nonce: string; challenge: string }) {
      expectedNonce = input.nonce;
      expectedChallenge = input.challenge;
    },
  };
}

async function signJwt(
  privateKey: CryptoKey,
  claims: Record<string, unknown>,
): Promise<string> {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test-key" }),
  ).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const data = new TextEncoder().encode(`${header}.${payload}`);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    data,
  );
  return `${header}.${payload}.${Buffer.from(signature).toString("base64url")}`;
}

function accessForTest() {
  const directory = mkdtempSync(join(tmpdir(), "fontinass-oidc-test-"));
  directories.push(directory);
  const database = new SqliteDatabase(join(directory, "data.db"));
  const entitlement: FontInAssEntitlementResponse = {
    version: FONTINASS_ENTITLEMENT_VERSION,
    accountStatus: "active",
    organizations: [
      {
        organizationId: "org-1",
        name: "Atlas Subs",
        slug: "atlas",
        role: "member",
      },
    ],
    canManage: false,
    checkedAt: Date.now(),
  };
  const access = new WorkspaceAccess(
    new SqliteWorkspaceAccessRepository(database),
    new InMemoryEntitlementProvider(
      new Map([["stable-user-id", entitlement]]),
    ),
    {
      fingerprintSecret: "oidc-test-fingerprint-secret-long-enough",
      encryptionSecret: "oidc-test-encryption-secret-long-enough",
      loginTransactionTtlMs: 10 * 60_000,
      sessionIdleTtlMs: 60 * 60_000,
      sessionAbsoluteTtlMs: 24 * 60 * 60_000,
      recentAuthTtlMs: 10 * 60_000,
      maxCredentialsPerUser: 5,
      maxCredentialsPerOrganization: 25,
      credentialCreationsPerHour: 10,
      maxCredentialTtlMs: 365 * 24 * 60 * 60_000,
    },
  );
  return { access, database };
}

async function flow(mode: FailureMode) {
  const mock = await mockIssuer(mode);
  const state = accessForTest();
  const redirectUri = "http://fontinass.test/api/auth/callback";
  const bff = new OidcBff(
    {
      issuer: mock.issuer,
      clientId: mock.clientId,
      clientSecret: "oidc-client-secret-that-is-long-enough",
      redirectUri,
      postLogoutRedirectUri: "http://fontinass.test/",
      scopes: "openid profile anibt:user_id",
      timeoutMs: 5_000,
    },
    state.access,
  );
  const authorizationUrl = await bff.authorizationUrl("/workspace");
  mock.setAuthorization({
    nonce: authorizationUrl.searchParams.get("nonce") ?? "",
    challenge: authorizationUrl.searchParams.get("code_challenge") ?? "",
  });
  const callback = new URL(redirectUri);
  callback.searchParams.set("code", "authorization-code");
  callback.searchParams.set(
    "state",
    authorizationUrl.searchParams.get("state") ?? "",
  );
  return { ...state, bff, authorizationUrl, callback };
}

describe("OidcBff", () => {
  test("completes Code+PKCE, nonce, UserInfo and local Session establishment", async () => {
    const state = await flow("none");
    try {
      expect(state.authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
      expect(state.authorizationUrl.searchParams.get("state")).toBeTruthy();
      expect(state.authorizationUrl.searchParams.get("nonce")).toBeTruthy();

      const result = await state.bff.callback(state.callback);
      expect(result.returnTo).toBe("/workspace");
      expect(result.principal).toMatchObject({
        kind: "session",
        userId: "stable-user-id",
        displayName: "Atlas Member",
      });
      expect((await state.access.resolveSession(result.token)).kind).toBe("session");
      await expect(state.bff.callback(state.callback)).rejects.toMatchObject({
        code: "invalid_state",
      });
    } finally {
      state.database.close();
    }
  });

  for (const mode of [
    "nonce",
    "issuer",
    "audience",
    "expired",
    "userinfo",
    "pkce",
  ] as const) {
    test(`fails closed for ${mode} validation failure`, async () => {
      const state = await flow(mode);
      try {
        await expect(state.bff.callback(state.callback)).rejects.toBeInstanceOf(Error);
        expect(
          state.database.raw
            .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM web_sessions")
            .get()?.count,
        ).toBe(0);
      } finally {
        state.database.close();
      }
    });
  }
});
