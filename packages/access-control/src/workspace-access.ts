import { randomBytes } from "node:crypto";
import type {
  AccessReceipt,
  CreateProgrammaticCredential,
  FontInAssEntitlementResponse,
  OidcWorkspaceIdentity,
  ProgrammaticCredential,
  ProgrammaticCredentialScope,
  WorkspaceCapability,
  WorkspacePrincipal,
  WorkspaceSession,
} from "@fontinass/contracts";
import type { EntitlementProvider } from "./entitlement.js";
import {
  decryptString,
  encryptString,
  keyedFingerprint,
  randomBase64Url,
  safeStringEqual,
} from "./secure-values.js";

const MEMBER_CAPABILITIES = new Set<WorkspaceCapability>([
  "fonts.read",
  "fonts.write",
  "subtitles.read",
  "subtitles.write",
  "credentials.manage",
]);

export type LoginTransactionRecord = {
  id: string;
  stateFingerprint: string;
  sealedPayload: string;
  returnTo: string;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
};

export type WebSessionRecord = {
  id: string;
  tokenFingerprint: string;
  userId: string;
  displayName: string;
  picture: string | null;
  csrfFingerprint: string;
  sealedIdToken: string | null;
  authenticatedAt: string;
  createdAt: string;
  lastSeenAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
  revokedAt: string | null;
};

export type ProgrammaticCredentialRecord = ProgrammaticCredential & {
  ownerUserId: string;
  credentialFingerprint: string;
};

export interface WorkspaceAccessRepository {
  insertLoginTransaction(record: LoginTransactionRecord): void;
  consumeLoginTransaction(
    stateFingerprint: string,
    now: string,
  ): LoginTransactionRecord | null;
  upsertIdentity(identity: OidcWorkspaceIdentity, now: string): void;
  insertSession(record: WebSessionRecord): void;
  findSessionById(id: string): WebSessionRecord | null;
  findSessionByFingerprint(fingerprint: string): WebSessionRecord | null;
  touchSession(id: string, lastSeenAt: string, idleExpiresAt: string): void;
  revokeSession(id: string, revokedAt: string): void;
  revokeSessionsByUser(userId: string, revokedAt: string): number;
  findCredentialByPrefix(prefix: string): ProgrammaticCredentialRecord | null;
  insertCredential(record: ProgrammaticCredentialRecord): void;
  listCredentialsByOwner(userId: string): ProgrammaticCredentialRecord[];
  listCredentials(): ProgrammaticCredentialRecord[];
  countActiveCredentials(userId: string, organizationId: string, now: string): {
    user: number;
    organization: number;
  };
  consumeCredentialCreationRateLimit(
    ownerFingerprint: string,
    hourBucket: string,
    limit: number,
  ): boolean;
  revokeCredential(id: string, revokedAt: string): ProgrammaticCredentialRecord | null;
  touchCredential(id: string, lastUsedAt: string): void;
  insertAccessReceipt(receipt: AccessReceipt): void;
  listAccessReceipts(limit: number): AccessReceipt[];
  listAccessReceiptsForActors(
    actorFingerprints: string[],
    limit: number,
  ): AccessReceipt[];
}

export type WorkspaceAccessOptions = {
  fingerprintSecret: string;
  encryptionSecret: string;
  loginTransactionTtlMs: number;
  sessionIdleTtlMs: number;
  sessionAbsoluteTtlMs: number;
  recentAuthTtlMs: number;
  maxCredentialsPerUser: number;
  maxCredentialsPerOrganization: number;
  credentialCreationsPerHour: number;
  maxCredentialTtlMs: number;
};

export type WorkspaceAccessErrorCode =
  | "unauthenticated"
  | "access_denied"
  | "account_inactive"
  | "invalid_state"
  | "invalid_csrf"
  | "recent_auth_required"
  | "invalid_credential"
  | "invalid_scope"
  | "organization_unavailable"
  | "quota_exceeded"
  | "rate_limited"
  | "confirmation_mismatch"
  | "not_found";

export class WorkspaceAccessError extends Error {
  constructor(public readonly code: WorkspaceAccessErrorCode) {
    super(code);
    this.name = "WorkspaceAccessError";
  }
}

function date(ms: number): string {
  return new Date(ms).toISOString();
}

function validReturnTo(value: string): string {
  const trimmed = value.trim();
  if (
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    trimmed.includes("\\") ||
    trimmed.length > 500
  ) {
    return "/workspace";
  }
  return trimmed;
}

