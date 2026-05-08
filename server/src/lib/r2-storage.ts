/**
 * Cloudflare R2 storage layer using aws4fetch (lightweight, Bun-compatible).
 * Used for storing published subtitle archive zip files.
 */

import { AwsClient } from "aws4fetch";
import { config, log } from "../config.js";

let _client: AwsClient | null = null;

function getClient(): AwsClient {
  if (_client) return _client;
  if (!config.r2AccountId || !config.r2AccessKeyId || !config.r2SecretAccessKey) {
    throw new Error("R2 credentials not configured (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)");
  }
  _client = new AwsClient({
    accessKeyId: config.r2AccessKeyId,
    secretAccessKey: config.r2SecretAccessKey,
    region: "auto",
    service: "s3",
  });
  return _client;
}

function endpoint(key: string): string {
  // Each path segment must be percent-encoded so characters like `#`, `?`,
  // spaces, `[`, `]` and non-ASCII (CJK) don't get reinterpreted by the URL
  // parser (e.g. `#` becoming a fragment, `?` introducing a query). When the
  // path is mis-parsed R2 sees a bucket-level request and returns MalformedXML.
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `https://${config.r2AccountId}.r2.cloudflarestorage.com/${config.r2BucketName}/${encoded}`;
}

/** Check if R2 is configured (all required env vars present). */
export function isR2Configured(): boolean {
  return !!(config.r2AccountId && config.r2AccessKeyId && config.r2SecretAccessKey && config.r2BucketName);
}

/** Upload a file to R2. */
export async function r2Upload(
  key: string,
  body: Buffer | ReadableStream | Uint8Array,
  contentType = "application/octet-stream",
  contentLength?: number,
): Promise<void> {
  const client = getClient();
  const headers: Record<string, string> = { "Content-Type": contentType };
  if (contentLength != null) headers["Content-Length"] = String(contentLength);

  const resp = await client.fetch(endpoint(key), {
    method: "PUT",
    headers,
    body,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`R2 upload failed (${resp.status}): ${text}`);
  }
  log("debug", `[r2] uploaded ${key}`);
}

/** Download a file from R2. Returns the body as a readable stream. */
export async function r2Download(key: string): Promise<{ body: ReadableStream; contentLength: number }> {
  const client = getClient();
  const resp = await client.fetch(endpoint(key), { method: "GET" });
  if (!resp.ok) throw new Error(`R2 object not found: ${key} (${resp.status})`);
  return {
    body: resp.body!,
    contentLength: Number(resp.headers.get("content-length") ?? 0),
  };
}

/** Delete a file from R2. */
export async function r2Delete(key: string): Promise<void> {
  const client = getClient();
  const resp = await client.fetch(endpoint(key), { method: "DELETE" });
  if (!resp.ok && resp.status !== 404) {
    const text = await resp.text();
    throw new Error(`R2 delete failed (${resp.status}): ${text}`);
  }
  log("debug", `[r2] deleted ${key}`);
}

/** Check if a file exists in R2. */
export async function r2Exists(key: string): Promise<boolean> {
  const client = getClient();
  try {
    const resp = await client.fetch(endpoint(key), { method: "HEAD" });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Move an object in R2 (download + re-upload + delete source).
 */
export async function r2Move(sourceKey: string, targetKey: string): Promise<void> {
  const { body } = await r2Download(sourceKey);
  const chunks: Uint8Array[] = [];
  const reader = (body as ReadableStream<Uint8Array>).getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const buf = Buffer.concat(chunks);
  await r2Upload(targetKey, buf, "application/zip", buf.length);
  await r2Delete(sourceKey);
  log("debug", `[r2] moved ${sourceKey} → ${targetKey}`);
}
