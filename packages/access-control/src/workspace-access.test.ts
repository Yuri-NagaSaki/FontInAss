import { describe, expect, test } from "bun:test";
import {
  FONTINASS_ENTITLEMENT_VERSION,
  type AccessReceipt,
  type FontInAssEntitlementResponse,
  type OidcWorkspaceIdentity,
} from "@fontinass/contracts";
import { InMemoryEntitlementProvider } from "./entitlement.js";
import {
  WorkspaceAccess,
  WorkspaceAccessError,
  type LoginTransactionRecord,
  type ProgrammaticCredentialRecord,
  type WebSessionRecord,
  type WorkspaceAccessRepository,
} from "./workspace-access.js";

class MemoryRepository implements WorkspaceAccessRepository {
  login = new Map<string, LoginTransactionRecord>();
  sessions = new Map<string, WebSessionRecord>();
  credentials = new Map<string, ProgrammaticCredentialRecord>();
  receipts: AccessReceipt[] = [];
  identities = new Map<string, OidcWorkspaceIdentity>();
  credentialCreationCounts = new Map<string, number>();

  insertLoginTransaction(record: LoginTransactionRecord) {
    this.login.set(record.stateFingerprint, { ...record });
  }

  consumeLoginTransaction(stateFingerprint: string, now: string) {
    const record = this.login.get(stateFingerprint);
    if (!record || record.consumedAt || record.expiresAt <= now) return null;
    record.consumedAt = now;
    return { ...record };
  }

  upsertIdentity(identity: OidcWorkspaceIdentity) {
    this.identities.set(identity.userId, identity);
  }

  insertSession(record: WebSessionRecord) {
    this.sessions.set(record.id, { ...record });
  }

  findSessionById(id: string) {
    return this.sessions.get(id) ?? null;
  }

  findSessionByFingerprint(fingerprint: string) {
    return (
      [...this.sessions.values()].find(
        (session) => session.tokenFingerprint === fingerprint,
      ) ?? null
    );
  }

  touchSession(id: string, lastSeenAt: string, idleExpiresAt: string) {
    const session = this.sessions.get(id);
    if (session) Object.assign(session, { lastSeenAt, idleExpiresAt });
  }

  revokeSession(id: string, revokedAt: string) {
    const session = this.sessions.get(id);
    if (session) session.revokedAt ??= revokedAt;
  }

  revokeSessionsByUser(userId: string, revokedAt: string) {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.userId !== userId || session.revokedAt) continue;
      session.revokedAt = revokedAt;
      count += 1;
    }
    return count;
  }

  findCredentialByPrefix(prefix: string) {
    return (
      [...this.credentials.values()].find(
        (credential) => credential.prefix === prefix,
      ) ?? null
    );
  }

  insertCredential(record: ProgrammaticCredentialRecord) {
    this.credentials.set(record.id, { ...record });
  }

  listCredentialsByOwner(userId: string) {
    return [...this.credentials.values()].filter(
      (credential) => credential.ownerUserId === userId,
    );
  }

  listCredentials() {
    return [...this.credentials.values()];
  }

  countActiveCredentials(userId: string, organizationId: string, now: string) {
    const active = [...this.credentials.values()].filter(
      (credential) =>
        !credential.revokedAt &&
        (!credential.expiresAt || credential.expiresAt > now),
    );
    return {
      user: active.filter((credential) => credential.ownerUserId === userId).length,
      organization: active.filter(
        (credential) => credential.organizationId === organizationId,
      ).length,
    };
  }

  consumeCredentialCreationRateLimit(
    ownerFingerprint: string,
    hourBucket: string,
    limit: number,
  ) {
    const key = `${ownerFingerprint}:${hourBucket}`;
    const count = this.credentialCreationCounts.get(key) ?? 0;
    if (count >= limit) return false;
    this.credentialCreationCounts.set(key, count + 1);
    return true;
  }

  revokeCredential(id: string, revokedAt: string) {
    const credential = this.credentials.get(id);
    if (!credential) return null;
    credential.revokedAt ??= revokedAt;
    return { ...credential };
  }

  touchCredential(id: string, lastUsedAt: string) {
    const credential = this.credentials.get(id);
    if (credential) credential.lastUsedAt = lastUsedAt;
  }

  insertAccessReceipt(receipt: AccessReceipt) {
    this.receipts.push(receipt);
  }

  listAccessReceipts(limit: number) {
    return this.receipts.slice(-limit).reverse();
  }

  listAccessReceiptsForActors(actorFingerprints: string[], limit: number) {
    const actors = new Set(actorFingerprints);
    return this.receipts
      .filter((receipt) => actors.has(receipt.actorFingerprint))
      .slice(-limit)
      .reverse();
  }
}

