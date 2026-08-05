import { describe, expect, test } from "bun:test";
import type {
  ApiHistoryResponse,
  ApiTokenApplicationList,
  ApiTokenApplicationStatus,
  ApiTokenStats,
  ApiUploadResult,
  ApiUploadStatus,
  ReviewApiTokenApplication,
  UpdateApiToken,
} from "@fontinass/contracts";
import {
  UploadAccess,
  UploadAccessError,
  parseTokenPrefix,
  type ApiTokenApplicationRecord,
  type ApiTokenRecord,
  type UploadAccessRepository,
  type UploadRequestContext,
} from "./index.js";

class MemoryUploadAccessRepository implements UploadAccessRepository {
  readonly tokens = new Map<string, ApiTokenRecord>();
  readonly applications = new Map<string, ApiTokenApplicationRecord>();
  readonly history: ApiHistoryResponse["data"] = [];
  readonly applicationLimits = new Map<string, number>();
  readonly publicUploadLimits = new Map<string, number>();

  listTokens() { return [...this.tokens.values()]; }
  findTokenById(id: string) { return this.tokens.get(id) ?? null; }
  findTokenByPrefix(prefix: string) { return [...this.tokens.values()].find((token) => token.prefix === prefix) ?? null; }
  insertToken(record: ApiTokenRecord) { this.tokens.set(record.id, structuredClone(record)); }
  updateToken(id: string, patch: UpdateApiToken) {
    const token = this.tokens.get(id);
    if (!token) return null;
    if (patch.name !== undefined) token.name = patch.name;
    if (patch.note !== undefined) token.note = patch.note ?? null;
    if (patch.expires_at !== undefined) token.expires_at = patch.expires_at ?? null;
    if (patch.enabled !== undefined) { token.enabled = patch.enabled; token.revoked_at = patch.enabled ? null : new Date().toISOString(); }
    return token;
  }
  revokeToken(id: string) { return this.updateToken(id, { enabled: false }); }

  insertApplication(record: ApiTokenApplicationRecord) { this.applications.set(record.id, structuredClone(record)); }
  findApplicationById(id: string) { return this.applications.get(id) ?? null; }
  findApplicationByCredentialPrefix(prefix: string) {
    return [...this.applications.values()].find((application) => application.credential_prefix === prefix) ?? null;
  }
  listApplications(query: { status?: ApiTokenApplicationStatus; page: number; limit: number }): ApiTokenApplicationList {
    const records = [...this.applications.values()].filter((application) => !query.status || application.status === query.status);
    return {
      total: records.length, page: query.page, limit: query.limit,
      data: records.slice((query.page - 1) * query.limit, query.page * query.limit).map(({ credential_hash: _hash, ...view }) => view),
    };
  }
  reviewApplication(id: string, input: ReviewApiTokenApplication, reviewedAt: string) {
    const application = this.applications.get(id);
    if (!application || application.status !== "pending") return null;
    application.status = input.decision === "approve" ? "approved" : "rejected";
    application.public_note = input.public_note?.trim() || null;
    application.admin_note = input.admin_note?.trim() || null;
    application.reviewed_at = reviewedAt;
    application.updated_at = reviewedAt;
    return application;
  }
  claimApplication(id: string, token: ApiTokenRecord, claimedAt: string) {
    const application = this.applications.get(id);
    if (!application || application.status !== "approved" || application.token_id) return null;
    this.insertToken(token);
    application.status = "claimed";
    application.token_id = token.id;
    application.claimed_at = claimedAt;
    application.updated_at = claimedAt;
    return { application, token };
  }

