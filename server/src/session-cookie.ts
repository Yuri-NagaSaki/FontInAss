import type { RuntimeConfig } from "./runtime.js";

export const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Cloudflare-CDN-Cache-Control": "no-store",
  "Surrogate-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

export function sessionCookieName(
  environment: RuntimeConfig["environment"],
): string {
  return environment === "production"
    ? "__Host-fontinass_session"
    : "fontinass_session";
}

export function readSessionCookie(
  cookieHeader: string | null | undefined,
  environment: RuntimeConfig["environment"],
): string | null {
  if (!cookieHeader) return null;
  const expected = sessionCookieName(environment);
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    if (name !== expected) continue;
    const value = part.slice(separator + 1).trim();
    return /^[A-Za-z0-9_-]{32,256}$/.test(value) ? value : null;
  }
  return null;
}

export function setSessionCookie(
  token: string,
  config: RuntimeConfig,
): string {
  const maxAge = Math.max(
    1,
    Math.floor(config.workspaceAccess.sessionAbsoluteTtlMs / 1_000),
  );
  return [
    `${sessionCookieName(config.environment)}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    ...(config.environment === "production" ? ["Secure"] : []),
  ].join("; ");
}

export function clearSessionCookie(config: RuntimeConfig): string {
  return [
    `${sessionCookieName(config.environment)}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    ...(config.environment === "production" ? ["Secure"] : []),
  ].join("; ");
}

export function originMatches(
  originHeader: string | null | undefined,
  publicOrigin: string,
): boolean {
  if (!originHeader) return false;
  try {
    return new URL(originHeader).origin === publicOrigin;
  } catch {
    return false;
  }
}
