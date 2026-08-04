import { describe, expect, test } from "bun:test";
import { createHash, createHmac } from "node:crypto";
import {
  FONTINASS_ENTITLEMENT_VERSION,
  type FontInAssEntitlementResponse,
} from "@fontinass/contracts";
import {
  AniBTEntitlementProvider,
  EntitlementProviderError,
  FONTINASS_ENTITLEMENT_PATH,
  entitlementCanonicalRequest,
} from "./entitlement.js";

const secret = "entitlement-test-secret-that-is-long-enough";

describe("AniBTEntitlementProvider", () => {
  test("signs the exact path/body and accepts only the versioned response", async () => {
    let observed: Request | null = null;
    const expected: FontInAssEntitlementResponse = {
      version: FONTINASS_ENTITLEMENT_VERSION,
      accountStatus: "active",
      organizations: [
        {
          organizationId: "org-1",
          name: "Atlas Subs",
          slug: "atlas",
          role: "member",
        },
      ],
      canManage: false,
      checkedAt: Date.now(),
    };
    const provider = new AniBTEntitlementProvider(
      {
        origin: "https://anibt.net",
        keyId: "fontinass-v1",
        signingSecret: secret,
        timeoutMs: 5_000,
      },
      async (input, init) => {
        observed = new Request(input, init);
        return Response.json(expected);
      },
    );

    expect(await provider.resolve("user-1")).toEqual(expected);
    if (!observed) throw new Error("request not observed");
    const request = observed as Request;
    const body = await request.clone().text();
    const timestamp = request.headers.get("x-fontinass-timestamp") ?? "";
    const nonce = request.headers.get("x-fontinass-nonce") ?? "";
    const canonical = entitlementCanonicalRequest({
      method: request.method,
      path: new URL(request.url).pathname,
      timestamp,
      nonce,
      bodySha256: createHash("sha256").update(body).digest("hex"),
    });
    expect(new URL(request.url).pathname).toBe(FONTINASS_ENTITLEMENT_PATH);
    expect(request.headers.get("x-fontinass-key-id")).toBe("fontinass-v1");
    expect(request.headers.get("x-fontinass-signature")).toBe(
      createHmac("sha256", secret).update(canonical).digest("hex"),
    );
  });

  test("classifies crossed credentials and malformed upstream payloads safely", async () => {
    const unauthorized = new AniBTEntitlementProvider(
      {
        origin: "https://anibt.net",
        keyId: "wrong-class",
        signingSecret: secret,
        timeoutMs: 5_000,
      },
      async () => Response.json({ error: "unauthorized" }, { status: 401 }),
    );
    await expect(unauthorized.resolve("user-1")).rejects.toEqual(
      new EntitlementProviderError("unauthorized"),
    );

    const malformed = new AniBTEntitlementProvider(
      {
        origin: "https://anibt.net",
        keyId: "fontinass-v1",
        signingSecret: secret,
        timeoutMs: 5_000,
      },
      async () => Response.json({ version: 99, private: "do-not-surface" }),
    );
    await expect(malformed.resolve("user-1")).rejects.toEqual(
      new EntitlementProviderError("invalid_response"),
    );
  });
});
