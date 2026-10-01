import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.js";

const validEnv = { DATABASE_URL: "postgres://user:pass@localhost:5432/db" };

describe("parseEnv", () => {
  it("applies the default NODE_ENV", () => {
    expect(parseEnv(validEnv)).toEqual({
      NODE_ENV: "development",
      DATABASE_URL: validEnv.DATABASE_URL,
      AUDIT_TIMEOUT_MS: 60_000,
      AUDIT_MAX_ISSUES: 2000,
    });
  });

  it("reads the audit limits from the environment", () => {
    const env = parseEnv({
      ...validEnv,
      AUDIT_TIMEOUT_MS: "30000",
      AUDIT_MAX_ISSUES: "500",
    });
    expect(env.AUDIT_TIMEOUT_MS).toBe(30_000);
    expect(env.AUDIT_MAX_ISSUES).toBe(500);
  });

  it.each([
    ["AUDIT_TIMEOUT_MS", "0"],
    ["AUDIT_TIMEOUT_MS", "abc"],
    ["AUDIT_TIMEOUT_MS", "1000.5"],
    ["AUDIT_MAX_ISSUES", "-1"],
    ["AUDIT_MAX_ISSUES", "100000"],
  ])("rejects %s=%s", (name, value) => {
    expect(() => parseEnv({ ...validEnv, [name]: value })).toThrow(
      new RegExp(name),
    );
  });

  it("fails with a message naming the missing variable", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it("rejects an invalid DATABASE_URL", () => {
    expect(() => parseEnv({ DATABASE_URL: "not a url" })).toThrow(
      /DATABASE_URL/,
    );
  });
});
