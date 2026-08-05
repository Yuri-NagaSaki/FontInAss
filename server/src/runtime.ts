import { appendFileSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { dirname, join, resolve } from "node:path";

export interface RuntimeConfig {
  port: number;
  apiKey: string;
  corsOrigin: string;
  fontDirectory: string;
  databasePath: string;
  pendingDirectory: string;
  logDirectory: string;
  logLevel: "debug" | "info" | "warn" | "error";
  subsetConcurrency: number;
  cacheMaxEntries: number;
  uploadTargetDirectory: string;
  publicUploadMaxFiles: number;
  publicUploadMaxFileSize: number;
  publicUploadMaxBatchSize: number;
  publicUploadRequestsPerMinute: number;
  tokenApplicationDailyLimit: number;
  archiveMaxFileSize: number;
  archiveMaxUncompressed: number;
  contributionDailyLimit: number;
  autoIndexIntervalHours: number;
  r2: { accountId: string; accessKeyId: string; secretAccessKey: string; bucketName: string; publicUrl: string };
}

export function loadRuntimeConfig(cwd = process.cwd()): RuntimeConfig {
  const path = (value: string) => resolve(cwd, value);
  const config: RuntimeConfig = {
    port: integer("PORT", 3000, 1, 65535),
    apiKey: process.env.API_KEY ?? "",
    corsOrigin: process.env.CORS_ORIGIN ?? "*",
    fontDirectory: path(process.env.FONT_DIR ?? "./fonts"),
    databasePath: path(process.env.DB_PATH ?? "./data/fontinass-v2.db"),
    pendingDirectory: path(process.env.PENDING_DIR ?? "./data/pending-v2"),
    logDirectory: path(process.env.LOG_DIR ?? "./data/logs"),
    logLevel: logLevel(process.env.LOG_LEVEL ?? "info"),
    subsetConcurrency: integer("SUBSET_CONCURRENCY", 5, 1, 64),
    cacheMaxEntries: integer("CACHE_MAX_ENTRIES", 500, 0, 10000),
    uploadTargetDirectory: (process.env.UPLOAD_TARGET_DIR ?? "CatCat-Fonts/").replace(/\/?$/, "/"),
    publicUploadMaxFiles: integer("PUBLIC_UPLOAD_MAX_FILES", 20, 1, 100),
    publicUploadMaxFileSize: integer("PUBLIC_UPLOAD_MAX_FILE_SIZE", 100 * 1024 * 1024, 1),
    publicUploadMaxBatchSize: integer("PUBLIC_UPLOAD_MAX_BATCH_SIZE", 200 * 1024 * 1024, 1),
    publicUploadRequestsPerMinute: integer("PUBLIC_UPLOAD_REQUESTS_PER_MINUTE", 30, 1, 1000),
    tokenApplicationDailyLimit: integer("TOKEN_APPLICATION_DAILY_LIMIT", 3, 1, 100),
    archiveMaxFileSize: integer("SHARING_MAX_FILE_SIZE", 200 * 1024 * 1024, 1),
    archiveMaxUncompressed: integer("ARCHIVE_MAX_UNCOMPRESSED", 2 * 1024 * 1024 * 1024, 1),
    contributionDailyLimit: integer("SHARING_RATE_LIMIT", 3, 1, 1000),
    autoIndexIntervalHours: integer("AUTO_INDEX_INTERVAL_HOURS", 4, 1, 168),
    r2: {
      accountId: process.env.R2_ACCOUNT_ID ?? "",
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
      bucketName: process.env.R2_BUCKET_NAME ?? "",
      publicUrl: (process.env.R2_PUBLIC_URL ?? "").replace(/\/+$/, ""),
    },
  };
  mkdirSync(dirname(config.databasePath), { recursive: true });
  mkdirSync(config.logDirectory, { recursive: true });
  return config;
}

export class RuntimeLogger {
  private readonly levels = ["error", "warn", "info", "debug"] as const;

  constructor(private readonly config: Pick<RuntimeConfig, "logDirectory" | "logLevel">) {}

  debug(message: string, ...args: unknown[]): void { this.write("debug", message, args); }
  info(message: string, ...args: unknown[]): void { this.write("info", message, args); }
  warn(message: string, ...args: unknown[]): void { this.write("warn", message, args); }
  error(message: string, ...args: unknown[]): void { this.write("error", message, args); }

  prune(maxAgeDays = 30): void {
    const cutoff = Date.now() - maxAgeDays * 86_400_000;
    for (const file of readdirSync(this.config.logDirectory)) {
      if (!file.startsWith("fontinass-") || !file.endsWith(".log")) continue;
      const path = join(this.config.logDirectory, file);
      try { if (statSync(path).mtimeMs < cutoff) rmSync(path); } catch { /* best effort */ }
    }
  }

  private write(level: typeof this.levels[number], message: string, args: unknown[]): void {
    if (this.levels.indexOf(level) > this.levels.indexOf(this.config.logLevel)) return;
    const prefix = `[${level.toUpperCase()}] [${new Date().toISOString()}]`;
    const values = [message, ...args];
    (level === "error" ? console.error : console.log)(prefix, ...values);
    try {
      const line = `${prefix} ${values.map(formatLogValue).join(" ")}\n`;
      appendFileSync(join(this.config.logDirectory, `fontinass-${new Date().toISOString().slice(0, 10)}.log`), line);
    } catch { /* logging must not fail a request */ }
  }
}

export function masterKeyMatches(configured: string, candidate?: string | null): boolean {
  if (!configured) return true;
  if (!candidate) return false;
  const left = Buffer.from(configured);
  const right = Buffer.from(candidate);
  return left.length === right.length && timingSafeEqual(left, right);
}

function integer(name: string, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER): number {
  const value = Number.parseInt(process.env[name] ?? String(fallback), 10);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return value;
}

function logLevel(value: string): RuntimeConfig["logLevel"] {
  if (value === "debug" || value === "info" || value === "warn" || value === "error") return value;
  throw new Error("LOG_LEVEL must be debug, info, warn, or error");
}

function formatLogValue(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}