  consumeApplicationRateLimit(ipHash: string, date: string, limit: number) {
    const key = `${ipHash}:${date}`;
    const count = this.applicationLimits.get(key) ?? 0;
    if (count >= limit) return false;
    this.applicationLimits.set(key, count + 1);
    return true;
  }
  consumePublicUploadRateLimit(ipHash: string, minute: string, limit: number) {
    const key = `${ipHash}:${minute}`;
    const count = this.publicUploadLimits.get(key) ?? 0;
    if (count >= limit) return false;
    this.publicUploadLimits.set(key, count + 1);
    return true;
  }
  recordSubmission(tokenId: string, results: ApiUploadResult[], context: UploadRequestContext, uploadedAt: string) {
    const token = this.tokens.get(tokenId);
    if (!token) throw new Error("missing token");
    const accepted = results.filter((result) => result.status === "success" || result.status === "duplicate");
    token.request_count++;
    token.accepted_file_count += accepted.length;
    token.accepted_bytes += accepted.reduce((sum, result) => sum + result.size, 0);
    token.last_used_at = uploadedAt;
    token.last_used_ip = context.clientIp;
    results.forEach((result) => this.history.push({
      id: crypto.randomUUID(), token_id: tokenId, font_file_id: result.font_id, filename: result.filename,
      size: result.size, sha256: result.sha256, status: result.status, error: result.error,
      client_ip: context.clientIp, user_agent: context.userAgent, uploaded_at: uploadedAt,
    }));
  }
  listHistory(query: { tokenId?: string; status?: ApiUploadStatus; page: number; limit: number }): ApiHistoryResponse {
    const filtered = this.history.filter((item) => (!query.tokenId || item.token_id === query.tokenId) && (!query.status || item.status === query.status));
    return { total: filtered.length, page: query.page, limit: query.limit, data: filtered.slice((query.page - 1) * query.limit, query.page * query.limit) };
  }
  stats(): ApiTokenStats {
    return { totals: { tokens: this.tokens.size, active: [...this.tokens.values()].filter((token) => token.enabled).length, pendingApplications: 0, requests: 0, acceptedFiles: 0, bytes: 0 }, byStatus: { success: 0, duplicate: 0, rejected: 0, error: 0 } };
  }
}

function createAccess(repository = new MemoryUploadAccessRepository()) {
  return { repository, access: new UploadAccess(repository, { applicationDailyLimit: 2, publicUploadRequestsPerMinute: 2 }) };
}

describe("UploadAccess", () => {
  test("issues credentials whose generated prefixes always authenticate", () => {
    const { access } = createAccess();
    for (let index = 0; index < 256; index++) {
      const issued = access.issue({ name: `token-${index}`, enabled: true });
      expect(parseTokenPrefix(issued.plaintext)).toBe(issued.token.prefix);
      expect(access.authenticate(issued.plaintext)?.id).toBe(issued.token.id);
    }
  });

  test("runs application, approval and idempotent claim through one interface", () => {
    const { access } = createAccess();
    const receipt = access.apply({
      applicant_name: "Atlas Subs", contact: "contact@example.com",
      purpose: "Upload release fonts for subtitle production", expected_volume: "20 files per month",
    }, "ip-a");

    expect(access.applicationStatus(receipt.application.id, receipt.recovery_secret).status).toBe("pending");
    expect(access.review(receipt.application.id, { decision: "approve", public_note: "Approved" }).status).toBe("approved");

    const claimed = access.claim(receipt.application.id, receipt.recovery_secret);
    expect(claimed.application.status).toBe("claimed");
    expect(access.authenticate(receipt.recovery_secret)?.id).toBe(claimed.token.id);
    expect(access.claim(receipt.application.id, receipt.recovery_secret).token.id).toBe(claimed.token.id);

    expect(access.revoke(claimed.token.id)?.enabled).toBeFalse();
    expect(access.authenticate(receipt.recovery_secret)).toBeNull();
  });

  test("protects application secrets, states and public application rate limits", () => {
    const { access } = createAccess();
    const input = { applicant_name: "A", contact: "a@example.com", purpose: "Upload fonts for a subtitle group" };
    const receipt = access.apply(input, "ip-b");
    expect(() => access.applicationStatus(receipt.application.id, "fia_00000000_invalid-secret-value-that-is-long-enough"))
      .toThrow(UploadAccessError);
    access.review(receipt.application.id, { decision: "reject" });
    expect(() => access.claim(receipt.application.id, receipt.recovery_secret)).toThrow(UploadAccessError);
    access.apply(input, "ip-c");
    access.apply(input, "ip-c");
    expect(() => access.apply(input, "ip-c")).toThrow(UploadAccessError);
  });

  test("rate limits anonymous public uploads independently from member credentials", () => {
    const { access } = createAccess();
    expect(access.consumePublicUploadRateLimit("ip-public", new Date("2026-07-22T08:00:01Z"))).toBeTrue();
    expect(access.consumePublicUploadRateLimit("ip-public", new Date("2026-07-22T08:00:30Z"))).toBeTrue();
    expect(access.consumePublicUploadRateLimit("ip-public", new Date("2026-07-22T08:00:59Z"))).toBeFalse();
    expect(access.consumePublicUploadRateLimit("ip-public", new Date("2026-07-22T08:01:00Z"))).toBeTrue();
  });
});
