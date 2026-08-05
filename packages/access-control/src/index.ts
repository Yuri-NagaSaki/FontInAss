import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type {
  ApiHistoryResponse,
  ApiToken,
  ApiTokenApplication,
  ApiTokenApplicationAdmin,
  ApiTokenApplicationList,
  ApiTokenApplicationStatus,
  ApiTokenStats,
  ApiUploadResult,
  ApiUploadStatus,
  CreateApiToken,
  CreateApiTokenApplication,
  ReviewApiTokenApplication,
  UpdateApiToken,
} from "@fontinass/contracts";

const TOKEN_NAMESPACE = "fia";
const TOKEN_PREFIX_LENGTH = 8;

export interface ApiTokenRecord extends ApiToken {
  token_hash: string;
}

export interface ApiTokenApplicationRecord extends ApiTokenApplicationAdmin {
  credential_hash: string;
}

export interface UploadRequestContext {
  clientIp: string | null;
  userAgent: string | null;
}

export interface UploadAccessRepository {
  listTokens(): ApiTokenRecord[];
  findTokenById(id: string): ApiTokenRecord | null;
  findTokenByPrefix(prefix: string): ApiTokenRecord | null;
  insertToken(record: ApiTokenRecord): void;
  updateToken(id: string, patch: UpdateApiToken): ApiTokenRecord | null;
  revokeToken(id: string): ApiTokenRecord | null;

  insertApplication(record: ApiTokenApplicationRecord): void;
  findApplicationById(id: string): ApiTokenApplicationRecord | null;
  findApplicationByCredentialPrefix(prefix: string): ApiTokenApplicationRecord | null;
  listApplications(query: { status?: ApiTokenApplicationStatus; page: number; limit: number }): ApiTokenApplicationList;
  reviewApplication(id: string, input: ReviewApiTokenApplication, reviewedAt: string): ApiTokenApplicationRecord | null;
  claimApplication(id: string, token: ApiTokenRecord, claimedAt: string): { application: ApiTokenApplicationRecord; token: ApiTokenRecord } | null;

  consumeApplicationRateLimit(ipHash: string, date: string, limit: number): boolean;
  consumePublicUploadRateLimit(ipHash: string, minute: string, limit: number): boolean;
  recordSubmission(tokenId: string, results: ApiUploadResult[], context: UploadRequestContext, uploadedAt: string): void;
  listHistory(query: { tokenId?: string; status?: ApiUploadStatus; page: number; limit: number }): ApiHistoryResponse;
  stats(): ApiTokenStats;
}

export interface UploadAccessOptions {
  applicationDailyLimit: number;
  publicUploadRequestsPerMinute: number;
}

export type UploadAccessErrorCode = "not_found" | "invalid_secret" | "invalid_state" | "rate_limited" | "conflict";

export class UploadAccessError extends Error {
  constructor(message: string, readonly code: UploadAccessErrorCode) {
    super(message);
  }
}

export class UploadAccess {
  constructor(
    private readonly repository: UploadAccessRepository,
    private readonly options: UploadAccessOptions,
  ) {}

  listTokens(): ApiToken[] {
    return this.repository.listTokens().map(toTokenView);
  }

  findToken(id: string): ApiToken | null {
    const record = this.repository.findTokenById(id);
    return record ? toTokenView(record) : null;
  }

  issue(input: CreateApiToken): { token: ApiToken; plaintext: string } {
    const { plaintext, prefix } = this.generateCredential();
    const record = this.tokenRecord(input, plaintext, prefix, null);
    this.repository.insertToken(record);
    return { token: toTokenView(record), plaintext };
  }

  update(id: string, patch: UpdateApiToken): ApiToken | null {
    const record = this.repository.updateToken(id, patch);
    return record ? toTokenView(record) : null;
  }

  revoke(id: string): ApiToken | null {
    const record = this.repository.revokeToken(id);
    return record ? toTokenView(record) : null;
  }

  authenticate(plaintext: string): ApiTokenRecord | null {
    const prefix = parseTokenPrefix(plaintext);
    if (!prefix) return null;
    const record = this.repository.findTokenByPrefix(prefix);
    if (!record?.enabled || record.revoked_at || !safeEqual(hash(plaintext), record.token_hash)) return null;
    if (record.expires_at && Date.parse(record.expires_at) <= Date.now()) return null;
    return record;
  }

  apply(input: CreateApiTokenApplication, requestIpHash: string): { application: ApiTokenApplication; recovery_secret: string } {
    const now = new Date().toISOString();
    if (!this.repository.consumeApplicationRateLimit(requestIpHash, now.slice(0, 10), this.options.applicationDailyLimit)) {
      throw new UploadAccessError("Application rate limit exceeded", "rate_limited");
    }
    const { plaintext, prefix } = this.generateCredential();
    const record: ApiTokenApplicationRecord = {
      id: crypto.randomUUID(),
      applicant_name: input.applicant_name.trim(),
      contact: input.contact.trim(),
      purpose: input.purpose.trim(),
      expected_volume: input.expected_volume?.trim() || null,
      status: "pending",
      credential_prefix: prefix,
      credential_hash: hash(plaintext),
      public_note: null,
      admin_note: null,
      request_ip_hash: requestIpHash,
      token_id: null,
      created_at: now,
      updated_at: now,
      reviewed_at: null,
      claimed_at: null,
    };
    this.repository.insertApplication(record);
    return { application: toApplicationView(record), recovery_secret: plaintext };
  }

  applicationStatus(id: string, secret: string): ApiTokenApplication {
    const application = this.requireApplicationSecret(id, secret);
    return toApplicationView(application);
  }

