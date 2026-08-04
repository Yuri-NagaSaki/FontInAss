import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const SECRET_ASSIGNMENT = /^(FONTINASS_(?:OPERATOR_CREDENTIAL|OIDC_CLIENT_SECRET|ENTITLEMENT_SIGNING_SECRET|SESSION_FINGERPRINT_SECRET|SESSION_ENCRYPTION_KEY))=(.+)$/gmu;
const SAFE_EXAMPLE_VALUE = /^(?:\s*|<[^>]+>|\$\{[^}]+\}|replace-with-[^\s]+|development-only-[^\s]+|test-[^\s]+)$/iu;
const PLAINTEXT_PROGRAMMATIC_CREDENTIAL = /\bfia_[0-9a-f]{8}_[A-Za-z0-9_-]{32,}\b/gu;

function repositoryTextFiles() {
  const result = spawnSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 },
  );
  assert.equal(result.status, 0, result.stderr?.toString("utf8"));
  return result.stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .flatMap((path) => {
      let bytes;
      try {
        bytes = readFileSync(path);
      } catch {
        return [];
      }
      if (bytes.includes(0)) return [];
      return [{ path, text: bytes.toString("utf8") }];
    });
}

test("repository files contain no private identity or plaintext credential", () => {
  const privateValues = [
    process.env.FONTINASS_PRIVATE_ADMIN_EMAIL,
    process.env.FONTINASS_PRIVATE_ADMIN_USER_ID,
    process.env.FONTINASS_PRIVATE_OIDC_CLIENT_SECRET,
    process.env.FONTINASS_PRIVATE_ENTITLEMENT_SECRET,
    process.env.FONTINASS_PRIVATE_SESSION_SECRET,
    process.env.FONTINASS_PRIVATE_OPERATOR_CREDENTIAL,
  ].filter((value) => typeof value === "string" && value.length >= 6);

  for (const { path, text } of repositoryTextFiles()) {
    for (const value of privateValues) {
      assert.equal(
        text.includes(value),
        false,
        `private FontInAss value leaked into ${path}`,
      );
    }
    for (const match of text.matchAll(SECRET_ASSIGNMENT)) {
      assert.match(
        match[2]?.trim() ?? "",
        SAFE_EXAMPLE_VALUE,
        `literal FontInAss secret assignment found in ${path}`,
      );
    }
    if (path !== "scripts/private-data-guard.test.mjs") {
      assert.equal(
        PLAINTEXT_PROGRAMMATIC_CREDENTIAL.test(text),
        false,
        `plaintext programmatic credential found in ${path}`,
      );
      PLAINTEXT_PROGRAMMATIC_CREDENTIAL.lastIndex = 0;
    }
  }
});
