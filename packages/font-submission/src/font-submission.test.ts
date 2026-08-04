import { describe, expect, test } from "bun:test";
import type {
  ApiUploadResult,
  WorkspacePrincipal,
} from "@fontinass/contracts";
import {
  FontSubmission,
  FontSubmissionError,
  type FontContributionCatalog,
  type PublicUploadRateLimitPort,
  type WorkspaceSubmissionAccessPort,
} from "./index.js";

const principal: WorkspacePrincipal = {
  kind: "session",
  actorId: "session-1",
  userId: "user-1",
  displayName: "Member",
  picture: null,
  organizations: [
    {
      organizationId: "org-1",
      name: "Atlas Subs",
      slug: "atlas",
      role: "member",
    },
  ],
  canManage: false,
  authenticatedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  csrfToken: "csrf-token",
};

class FakeAccess
  implements PublicUploadRateLimitPort, WorkspaceSubmissionAccessPort
{
  allowed = true;
  authorized = false;
  receipts: Array<{ resourceId: string | null }> = [];

  consumePublicUploadRateLimit() {
    return this.allowed;
  }

  authorize(
    _principal: WorkspacePrincipal,
    _capability: "fonts.write",
    organizationId: string,
  ) {
    if (organizationId !== "org-1") throw new Error("denied");
    this.authorized = true;
  }

  recordAccess(input: {
    resourceId: string | null;
  }) {
    this.receipts.push({ resourceId: input.resourceId });
  }
}

const catalog: FontContributionCatalog = {
  async contribute(filename) {
    return filename.startsWith("duplicate")
      ? {
          filename,
          status: "duplicate",
          fontId: "font-old",
          faces: 2,
          sha256: "a".repeat(64),
          error: null,
        }
      : {
          filename,
          status: "success",
          fontId: "font-new",
          faces: 1,
          sha256: "b".repeat(64),
          error: null,
        };
  },
};

function createSubmission(access = new FakeAccess()) {
  return {
    access,
    submission: new FontSubmission(access, access, catalog, {
      targetDirectory: "uploads/",
      maxFiles: 2,
      maxFileBytes: 10,
      maxBatchBytes: 15,
      concurrency: 2,
    }),
  };
}

describe("FontSubmission", () => {
  test("authorizes workspace uploads and writes one receipt per result", async () => {
    const { access, submission } = createSubmission();
    const result = await submission.submitAuthorized({
      principal,
      organizationId: "org-1",
      files: [
        { filename: "fresh.ttf", bytes: new Uint8Array(4) },
        { filename: "duplicate.ttf", bytes: new Uint8Array(5) },
      ],
    });

    expect(result.summary).toEqual({
      accepted: 1,
      duplicate: 1,
      rejected: 0,
      error: 0,
    });
    expect(access.authorized).toBeTrue();
    expect(access.receipts).toEqual([
      { resourceId: "font-new" },
      { resourceId: "font-old" },
    ]);
  });

  test("keeps authorized uploads outside public file and batch limits", async () => {
    const { submission } = createSubmission();
    const result = await submission.submitAuthorized({
      principal,
      organizationId: "org-1",
      files: [
        { filename: "a.ttf", bytes: new Uint8Array(8) },
        { filename: "b.ttf", bytes: new Uint8Array(8) },
        { filename: "c.ttf", bytes: new Uint8Array(11) },
      ],
    });
    expect(result.results).toHaveLength(3);
  });

  test("enforces public file, batch and IP limits independently", async () => {
    const { access, submission } = createSubmission();
    await expect(
      submission.submitPublic({
        rateLimitKey: "ip-a",
        files: [{ filename: "a.ttf", bytes: new Uint8Array(11) }],
        context: { clientIp: null, userAgent: null },
      }),
    ).rejects.toMatchObject({
      code: "file_too_large",
    } satisfies Partial<FontSubmissionError>);
    await expect(
      submission.submitPublic({
        rateLimitKey: "ip-a",
        files: [
          { filename: "a.ttf", bytes: new Uint8Array(8) },
          { filename: "b.ttf", bytes: new Uint8Array(8) },
        ],
        context: { clientIp: null, userAgent: null },
      }),
    ).rejects.toMatchObject({
      code: "batch_too_large",
    } satisfies Partial<FontSubmissionError>);
    access.allowed = false;
    await expect(
      submission.submitPublic({
        rateLimitKey: "ip-a",
        files: [{ filename: "a.ttf", bytes: new Uint8Array(1) }],
        context: { clientIp: null, userAgent: null },
      }),
    ).rejects.toMatchObject({
      code: "rate_limited",
    } satisfies Partial<FontSubmissionError>);
    expect(access.receipts).toHaveLength(0);
  });
});
