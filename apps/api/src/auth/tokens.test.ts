import { describe, expect, it } from "vitest";
import { generateToken, hashToken } from "./tokens.js";

describe("generateToken", () => {
  it("is url-safe and carries 256 bits", () => {
    const token = generateToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("never repeats", () => {
    const tokens = new Set(Array.from({ length: 200 }, generateToken));

    expect(tokens.size).toBe(200);
  });
});

describe("hashToken", () => {
  it("is a stable SHA-256 hex digest that does not reveal the token", () => {
    const hash = hashToken("secret-token");

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken("secret-token")).toBe(hash);
    expect(hash).not.toContain("secret");
  });

  it("differs for different tokens", () => {
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });
});
