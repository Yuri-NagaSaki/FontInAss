/**
 * Configuration loader — reads from Bun environment variables / .env file.
 * Bun automatically loads .env from the current working directory.
 */

import { resolve as resolvePath } from "node:path";

export interface Config {
  port: number;
  apiKey: string;
  fontDir: string;
  dbPath: string;
  corsOrigin: string;
  subsetConcurrency: number;
  cacheMaxEntries: number;
  logLevel: string;
  // R2 sharing
  r2AccountId: string;
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
  r2BucketName: string;
  r2PublicUrl: string;
  // Sharing
  sharingMaxFileSize: number;
  sharingRateLimit: number;
  sharingCacheTtl: number;
  pendingDir: string;
}

function resolve(path: string): string {
  // Always fully resolve so paths with ".." are normalized (important for startsWith security checks)
  return resolvePath(process.cwd(), path);
}

export const config: Config = {
  port:               parseInt(process.env.PORT ?? "3000", 10),
  apiKey:             process.env.API_KEY ?? "",
  fontDir:            resolve(process.env.FONT_DIR ?? "./fonts"),
  dbPath:             resolve(process.env.DB_PATH ?? "./data/fonts.db"),
  corsOrigin:         process.env.CORS_ORIGIN ?? "*",
  subsetConcurrency:  parseInt(process.env.SUBSET_CONCURRENCY ?? "5", 10),
  cacheMaxEntries:    parseInt(process.env.CACHE_MAX_ENTRIES ?? "500", 10),
  logLevel:           process.env.LOG_LEVEL ?? "info",
  // R2
  r2AccountId:        process.env.R2_ACCOUNT_ID ?? "",
  r2AccessKeyId:      process.env.R2_ACCESS_KEY_ID ?? "",
  r2SecretAccessKey:  process.env.R2_SECRET_ACCESS_KEY ?? "",
  r2BucketName:       process.env.R2_BUCKET_NAME ?? "",
  r2PublicUrl:        (process.env.R2_PUBLIC_URL ?? "").replace(/\/+$/, ""),
  // Sharing
  sharingMaxFileSize: parseInt(process.env.SHARING_MAX_FILE_SIZE ?? "209715200", 10),
  sharingRateLimit:   parseInt(process.env.SHARING_RATE_LIMIT ?? "3", 10),
  sharingCacheTtl:    parseInt(process.env.SHARING_CACHE_TTL ?? "300", 10),
  pendingDir:         resolve(process.env.PENDING_DIR ?? "./data/pending"),
};

export function log(level: "error" | "warn" | "info" | "debug", ...args: unknown[]): void {
  const levels = ["error", "warn", "info", "debug"];
  const configLevel = levels.indexOf(config.logLevel);
  const msgLevel = levels.indexOf(level);
  if (msgLevel <= configLevel) {
    const prefix = `[${level.toUpperCase()}] [${new Date().toISOString()}]`;
    if (level === "error") console.error(prefix, ...args);
    else console.log(prefix, ...args);
  }
}
