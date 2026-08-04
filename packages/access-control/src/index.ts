export * from "./entitlement.js";
export * from "./secure-values.js";
export * from "./workspace-access.js";

export function extractBearerCredential(
  authorization?: string | null,
): string | null {
  return authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
}
