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
