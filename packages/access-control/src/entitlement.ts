import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  FONTINASS_ENTITLEMENT_VERSION,
  FontInAssEntitlementResponseSchema,
  type FontInAssEntitlementResponse,
} from "@fontinass/contracts";

export const FONTINASS_ENTITLEMENT_PATH =
  "/api/internal/fontinass/entitlements";

export interface EntitlementProvider {
  resolve(userId: string): Promise<FontInAssEntitlementResponse>;
}

export type AniBTEntitlementProviderConfig = {
  origin: string;
  keyId: string;
  signingSecret: string;
  timeoutMs: number;
};

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class EntitlementProviderError extends Error {
  constructor(
    public readonly code:
      | "configuration"
      | "timeout"
      | "unauthorized"
      | "rate_limited"
      | "upstream"
      | "invalid_response",
  ) {
    super(code);
    this.name = "EntitlementProviderError";
  }
}

export function entitlementCanonicalRequest(input: {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  bodySha256: string;
}): string {
  return [
    input.method.toUpperCase(),
    input.path,
    input.timestamp,
    input.nonce,
    input.bodySha256.toLowerCase(),
  ].join("\n");
}

export class AniBTEntitlementProvider implements EntitlementProvider {
  constructor(
    private readonly config: AniBTEntitlementProviderConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async resolve(userId: string): Promise<FontInAssEntitlementResponse> {
    if (
      !this.config.origin ||
      !this.config.keyId ||
      this.config.signingSecret.length < 32
    ) {
      throw new EntitlementProviderError("configuration");
    }
    const body = JSON.stringify({
      version: FONTINASS_ENTITLEMENT_VERSION,
      userId,
    });
    const timestamp = String(Date.now());
    const nonce = randomBytes(24).toString("base64url");
    const bodySha256 = createHash("sha256").update(body).digest("hex");
    const canonical = entitlementCanonicalRequest({
      method: "POST",
      path: FONTINASS_ENTITLEMENT_PATH,
      timestamp,
      nonce,
      bodySha256,
    });
    const signature = createHmac("sha256", this.config.signingSecret)
      .update(canonical)
      .digest("hex");

    let response: Response;
    try {
      response = await this.fetchImpl(
        `${this.config.origin.replace(/\/+$/, "")}${FONTINASS_ENTITLEMENT_PATH}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-fontinass-key-id": this.config.keyId,
            "x-fontinass-timestamp": timestamp,
            "x-fontinass-nonce": nonce,
            "x-fontinass-signature": signature,
          },
          body,
          cache: "no-store",
          signal: AbortSignal.timeout(this.config.timeoutMs),
        },
      );
    } catch (error) {
      if (
        error instanceof DOMException &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      ) {
        throw new EntitlementProviderError("timeout");
      }
      throw new EntitlementProviderError("upstream");
    }

    if (response.status === 401 || response.status === 403) {
      throw new EntitlementProviderError("unauthorized");
    }
    if (response.status === 429) {
      throw new EntitlementProviderError("rate_limited");
    }
    if (!response.ok) throw new EntitlementProviderError("upstream");
    try {
      return FontInAssEntitlementResponseSchema.parse(await response.json());
    } catch {
      throw new EntitlementProviderError("invalid_response");
    }
  }
}

export class InMemoryEntitlementProvider implements EntitlementProvider {
  constructor(
    private readonly entries: Map<string, FontInAssEntitlementResponse>,
  ) {}

  async resolve(userId: string): Promise<FontInAssEntitlementResponse> {
    return (
      this.entries.get(userId) ?? {
        version: FONTINASS_ENTITLEMENT_VERSION,
        accountStatus: "deleted",
        organizations: [],
        canManage: false,
        checkedAt: Date.now(),
      }
    );
  }
}