  listApplications(query: { status?: ApiTokenApplicationStatus; page?: number; limit?: number }): ApiTokenApplicationList {
    return this.repository.listApplications({
      status: query.status,
      page: Math.max(1, query.page ?? 1),
      limit: Math.min(200, Math.max(1, query.limit ?? 50)),
    });
  }

  review(id: string, input: ReviewApiTokenApplication): ApiTokenApplicationAdmin {
    const reviewed = this.repository.reviewApplication(id, input, new Date().toISOString());
    if (!reviewed) {
      const existing = this.repository.findApplicationById(id);
      if (!existing) throw new UploadAccessError("Application not found", "not_found");
      throw new UploadAccessError("Application is no longer pending", "invalid_state");
    }
    return toApplicationAdminView(reviewed);
  }

  claim(id: string, secret: string): { application: ApiTokenApplication; token: ApiToken; plaintext: string } {
    const application = this.requireApplicationSecret(id, secret);
    if (application.status === "claimed" && application.token_id) {
      const existing = this.repository.findTokenById(application.token_id);
      if (!existing) throw new UploadAccessError("Claimed credential is missing", "conflict");
      return { application: toApplicationView(application), token: toTokenView(existing), plaintext: secret };
    }
    if (application.status !== "approved") throw new UploadAccessError("Application is not approved", "invalid_state");

    const token = this.tokenRecord(
      { name: application.applicant_name, note: `Application ${application.id}`, enabled: true, expires_at: null },
      secret,
      application.credential_prefix,
      application.id,
    );
    const claimed = this.repository.claimApplication(application.id, token, new Date().toISOString());
    if (!claimed) throw new UploadAccessError("Application state changed before claim", "conflict");
    return { application: toApplicationView(claimed.application), token: toTokenView(claimed.token), plaintext: secret };
  }

  consumePublicUploadRateLimit(ipHash: string, now = new Date()): boolean {
    return this.repository.consumePublicUploadRateLimit(
      ipHash,
      now.toISOString().slice(0, 16),
      this.options.publicUploadRequestsPerMinute,
    );
  }

  recordSubmission(tokenId: string, results: ApiUploadResult[], context: UploadRequestContext): void {
    this.repository.recordSubmission(tokenId, results, context, new Date().toISOString());
  }

  history(query: { tokenId?: string; status?: ApiUploadStatus; page?: number; limit?: number }): ApiHistoryResponse {
    return this.repository.listHistory({
      ...query,
      page: Math.max(1, query.page ?? 1),
      limit: Math.min(200, Math.max(1, query.limit ?? 50)),
    });
  }

  stats(): ApiTokenStats {
    return this.repository.stats();
  }

  private requireApplicationSecret(id: string, secret: string): ApiTokenApplicationRecord {
    const application = this.repository.findApplicationById(id);
    if (!application) throw new UploadAccessError("Application not found", "not_found");
    const prefix = parseTokenPrefix(secret);
    if (prefix !== application.credential_prefix || !safeEqual(hash(secret), application.credential_hash)) {
      throw new UploadAccessError("Invalid application secret", "invalid_secret");
    }
    return application;
  }

  private generateCredential(): { plaintext: string; prefix: string } {
    for (let attempt = 0; attempt < 10; attempt++) {
      const prefix = randomBytes(4).toString("hex");
      if (this.repository.findTokenByPrefix(prefix) || this.repository.findApplicationByCredentialPrefix(prefix)) continue;
      return { plaintext: `${TOKEN_NAMESPACE}_${prefix}_${randomBytes(24).toString("base64url")}`, prefix };
    }
    throw new UploadAccessError("Could not allocate a unique credential prefix", "conflict");
  }

  private tokenRecord(input: CreateApiToken, plaintext: string, prefix: string, applicationId: string | null): ApiTokenRecord {
    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      application_id: applicationId,
      name: input.name.trim(),
      prefix,
      token_hash: hash(plaintext),
      enabled: input.enabled,
      note: input.note?.trim() || null,
      request_count: 0,
      accepted_file_count: 0,
      accepted_bytes: 0,
      last_used_at: null,
      last_used_ip: null,
      created_at: now,
      revoked_at: input.enabled ? null : now,
      expires_at: input.expires_at ?? null,
    };
  }
}

export function extractUploadToken(uploadHeader?: string | null, authorization?: string | null): string | null {
  if (uploadHeader?.trim()) return uploadHeader.trim();
  return authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
}

export function parseTokenPrefix(plaintext: string): string | null {
  const namespace = `${TOKEN_NAMESPACE}_`;
  if (!plaintext.startsWith(namespace)) return null;
  const prefixStart = namespace.length;
  const prefixEnd = prefixStart + TOKEN_PREFIX_LENGTH;
  if (plaintext.length <= prefixEnd + 1 || plaintext[prefixEnd] !== "_") return null;
  const prefix = plaintext.slice(prefixStart, prefixEnd);
  return /^[0-9a-f]{8}$/.test(prefix) ? prefix : null;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  try {
    const a = Buffer.from(left, "hex");
    const b = Buffer.from(right, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function toTokenView({ token_hash: _hash, ...view }: ApiTokenRecord): ApiToken {
  return view;
}

function toApplicationView({ credential_hash: _hash, admin_note: _admin, request_ip_hash: _ip, ...view }: ApiTokenApplicationRecord): ApiTokenApplication {
  return view;
}

function toApplicationAdminView({ credential_hash: _hash, ...view }: ApiTokenApplicationRecord): ApiTokenApplicationAdmin {
  return view;
}
