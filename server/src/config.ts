/**
 * Configuration loader — reads from Bun environment variables / .env file.
 * Bun automatically loads .env from the current working directory.
 */

import { resolve as resolvePath, join } from "node:path";
import { mkdirSync, appendFileSync, readdirSync, unlinkSync, statSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";

export interface Config {
  port: number;
  apiKey: string;
  fontDir: string;
  dbPath: string;
  corsOrigin: string;
  subsetConcurrency: number;
  cacheMaxEntries: number;
  logLevel: string;
  logDir: string;
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
  // Scheduler
  autoIndexIntervalHours: number;
  // Public upload
  uploadMaxFileSize: number;
  uploadTargetDir: string;
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
  logDir:             resolve(process.env.LOG_DIR ?? "./data/logs"),
  // R2
  r2AccountId:        process.env.R2_ACCOUNT_ID ?? "",
  r2AccessKeyId:      process.env.R2_ACCESS_KEY_ID ?? "",
  r2SecretAccessKey:  process.env.R2_SECRET_ACCESS_KEY ?? "",
  r2BucketName:       process.env.R2_BUCKET_NAME ?? "",
  r2PublicUrl:        (process.env.R2_PUBLIC_URL ?? "").replace(/\/+$/, ""),
  // Sharing
  sharingMaxFileSize: parseInt(process.env.SHARING_MAX_FILE_SIZE ?? "209715200", 10),
  sharingRateLimit:   parseInt(process.env.SHARING_RATE_LIMIT ?? "50", 10),
  sharingCacheTtl:    parseInt(process.env.SHARING_CACHE_TTL ?? "300", 10),
  pendingDir:         resolve(process.env.PENDING_DIR ?? "./data/pending"),
  // Scheduler
  autoIndexIntervalHours: parseInt(process.env.AUTO_INDEX_INTERVAL_HOURS ?? "4", 10),
  // Public upload
  uploadMaxFileSize: parseInt(process.env.UPLOAD_MAX_FILE_SIZE ?? String(30 * 1024 * 1024), 10),
  uploadTargetDir: (process.env.UPLOAD_TARGET_DIR ?? "CatCat-Fonts/").replace(/\/?$/, "/"),
};

// Ensure log directory exists
mkdirSync(config.logDir, { recursive: true });

// ─── Config validation ────────────────────────────────────────────────────────
{
  const errors: string[] = [];
  if (config.port < 1 || config.port > 65535) errors.push(`PORT must be 1-65535, got ${config.port}`);
  if (config.subsetConcurrency < 1) errors.push(`SUBSET_CONCURRENCY must be ≥ 1`);
  if (config.cacheMaxEntries < 0) errors.push(`CACHE_MAX_ENTRIES must be ≥ 0`);
  if (!["debug", "info", "warn", "error"].includes(config.logLevel)) {
    errors.push(`LOG_LEVEL must be debug|info|warn|error, got "${config.logLevel}"`);
  }
  if (errors.length) {
    for (const e of errors) console.error(`[config] ❌ ${e}`);
    process.exit(1);
  }
}

function getLogFilePath(): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return join(config.logDir, `fontinass-${date}.log`);
}

export function log(level: "error" | "warn" | "info" | "debug", ...args: unknown[]): void {
  const levels = ["error", "warn", "info", "debug"];
  const configLevel = levels.indexOf(config.logLevel);
  const msgLevel = levels.indexOf(level);
  if (msgLevel <= configLevel) {
    const prefix = `[${level.toUpperCase()}] [${new Date().toISOString()}]`;
    if (level === "error") console.error(prefix, ...args);
    else console.log(prefix, ...args);

    // Persist to daily log file
    try {
      const line = `${prefix} ${args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}\n`;
      appendFileSync(getLogFilePath(), line);
    } catch { /* silently ignore file write errors */ }
  }
}

/** Remove log files older than 30 days. Called on startup. */
export function pruneOldLogs(maxAgeDays = 30): void {
  try {
    const cutoff = Date.now() - maxAgeDays * 86400_000;
    for (const f of readdirSync(config.logDir)) {
      if (!f.startsWith("fontinass-") || !f.endsWith(".log")) continue;
      const fullPath = join(config.logDir, f);
      try {
        if (statSync(fullPath).mtimeMs < cutoff) {
          unlinkSync(fullPath);
        }
      } catch { /* skip individual file errors */ }
    }
  } catch { /* silently ignore */ }
}

/** Constant-time string comparison to prevent timing attacks on API key. */
export function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

/** Shared auth middleware — returns 401 if API_KEY is set and request doesn't match */
export async function requireApiKey(c: Context, next: Next) {
  if (!config.apiKey) return next();
  const key = c.req.header("x-api-key") ?? c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!safeCompare(key, config.apiKey)) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return next();
}

/** Check API key inline (for routes that mix public/protected logic) */
export function checkApiKey(c: Context): boolean {
  if (!config.apiKey) return true;
  const provided = c.req.header("x-api-key") ?? c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return safeCompare(provided, config.apiKey);
}