function activeEntitlement(
  organizations: FontInAssEntitlementResponse["organizations"] = [],
  canManage = false,
): FontInAssEntitlementResponse {
  return {
    version: FONTINASS_ENTITLEMENT_VERSION,
    accountStatus: "active",
    organizations,
    canManage,
    checkedAt: 1_000,
  };
}

function setup(
  overrides: Partial<{
    maxCredentialsPerUser: number;
    maxCredentialsPerOrganization: number;
    credentialCreationsPerHour: number;
  }> = {},
) {
  let now = 1_723_000_000_000;
  const repository = new MemoryRepository();
  const entitlements = new Map<string, FontInAssEntitlementResponse>([
    [
      "user-1",
      activeEntitlement([
        {
          organizationId: "org-1",
          name: "Atlas Subs",
          slug: "atlas",
          role: "member",
        },
        {
          organizationId: "org-2",
          name: "Second Group",
          slug: "second",
          role: "admin",
        },
      ]),
    ],
  ]);
  const access = new WorkspaceAccess(
    repository,
    new InMemoryEntitlementProvider(entitlements),
    {
      fingerprintSecret: "fingerprint-secret-that-is-long-enough",
      encryptionSecret: "encryption-secret-that-is-long-enough",
      loginTransactionTtlMs: 10 * 60_000,
      sessionIdleTtlMs: 60 * 60_000,
      sessionAbsoluteTtlMs: 24 * 60 * 60_000,
      recentAuthTtlMs: 10 * 60_000,
      maxCredentialsPerUser: 2,
      maxCredentialsPerOrganization: 2,
      credentialCreationsPerHour: 10,
      maxCredentialTtlMs: 365 * 24 * 60 * 60_000,
      ...overrides,
    },
    () => now,
  );
  return {
    access,
    repository,
    entitlements,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

const identity: OidcWorkspaceIdentity = {
  issuer: "https://oauth.anibt.net",
  subject: "pairwise-subject",
  userId: "user-1",
  displayName: "Atlas Member",
  picture: null,
};

describe("WorkspaceAccess", () => {
  test("consumes login state once and normalizes unsafe return paths", () => {
    const state = setup();
    const login = state.access.beginLogin("https://evil.invalid/steal");
    const consumed = state.access.consumeLogin(login.state);
    expect(consumed.returnTo).toBe("/workspace");
    expect(consumed.nonce).toBe(login.nonce);
    expect(consumed.codeVerifier).toBe(login.codeVerifier);
    expect(() => state.access.consumeLogin(login.state)).toThrow(
      new WorkspaceAccessError("invalid_state"),
    );
  });

  test("rotates prior sessions and fails closed when membership disappears", async () => {
    const state = setup();
    const first = await state.access.establishSession(identity, "id-token-1");
    const second = await state.access.establishSession(identity, "id-token-2");
    await expect(state.access.resolveSession(first.token)).rejects.toMatchObject({
      code: "unauthenticated",
    });
    expect((await state.access.resolveSession(second.token)).kind).toBe("session");

    state.entitlements.set("user-1", activeEntitlement());
    await expect(state.access.resolveSession(second.token)).rejects.toMatchObject({
      code: "access_denied",
    });
  });

  test("enforces CSRF, recent authentication and one-time credential disclosure", async () => {
    const state = setup();
    const session = await state.access.establishSession(identity, null);
    const principal = session.principal;
    if (principal.kind !== "session") throw new Error("expected session");

    expect(() => state.access.assertCsrf(principal, "wrong")).toThrow(
      new WorkspaceAccessError("invalid_csrf"),
    );
    state.access.assertCsrf(principal, principal.csrfToken);

    const created = state.access.createCredential(principal, {
      organizationId: "org-1",
      name: "Release bot",
      confirmation: "Release bot",
      scopes: ["fonts.read", "fonts.write"],
      expiresAt: null,
    });
    expect(created.plaintext).toMatch(/^fia_[0-9a-f]{8}_[A-Za-z0-9_-]+$/);
    expect(JSON.stringify(state.access.listCredentials(principal))).not.toContain(
      created.plaintext,
    );
    expect(JSON.stringify(state.repository.credentials)).not.toContain(
      created.plaintext,
    );

    const credential = await state.access.resolveCredential(created.plaintext);
    state.access.authorize(credential, "fonts.write", "org-1");
    expect(() =>
      state.access.authorize(credential, "subtitles.write", "org-1"),
    ).toThrow(new WorkspaceAccessError("access_denied"));
    expect(() =>
      state.access.authorize(credential, "fonts.read", "org-2"),
    ).toThrow(new WorkspaceAccessError("access_denied"));

    state.advance(11 * 60_000);
    expect(() =>
      state.access.createCredential(principal, {
        organizationId: "org-1",
        name: "Late bot",
        confirmation: "Late bot",
        scopes: ["fonts.read"],
        expiresAt: null,
      }),
    ).toThrow(new WorkspaceAccessError("recent_auth_required"));
  });

  test("enforces quota, confirmation and immediate revocation", async () => {
    const state = setup();
    const session = await state.access.establishSession(identity, null);
    const principal = session.principal;
    if (principal.kind !== "session") throw new Error("expected session");

    expect(() =>
      state.access.createCredential(principal, {
        organizationId: "org-1",
        name: "One",
        confirmation: "Wrong",
        scopes: ["fonts.read"],
        expiresAt: null,
      }),
    ).toThrow(new WorkspaceAccessError("confirmation_mismatch"));

    const one = state.access.createCredential(principal, {
      organizationId: "org-1",
      name: "One",
      confirmation: "One",
      scopes: ["fonts.read"],
      expiresAt: null,
    });
    state.access.createCredential(principal, {
      organizationId: "org-2",
      name: "Two",
      confirmation: "Two",
      scopes: ["fonts.read"],
      expiresAt: null,
    });
    expect(() =>
      state.access.createCredential(principal, {
        organizationId: "org-1",
        name: "Three",
        confirmation: "Three",
        scopes: ["fonts.read"],
        expiresAt: null,
      }),
    ).toThrow(new WorkspaceAccessError("quota_exceeded"));

    state.access.revokeCredential(principal, one.credential.id);
    await expect(state.access.resolveCredential(one.plaintext)).rejects.toMatchObject({
      code: "invalid_credential",
    });
  });

  test("rate-limits credential creation and exposes only redacted credential activity", async () => {
    const state = setup({
      maxCredentialsPerUser: 10,
      maxCredentialsPerOrganization: 10,
      credentialCreationsPerHour: 1,
    });
    const session = await state.access.establishSession(identity, null);
    const principal = session.principal;
    if (principal.kind !== "session") throw new Error("expected session");
    const created = state.access.createCredential(principal, {
      organizationId: "org-1",
      name: "Activity bot",
      confirmation: "Activity bot",
      scopes: ["fonts.read"],
      expiresAt: null,
    });
    const credential = await state.access.resolveCredential(created.plaintext);
    state.access.recordAccess({
      principal: credential,
      capability: "fonts.read",
      organizationId: "org-1",
      resourceType: "font",
      resourceId: "font-private-id",
      outcome: "completed",
    });
    const activity = state.access.credentialActivity(principal);
    expect(activity).toHaveLength(1);
    expect(JSON.stringify(activity)).not.toContain(created.plaintext);
    expect(JSON.stringify(activity)).not.toContain("font-private-id");

    expect(() =>
      state.access.createCredential(principal, {
        organizationId: "org-1",
        name: "Second bot",
        confirmation: "Second bot",
        scopes: ["fonts.read"],
        expiresAt: null,
      }),
    ).toThrow(new WorkspaceAccessError("rate_limited"));
  });
});
