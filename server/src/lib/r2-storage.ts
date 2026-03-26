/**
 * Cloudflare R2 storage layer using S3-compatible API.
 * Used for storing published subtitle archive zip files.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { config, log } from "../config.js";

let _client: S3Client | null = null;

function getClient(): S3Client {
  if (_client) return _client;
  if (!config.r2AccountId || !config.r2AccessKeyId || !config.r2SecretAccessKey) {
    throw new Error("R2 credentials not configured (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)");
  }
  _client = new S3Client({
    region: "auto",
    endpoint: `https://${config.r2AccountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.r2AccessKeyId,
      secretAccessKey: config.r2SecretAccessKey,
    },
  });
  return _client;
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
  const cmd = new PutObjectCommand({
    Bucket: config.r2BucketName,
    Key: key,
    Body: body,
    ContentType: contentType,
    ...(contentLength != null ? { ContentLength: contentLength } : {}),
  });
  await client.send(cmd);
  log("debug", `[r2] uploaded ${key}`);
}

/** Download a file from R2. Returns the body as a readable stream. */
export async function r2Download(key: string): Promise<{ body: ReadableStream; contentLength: number }> {
  const client = getClient();
  const cmd = new GetObjectCommand({
    Bucket: config.r2BucketName,
    Key: key,
  });
  const resp = await client.send(cmd);
  if (!resp.Body) throw new Error(`R2 object not found: ${key}`);
  return {
    body: resp.Body.transformToWebStream(),
    contentLength: resp.ContentLength ?? 0,
  };
}

/** Delete a file from R2. */
export async function r2Delete(key: string): Promise<void> {
  const client = getClient();
  const cmd = new DeleteObjectCommand({
    Bucket: config.r2BucketName,
    Key: key,
  });
  await client.send(cmd);
  log("debug", `[r2] deleted ${key}`);
}

/** Check if a file exists in R2. */
export async function r2Exists(key: string): Promise<boolean> {
  const client = getClient();
  try {
    await client.send(new HeadObjectCommand({ Bucket: config.r2BucketName, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Move an object in R2 (download + re-upload + delete source).
 * R2 doesn't support server-side copy, so we stream through the server.
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
