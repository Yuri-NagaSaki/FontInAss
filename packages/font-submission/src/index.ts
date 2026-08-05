import type { ApiUploadResponse, ApiUploadResult } from "@fontinass/contracts";
import type { ApiTokenRecord, UploadRequestContext } from "@fontinass/access-control";
import type { FontContributionResult } from "@fontinass/font-catalog";

export interface SubmittedFont {
  filename: string;
  bytes: Uint8Array;
}

export interface UploadAccessPort {
  authenticate(plaintext: string): ApiTokenRecord | null;
  consumePublicUploadRateLimit(ipHash: string): boolean;
  recordSubmission(tokenId: string, results: ApiUploadResult[], context: UploadRequestContext): void;
}

export interface FontContributionCatalog {
  contribute(filename: string, bytes: Uint8Array, targetDirectory: string): Promise<FontContributionResult>;
}

export interface FontSubmissionOptions {
  targetDirectory: string;
  maxFiles: number;
  maxFileBytes: number;
  maxBatchBytes: number;
  concurrency: number;
}

export type FontSubmissionErrorCode = "invalid_token" | "empty" | "too_many_files" | "file_too_large" | "batch_too_large" | "rate_limited";

export class FontSubmissionError extends Error {
  constructor(message: string, readonly code: FontSubmissionErrorCode) {
    super(message);
  }
}

export class FontSubmission {
  constructor(
    private readonly access: UploadAccessPort,
    private readonly catalog: FontContributionCatalog,
    private readonly options: FontSubmissionOptions,
  ) {}

  async submitPublic(input: {
    files: SubmittedFont[];
    context: UploadRequestContext;
    rateLimitKey: string;
  }): Promise<ApiUploadResponse> {
    this.validatePublicBatch(input.files);
    if (!this.access.consumePublicUploadRateLimit(input.rateLimitKey)) {
      throw new FontSubmissionError("Public upload request rate limit exceeded", "rate_limited");
    }
    return this.contribute(input.files);
  }

  async submitCredentialed(input: {
    credential: string;
    files: SubmittedFont[];
    context: UploadRequestContext;
  }): Promise<ApiUploadResponse> {
    const token = this.access.authenticate(input.credential.trim());
    if (!token) throw new FontSubmissionError("Invalid or inactive upload credential", "invalid_token");
    if (!input.files.length) throw new FontSubmissionError("No font files provided", "empty");

    const response = await this.contribute(input.files);
    this.access.recordSubmission(token.id, response.results, input.context);
    return response;
  }

  private validatePublicBatch(files: SubmittedFont[]): void {
    if (!files.length) throw new FontSubmissionError("No font files provided", "empty");
    if (files.length > this.options.maxFiles) {
      throw new FontSubmissionError(`Too many files (max ${this.options.maxFiles})`, "too_many_files");
    }

    let batchBytes = 0;
    for (const file of files) {
      if (file.bytes.byteLength > this.options.maxFileBytes) {
        throw new FontSubmissionError(`${file.filename} exceeds the per-file upload limit`, "file_too_large");
      }
      batchBytes += file.bytes.byteLength;
    }
    if (batchBytes > this.options.maxBatchBytes) {
      throw new FontSubmissionError("Upload batch exceeds the total size limit", "batch_too_large");
    }
  }

  private async contribute(files: SubmittedFont[]): Promise<ApiUploadResponse> {
    const results: ApiUploadResult[] = new Array(files.length);
    const concurrency = Math.max(1, this.options.concurrency);
    for (let offset = 0; offset < files.length; offset += concurrency) {
      const chunk = files.slice(offset, offset + concurrency);
      const settled = await Promise.all(chunk.map((file) => this.submitOne(file)));
      settled.forEach((result, index) => { results[offset + index] = result; });
    }

    return {
      summary: {
        accepted: results.filter((result) => result.status === "success").length,
        duplicate: results.filter((result) => result.status === "duplicate").length,
        rejected: results.filter((result) => result.status === "rejected").length,
        error: results.filter((result) => result.status === "error").length,
      },
      results,
    };
  }

  private async submitOne(file: SubmittedFont): Promise<ApiUploadResult> {
    try {
      const result = await this.catalog.contribute(file.filename, file.bytes, this.options.targetDirectory);
      return toUploadResult(result, file.bytes.byteLength);
    } catch (error) {
      return {
        filename: file.filename,
        status: "error",
        font_id: null,
        faces: 0,
        size: file.bytes.byteLength,
        sha256: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

function toUploadResult(result: FontContributionResult, size: number): ApiUploadResult {
  return {
    filename: result.filename,
    status: result.status,
    font_id: result.fontId,
    faces: result.faces,
    size,
    sha256: result.sha256,
    error: result.error,
  };
}