function credentialPrefix(plaintext: string): string | null {
  const match = plaintext.match(/^fia_([0-9a-f]{8})_[A-Za-z0-9_-]{32,}$/);
  return match?.[1] ?? null;
}

function isActiveEntitlement(
  entitlement: FontInAssEntitlementResponse,
): boolean {
  return entitlement.accountStatus === "active";
}

export class WorkspaceAccess {
  constructor(
    private readonly repository: WorkspaceAccessRepository,
    private readonly entitlements: EntitlementProvider,
    private readonly options: WorkspaceAccessOptions,
    private readonly now: () => number = Date.now,
  ) {}

  beginLogin(returnTo: string): {
    state: string;
    nonce: string;
    codeVerifier: string;
  } {
    const now = this.now();
    const state = randomBase64Url(32);
    const nonce = randomBase64Url(32);
    const codeVerifier = randomBase64Url(64);
    this.repository.insertLoginTransaction({
      id: crypto.randomUUID(),
      stateFingerprint: this.fingerprint(`login:${state}`),
      sealedPayload: encryptString(
        this.options.encryptionSecret,
        JSON.stringify({ nonce, codeVerifier }),
      ),
      returnTo: validReturnTo(returnTo),
      createdAt: date(now),
      expiresAt: date(now + this.options.loginTransactionTtlMs),
      consumedAt: null,
    });
    return { state, nonce, codeVerifier };
  }

  consumeLogin(state: string): {
    nonce: string;
    codeVerifier: string;
    returnTo: string;
  } {
    const record = this.repository.consumeLoginTransaction(
      this.fingerprint(`login:${state}`),
      date(this.now()),
    );
    if (!record) throw new WorkspaceAccessError("invalid_state");
    try {
      const parsed = JSON.parse(
        decryptString(this.options.encryptionSecret, record.sealedPayload),
      ) as { nonce?: unknown; codeVerifier?: unknown };
      if (
        typeof parsed.nonce !== "string" ||
        typeof parsed.codeVerifier !== "string"
      ) {
        throw new Error("invalid_transaction");
      }
      return {
        nonce: parsed.nonce,
        codeVerifier: parsed.codeVerifier,
        returnTo: record.returnTo,
      };
    } catch {
      throw new WorkspaceAccessError("invalid_state");
    }
  }

  async establishSession(
    identity: OidcWorkspaceIdentity,
    idToken: string | null,
  ): Promise<{ token: string; principal: WorkspacePrincipal }> {
    const entitlement = await this.entitlements.resolve(identity.userId);
    if (!isActiveEntitlement(entitlement)) {
      throw new WorkspaceAccessError("account_inactive");
    }
    if (!entitlement.canManage && entitlement.organizations.length === 0) {
      throw new WorkspaceAccessError("access_denied");
    }

    const now = this.now();
    const token = randomBase64Url(48);
    const csrfToken = this.csrfToken(token);
    const record: WebSessionRecord = {
      id: crypto.randomUUID(),
      tokenFingerprint: this.fingerprint(`session:${token}`),
      userId: identity.userId,
      displayName: identity.displayName,
      picture: identity.picture,
      csrfFingerprint: this.fingerprint(`csrf:${csrfToken}`),
      sealedIdToken: idToken
        ? encryptString(this.options.encryptionSecret, idToken)
        : null,
      authenticatedAt: date(now),
      createdAt: date(now),
      lastSeenAt: date(now),
      idleExpiresAt: date(now + this.options.sessionIdleTtlMs),
      absoluteExpiresAt: date(now + this.options.sessionAbsoluteTtlMs),
      revokedAt: null,
    };
    this.repository.upsertIdentity(identity, date(now));
    this.repository.revokeSessionsByUser(identity.userId, date(now));
    this.repository.insertSession(record);
    return {
      token,
      principal: this.sessionPrincipal(record, entitlement, csrfToken),
    };
  }

