import { describe, expect, test } from "bun:test";
import type { ApiTokenRecord, UploadRequestContext } from "@fontinass/access-control";
import type { ApiUploadResult } from "@fontinass/contracts";
import { FontSubmission, FontSubmissionError, type FontContributionCatalog, type UploadAccessPort } from "./index.js";

const token: ApiTokenRecord = {
  id: "token-1", application_id: null, name: "Uploader", prefix: "0123abcd", token_hash: "hash", enabled: true,
  note: null, request_count: 0, accepted_file_count: 0, accepted_bytes: 0, last_used_at: null,
  last_used_ip: null, created_at: new Date().toISOString(), revoked_at: null, expires_at: null,
};

class FakeAccess implements UploadAccessPort {
  recorded: { tokenId: string; results: ApiUploadResult[]; context: UploadRequestContext } | null = null;
  allowed = true;

  authenticate(plaintext: string) { return plaintext === "valid" ? token : null; }
  consumePublicUploadRateLimit() { return this.allowed; }
  recordSubmission(tokenId: string, results: ApiUploadResult[], context: UploadRequestContext) {
    this.recorded = { tokenId, results, context };
  }
}

const catalog: FontContributionCatalog = {
  async contribute(filename) {
    return filename.startsWith("duplicate")
      ? { filename, status: "duplicate", fontId: "font-old", faces: 2, sha256: "a".repeat(64), error: null }
      : { filename, status: "success", fontId: "font-new", faces: 1, sha256: "b".repeat(64), error: null };
  },
};

function createSubmission(access = new FakeAccess()) {
  return { access, submission: new FontSubmission(access, catalog, {
    targetDirectory: "uploads/", maxFiles: 2, maxFileBytes: 10, maxBatchBytes: 15, concurrency: 2,
  }) };
}

describe("FontSubmission", () => {
  test("authenticates member submissions, contributes and records one batch through its interface", async () => {
    const { access, submission } = createSubmission();
    const result = await submission.submitCredentialed({
      credential: "valid",
      files: [
        { filename: "fresh.ttf", bytes: new Uint8Array(4) },
        { filename: "duplicate.ttf", bytes: new Uint8Array(5) },
      ],
      context: { clientIp: "127.0.0.1", userAgent: "test" },
    });

    expect(result.summary).toEqual({ accepted: 1, duplicate: 1, rejected: 0, error: 0 });
    expect(access.recorded?.tokenId).toBe(token.id);
    expect(access.recorded?.results).toHaveLength(2);
  });

  test("keeps member uploads outside public file and batch limits", async () => {
    const { submission } = createSubmission();
    await expect(submission.submitCredentialed({ credential: "invalid", files: [{ filename: "a.ttf", bytes: new Uint8Array(1) }], context: { clientIp: null, userAgent: null } }))
      .rejects.toMatchObject({ code: "invalid_token" } satisfies Partial<FontSubmissionError>);
    const result = await submission.submitCredentialed({ credential: "valid", files: [
      { filename: "a.ttf", bytes: new Uint8Array(8) }, { filename: "b.ttf", bytes: new Uint8Array(8) },
      { filename: "c.ttf", bytes: new Uint8Array(11) },
    ], context: { clientIp: null, userAgent: null } });
    expect(result.results).toHaveLength(3);
  });

  test("enforces file, batch and IP rate limits only for public submissions", async () => {
    const { access, submission } = createSubmission();
    await expect(submission.submitPublic({
      rateLimitKey: "ip-a", files: [{ filename: "a.ttf", bytes: new Uint8Array(11) }], context: { clientIp: null, userAgent: null },
    })).rejects.toMatchObject({ code: "file_too_large" } satisfies Partial<FontSubmissionError>);
    await expect(submission.submitPublic({
      rateLimitKey: "ip-a", files: [
        { filename: "a.ttf", bytes: new Uint8Array(8) }, { filename: "b.ttf", bytes: new Uint8Array(8) },
      ], context: { clientIp: null, userAgent: null },
    })).rejects.toMatchObject({ code: "batch_too_large" } satisfies Partial<FontSubmissionError>);
    access.allowed = false;
    await expect(submission.submitPublic({
      rateLimitKey: "ip-a", files: [{ filename: "a.ttf", bytes: new Uint8Array(1) }], context: { clientIp: null, userAgent: null },
    }))
      .rejects.toMatchObject({ code: "rate_limited" } satisfies Partial<FontSubmissionError>);
    expect(access.recorded).toBeNull();
  });
});
