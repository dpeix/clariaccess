import { createHash, randomBytes } from "node:crypto";

// 256 random bits, url-safe: it travels in a login link or a cookie.
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

// Only this digest is stored. The tokens are high-entropy random values, so a
// fast hash is enough: there is nothing to brute-force.
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