  async resolveSession(token: string | null): Promise<WorkspacePrincipal> {
    if (!token) throw new WorkspaceAccessError("unauthenticated");
    const record = this.repository.findSessionByFingerprint(
      this.fingerprint(`session:${token}`),
    );
    const now = this.now();
    if (
      !record ||
      record.revokedAt ||
      Date.parse(record.idleExpiresAt) <= now ||
      Date.parse(record.absoluteExpiresAt) <= now
    ) {
      throw new WorkspaceAccessError("unauthenticated");
    }
    const csrfToken = this.csrfToken(token);
    if (
      !safeStringEqual(
        record.csrfFingerprint,
        this.fingerprint(`csrf:${csrfToken}`),
      )
    ) {
      this.repository.revokeSession(record.id, date(now));
      throw new WorkspaceAccessError("unauthenticated");
    }
    const entitlement = await this.entitlements.resolve(record.userId);
    if (!isActiveEntitlement(entitlement)) {
      this.repository.revokeSession(record.id, date(now));
      throw new WorkspaceAccessError("account_inactive");
    }
    if (!entitlement.canManage && entitlement.organizations.length === 0) {
      this.repository.revokeSession(record.id, date(now));
      throw new WorkspaceAccessError("access_denied");
    }
    const idleExpiresAt = date(Math.min(
      now + this.options.sessionIdleTtlMs,
      Date.parse(record.absoluteExpiresAt),
    ));
    this.repository.touchSession(
      record.id,
      date(now),
      idleExpiresAt,
    );
    return this.sessionPrincipal(
      { ...record, lastSeenAt: date(now), idleExpiresAt },
      entitlement,
      csrfToken,
    );
  }

  revokeSession(principal: WorkspacePrincipal): void {
    if (principal.kind !== "session") return;
    this.repository.revokeSession(principal.actorId, date(this.now()));
  }

  sessionIdToken(principal: WorkspacePrincipal): string | null {
    if (principal.kind !== "session") return null;
    const record = this.repository.findSessionById(principal.actorId);
    if (!record?.sealedIdToken) return null;
    try {
      return decryptString(
        this.options.encryptionSecret,
        record.sealedIdToken,
      );
    } catch {
      return null;
    }
  }

  sessionView(principal: WorkspacePrincipal): WorkspaceSession {
    if (principal.kind !== "session") {
      throw new WorkspaceAccessError("unauthenticated");
    }
    return {
      authenticated: true,
      displayName: principal.displayName,
      picture: principal.picture,
      organizations: principal.organizations,
      canManage: principal.canManage,
      csrfToken: principal.csrfToken,
      authenticatedAt: principal.authenticatedAt,
      expiresAt: principal.expiresAt,
    };
  }

  assertCsrf(principal: WorkspacePrincipal, csrfToken: string | null): void {
    if (
      principal.kind !== "session" ||
      !csrfToken ||
      !safeStringEqual(principal.csrfToken, csrfToken)
    ) {
      throw new WorkspaceAccessError("invalid_csrf");
    }
  }

  assertRecentAuthentication(principal: WorkspacePrincipal): void {
    if (
      principal.kind !== "session" ||
      this.now() - Date.parse(principal.authenticatedAt) >
        this.options.recentAuthTtlMs
    ) {
      throw new WorkspaceAccessError("recent_auth_required");
    }
  }

  async resolveCredential(plaintext: string | null): Promise<WorkspacePrincipal> {
    const normalized = plaintext?.trim() ?? "";
    const prefix = credentialPrefix(normalized);
    if (!prefix) throw new WorkspaceAccessError("invalid_credential");
    const record = this.repository.findCredentialByPrefix(prefix);
    const now = this.now();
    if (
      !record ||
      record.revokedAt ||
      (record.expiresAt && Date.parse(record.expiresAt) <= now) ||
      !safeStringEqual(
        record.credentialFingerprint,
        this.fingerprint(`credential:${normalized}`),
      )
    ) {
      throw new WorkspaceAccessError("invalid_credential");
    }
    const entitlement = await this.entitlements.resolve(record.ownerUserId);
    if (!isActiveEntitlement(entitlement)) {
      throw new WorkspaceAccessError("account_inactive");
    }
    if (
      !entitlement.organizations.some(
        (organization) => organization.organizationId === record.organizationId,
      )
    ) {
      throw new WorkspaceAccessError("organization_unavailable");
    }
    this.repository.touchCredential(record.id, date(now));
    return {
      kind: "credential",
      actorId: record.id,
      ownerUserId: record.ownerUserId,
      organizationId: record.organizationId,
      organizationName: record.organizationName,
      scopes: record.scopes,
    };
  }

