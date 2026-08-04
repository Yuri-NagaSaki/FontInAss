import { appendFileSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { dirname, join, resolve } from "node:path";

export interface RuntimeConfig {
  environment: "development" | "test" | "production";
  port: number;
  operatorCredential: string;
  publicOrigin: string;
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
  archiveMaxFileSize: number;
  archiveMaxUncompressed: number;
  contributionDailyLimit: number;
  autoIndexIntervalHours: number;
  oidc: {
    issuer: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    postLogoutRedirectUri: string;
    scopes: string;
    timeoutMs: number;
  };
  entitlement: {
    origin: string;
    keyId: string;
    signingSecret: string;
    timeoutMs: number;
  };
  workspaceAccess: {
    fingerprintSecret: string;
    encryptionSecret: string;
    loginTransactionTtlMs: number;
    sessionIdleTtlMs: number;
    sessionAbsoluteTtlMs: number;
    recentAuthTtlMs: number;
    maxCredentialsPerUser: number;
    maxCredentialsPerOrganization: number;
    credentialCreationsPerHour: number;
    maxCredentialTtlMs: number;
  };
  r2: { accountId: string; accessKeyId: string; secretAccessKey: string; bucketName: string; publicUrl: string };
}

export function loadRuntimeConfig(cwd = process.cwd()): RuntimeConfig {
  const path = (value: string) => resolve(cwd, value);
  const environment = runtimeEnvironment(process.env.NODE_ENV);
  const publicOrigin = origin(
    "FONTINASS_PUBLIC_ORIGIN",
    process.env.FONTINASS_PUBLIC_ORIGIN ?? "http://localhost:3000",
  );
  const config: RuntimeConfig = {
    environment,
    port: integer("PORT", 3000, 1, 65535),
    operatorCredential: secret(
      "FONTINASS_OPERATOR_CREDENTIAL",
      environment,
      "development-only-fontinass-operator-key",
    ),
    publicOrigin,
    corsOrigin: origin(
      "CORS_ORIGIN",
      process.env.CORS_ORIGIN ?? publicOrigin,
    ),
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
    archiveMaxFileSize: integer("SHARING_MAX_FILE_SIZE", 200 * 1024 * 1024, 1),
    archiveMaxUncompressed: integer("ARCHIVE_MAX_UNCOMPRESSED", 2 * 1024 * 1024 * 1024, 1),
    contributionDailyLimit: integer("SHARING_RATE_LIMIT", 3, 1, 1000),
    autoIndexIntervalHours: integer("AUTO_INDEX_INTERVAL_HOURS", 4, 1, 168),
    oidc: {
      issuer: origin(
        "FONTINASS_OIDC_ISSUER",
        process.env.FONTINASS_OIDC_ISSUER ?? "https://oauth.anibt.net",
      ),
      clientId: required(
        "FONTINASS_OIDC_CLIENT_ID",
        environment,
        "fontinass-development-client",
      ),
      clientSecret: secret(
        "FONTINASS_OIDC_CLIENT_SECRET",
        environment,
        "development-only-oidc-client-secret",
      ),
      redirectUri:
        process.env.FONTINASS_OIDC_REDIRECT_URI ??
        `${publicOrigin}/api/auth/callback`,
      postLogoutRedirectUri:
        process.env.FONTINASS_OIDC_POST_LOGOUT_REDIRECT_URI ??
        `${publicOrigin}/`,
      scopes:
        process.env.FONTINASS_OIDC_SCOPES ??
        "openid profile anibt:user_id",
      timeoutMs: integer("FONTINASS_OIDC_TIMEOUT_MS", 8_000, 500, 30_000),
    },
    entitlement: {
      origin: origin(
        "FONTINASS_ENTITLEMENT_ORIGIN",
        process.env.FONTINASS_ENTITLEMENT_ORIGIN ?? "https://anibt.net",
      ),
      keyId: required(
        "FONTINASS_ENTITLEMENT_KEY_ID",
        environment,
        "fontinass-development-entitlement",
      ),
      signingSecret: secret(
        "FONTINASS_ENTITLEMENT_SIGNING_SECRET",
        environment,
        "development-only-entitlement-signing-secret",
      ),
      timeoutMs: integer(
        "FONTINASS_ENTITLEMENT_TIMEOUT_MS",
        5_000,
        500,
        30_000,
      ),
    },
    workspaceAccess: {
      fingerprintSecret: secret(
        "FONTINASS_SESSION_FINGERPRINT_SECRET",
        environment,
        "development-only-session-fingerprint-secret",
      ),
      encryptionSecret: secret(
        "FONTINASS_SESSION_ENCRYPTION_KEY",
        environment,
        "development-only-session-encryption-key",
      ),
      loginTransactionTtlMs: integer(
        "FONTINASS_LOGIN_TRANSACTION_TTL_MS",
        10 * 60_000,
        60_000,
        30 * 60_000,
      ),
      sessionIdleTtlMs: integer(
        "FONTINASS_SESSION_IDLE_TTL_MS",
        12 * 60 * 60_000,
        5 * 60_000,
        7 * 24 * 60 * 60_000,
      ),
      sessionAbsoluteTtlMs: integer(
        "FONTINASS_SESSION_ABSOLUTE_TTL_MS",
        7 * 24 * 60 * 60_000,
        60 * 60_000,
        30 * 24 * 60 * 60_000,
      ),
      recentAuthTtlMs: integer(
        "FONTINASS_RECENT_AUTH_TTL_MS",
        10 * 60_000,
        60_000,
        30 * 60_000,
      ),
      maxCredentialsPerUser: integer(
        "FONTINASS_CREDENTIALS_PER_USER",
        5,
        1,
        50,
      ),
      maxCredentialsPerOrganization: integer(
        "FONTINASS_CREDENTIALS_PER_ORGANIZATION",
        25,
        1,
        500,
      ),
      credentialCreationsPerHour: integer(
        "FONTINASS_CREDENTIAL_CREATIONS_PER_HOUR",
        10,
        1,
        100,
      ),
      maxCredentialTtlMs: integer(
        "FONTINASS_CREDENTIAL_MAX_TTL_MS",
        365 * 24 * 60 * 60_000,
        24 * 60 * 60_000,
        2 * 365 * 24 * 60 * 60_000,
      ),
    },
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

export function operatorCredentialMatches(
  configured: string,
  candidate?: string | null,
): boolean {
  if (!configured) return false;
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

function runtimeEnvironment(
  value: string | undefined,
): RuntimeConfig["environment"] {
  if (value === "production" || value === "test") return value;
  return "development";
}

function required(
  name: string,
  environment: RuntimeConfig["environment"],
  developmentFallback: string,
): string {
  const value = process.env[name]?.trim() ?? "";
  if (value) return value;
  if (environment === "production") throw new Error(`${name} is required`);
  return developmentFallback;
}

function secret(
  name: string,
  environment: RuntimeConfig["environment"],
  developmentFallback: string,
): string {
  const value = required(name, environment, developmentFallback);
  if (value.length < 32) throw new Error(`${name} must be at least 32 characters`);
  return value;
}

function origin(name: string, value: string): string {
  const url = new URL(value);
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${name} must be an HTTP(S) origin`);
  }
  return url.origin;
}

function logLevel(value: string): RuntimeConfig["logLevel"] {
  if (value === "debug" || value === "info" || value === "warn" || value === "error") return value;
  throw new Error("LOG_LEVEL must be debug, info, warn, or error");
}

function formatLogValue(value: unknown): string {
  if (value instanceof Error) return JSON.stringify({ error: value.name });
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}
