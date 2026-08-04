import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

function key(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

export function randomBase64Url(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function keyedFingerprint(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value, "utf8").digest("hex");
}

export function safeStringEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function encryptString(secret: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext]
    .map((part) => part.toString("base64url"))
    .join(".");
}

export function decryptString(secret: string, sealed: string): string {
  const parts = sealed.split(".");
  if (parts.length !== 3) throw new Error("invalid_sealed_value");
  const [ivPart, tagPart, ciphertextPart] = parts;
  if (!ivPart || !tagPart || !ciphertextPart) {
    throw new Error("invalid_sealed_value");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(secret),
    Buffer.from(ivPart, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