  createCredential(
    principal: WorkspacePrincipal,
    input: CreateProgrammaticCredential,
  ): { credential: ProgrammaticCredential; plaintext: string } {
    if (principal.kind !== "session") {
      throw new WorkspaceAccessError("unauthenticated");
    }
    this.assertRecentAuthentication(principal);
    if (input.confirmation !== input.name) {
      throw new WorkspaceAccessError("confirmation_mismatch");
    }
    const organization = principal.organizations.find(
      (entry) => entry.organizationId === input.organizationId,
    );
    if (!organization && !principal.canManage) {
      throw new WorkspaceAccessError("organization_unavailable");
    }
    const scopes = [...new Set(input.scopes)];
    if (
      scopes.length === 0 ||
      scopes.some(
        (scope) => !MEMBER_CAPABILITIES.has(scope as WorkspaceCapability),
      )
    ) {
      throw new WorkspaceAccessError("invalid_scope");
    }
    const now = this.now();
    const expiresAt = input.expiresAt ?? null;
    if (
      expiresAt &&
      (Date.parse(expiresAt) <= now ||
        Date.parse(expiresAt) > now + this.options.maxCredentialTtlMs)
    ) {
      throw new WorkspaceAccessError("invalid_scope");
    }
    const counts = this.repository.countActiveCredentials(
      principal.userId,
      input.organizationId,
      date(now),
    );
    if (
      counts.user >= this.options.maxCredentialsPerUser ||
      counts.organization >= this.options.maxCredentialsPerOrganization
    ) {
      throw new WorkspaceAccessError("quota_exceeded");
    }
    if (
      !this.repository.consumeCredentialCreationRateLimit(
        this.fingerprint(`credential-creation:${principal.userId}`),
        date(now).slice(0, 13),
        this.options.credentialCreationsPerHour,
      )
    ) {
      throw new WorkspaceAccessError("rate_limited");
    }

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const prefix = randomBytes(4).toString("hex");
      if (this.repository.findCredentialByPrefix(prefix)) continue;
      const secret = randomBase64Url(32);
      const plaintext = `fia_${prefix}_${secret}`;
      const credential: ProgrammaticCredentialRecord = {
        id: crypto.randomUUID(),
        ownerUserId: principal.userId,
        organizationId: input.organizationId,
        organizationName: organization?.name ?? input.organizationId,
        name: input.name,
        prefix,
        suffix: plaintext.slice(-4),
        credentialFingerprint: this.fingerprint(`credential:${plaintext}`),
        scopes: scopes as ProgrammaticCredentialScope[],
        generation: 1,
        createdAt: date(now),
        authorizedAt: date(now),
        lastUsedAt: null,
        expiresAt,
        revokedAt: null,
      };
      this.repository.insertCredential(credential);
      this.receipt(
        principal,
        "credentials.manage",
        input.organizationId,
        "credential",
        credential.id,
        "completed",
      );
      return { credential: this.credentialView(credential), plaintext };
    }
    throw new WorkspaceAccessError("quota_exceeded");
  }

  listCredentials(principal: WorkspacePrincipal): ProgrammaticCredential[] {
    if (principal.kind !== "session") {
      throw new WorkspaceAccessError("unauthenticated");
    }
    return this.repository
      .listCredentialsByOwner(principal.userId)
      .map((record) => this.credentialView(record));
  }

  listAllCredentials(principal: WorkspacePrincipal): ProgrammaticCredential[] {
    this.authorize(principal, "credentials.admin");
    return this.repository
      .listCredentials()
      .map((record) => this.credentialView(record));
  }

  credentialActivity(
    principal: WorkspacePrincipal,
    limit = 100,
  ): AccessReceipt[] {
    if (principal.kind !== "session") {
      throw new WorkspaceAccessError("unauthenticated");
    }
    const actorFingerprints = this.repository
      .listCredentialsByOwner(principal.userId)
      .map((credential) =>
        this.fingerprint(`actor:credential:${credential.id}`).slice(0, 16),
      );
    return this.repository.listAccessReceiptsForActors(
      actorFingerprints,
      Math.min(500, Math.max(1, limit)),
    );
  }

  revokeCredential(principal: WorkspacePrincipal, id: string): ProgrammaticCredential {
    const existing = this.repository
      .listCredentials()
      .find((record) => record.id === id);
    if (!existing) throw new WorkspaceAccessError("not_found");
    const owner =
      principal.kind === "session" && principal.userId === existing.ownerUserId;
    if (!owner) this.authorize(principal, "credentials.admin");
    const revoked = this.repository.revokeCredential(id, date(this.now()));
    if (!revoked) throw new WorkspaceAccessError("not_found");
    this.receipt(
      principal,
      owner ? "credentials.manage" : "credentials.admin",
      existing.organizationId,
      "credential",
      id,
      "revoked",
    );
    return this.credentialView(revoked);
  }

  authorize(
    principal: WorkspacePrincipal,
    capability: WorkspaceCapability,
    organizationId?: string | null,
  ): void {
    let allowed = principal.kind === "operator";
    if (principal.kind === "session") {
      allowed =
        principal.canManage ||
        (MEMBER_CAPABILITIES.has(capability) &&
          (!organizationId ||
            principal.organizations.some(
              (entry) => entry.organizationId === organizationId,
            )));
    }
    if (principal.kind === "credential") {
      allowed =
        principal.scopes.includes(capability as ProgrammaticCredentialScope) &&
        (!organizationId || principal.organizationId === organizationId);
    }
    if (!allowed) throw new WorkspaceAccessError("access_denied");
  }

  organization(
    principal: WorkspacePrincipal,
    organizationId: string,
  ): { id: string; name: string } {
    if (principal.kind === "session") {
      const organization = principal.organizations.find(
        (entry) => entry.organizationId === organizationId,
      );
      if (organization) {
        return { id: organization.organizationId, name: organization.name };
      }
    }
    if (
      principal.kind === "credential" &&
      principal.organizationId === organizationId
    ) {
      return { id: principal.organizationId, name: principal.organizationName };
    }
    throw new WorkspaceAccessError("organization_unavailable");
  }

  archiveAttribution(
    principal: WorkspacePrincipal,
    organizationId: string,
  ): {
    organizationId: string;
    organizationName: string;
    uploaderFingerprint: string;
    actorKind: "session" | "credential" | "operator";
    actorIdFingerprint: string;
  } {
    this.authorize(principal, "subtitles.write", organizationId);
    const organization = this.organization(principal, organizationId);
    return {
      organizationId: organization.id,
      organizationName: organization.name,
      uploaderFingerprint: this.fingerprint(
        `uploader:${principal.kind}:${
          principal.kind === "session"
            ? principal.userId
            : principal.kind === "credential"
              ? principal.ownerUserId
              : principal.actorId
        }`,
      ).slice(0, 16),
      actorKind: principal.kind,
      actorIdFingerprint: this.fingerprint(
        `actor:${principal.kind}:${principal.actorId}`,
      ).slice(0, 16),
    };
  }

  receipts(principal: WorkspacePrincipal, limit = 100): AccessReceipt[] {
    this.authorize(principal, "system.manage");
    return this.repository.listAccessReceipts(Math.min(500, Math.max(1, limit)));
  }

  recordAccess(input: {
    principal: WorkspacePrincipal;
    capability: WorkspaceCapability;
    organizationId?: string | null;
    resourceType: AccessReceipt["resourceType"];
    resourceId?: string | null;
    outcome: AccessReceipt["outcome"];
  }): void {
    this.receipt(
      input.principal,
      input.capability,
      input.organizationId ?? null,
      input.resourceType,
      input.resourceId ?? null,
      input.outcome,
    );
  }

  operatorPrincipal(): WorkspacePrincipal {
    return { kind: "operator", actorId: "fontinass-operator" };
  }

  private sessionPrincipal(
    record: WebSessionRecord,
    entitlement: FontInAssEntitlementResponse,
    csrfToken: string,
  ): WorkspacePrincipal {
    return {
      kind: "session",
      actorId: record.id,
      userId: record.userId,
      displayName: record.displayName,
      picture: record.picture,
      organizations: entitlement.organizations,
      canManage: entitlement.canManage,
      authenticatedAt: record.authenticatedAt,
      expiresAt: record.idleExpiresAt,
      csrfToken,
    };
  }

  private csrfToken(sessionToken: string): string {
    return keyedFingerprint(
      this.options.fingerprintSecret,
      `csrf-token:${sessionToken}`,
    );
  }

  private fingerprint(value: string): string {
    return keyedFingerprint(this.options.fingerprintSecret, value);
  }

  private credentialView(
    record: ProgrammaticCredentialRecord,
  ): ProgrammaticCredential {
    const { ownerUserId: _owner, credentialFingerprint: _fingerprint, ...view } =
      record;
    return view;
  }

  private receipt(
    principal: WorkspacePrincipal,
    capability: WorkspaceCapability,
    organizationId: string | null,
    resourceType: AccessReceipt["resourceType"],
    resourceId: string | null,
    outcome: AccessReceipt["outcome"],
  ): void {
    this.repository.insertAccessReceipt({
      id: crypto.randomUUID(),
      actorKind: principal.kind,
      actorFingerprint: this.fingerprint(
        `actor:${principal.kind}:${principal.actorId}`,
      ).slice(0, 16),
      organizationId,
      capability,
      resourceType,
      resourceFingerprint: resourceId
        ? this.fingerprint(`resource:${resourceType}:${resourceId}`).slice(0, 16)
        : null,
      outcome,
      createdAt: date(this.now()),
    });
  }
}
