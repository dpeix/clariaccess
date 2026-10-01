import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.js";

const validEnv = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/db",
  SMTP_URL: "smtp://localhost:1025",
  MAIL_FROM: "audit@example.fr",
  PUBLIC_SITE_URL: "https://www.example.fr",
};

describe("parseEnv", () => {
  it("applies defaults for optional variables", () => {
    const env = parseEnv(validEnv);

    expect(env).toEqual({
      NODE_ENV: "development",
      HOST: "127.0.0.1",
      PORT: 3000,
      TRUST_PROXY: false,
      RATE_LIMIT_IP_MAX: 10,
      RATE_LIMIT_IP_WINDOW_SECONDS: 3600,
      DOMAIN_DAILY_AUDIT_LIMIT: 3,
      ...validEnv,
    });
  });

  it("coerces PORT from a string", () => {
    expect(parseEnv({ ...validEnv, PORT: "8080" }).PORT).toBe(8080);
  });

  it("reads TRUST_PROXY as a boolean", () => {
    expect(parseEnv({ ...validEnv, TRUST_PROXY: "true" }).TRUST_PROXY).toBe(
      true,
    );
    expect(parseEnv({ ...validEnv, TRUST_PROXY: "false" }).TRUST_PROXY).toBe(
      false,
    );
  });

  it("fails with a message naming the missing variable", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({ ...validEnv, SMTP_URL: undefined })).toThrow(
      /SMTP_URL/,
    );
  });

  it("rejects an invalid DATABASE_URL", () => {
    expect(() => parseEnv({ ...validEnv, DATABASE_URL: "not a url" })).toThrow(
      /DATABASE_URL/,
    );
  });

  it("rejects an invalid MAIL_FROM", () => {
    expect(() => parseEnv({ ...validEnv, MAIL_FROM: "nope" })).toThrow(
      /MAIL_FROM/,
    );
  });

  it("rejects an out-of-range PORT", () => {
    expect(() => parseEnv({ ...validEnv, PORT: "70000" })).toThrow(/PORT/);
  });

  it("rejects non-positive limits", () => {
    expect(() => parseEnv({ ...validEnv, RATE_LIMIT_IP_MAX: "0" })).toThrow(
      /RATE_LIMIT_IP_MAX/,
    );
    expect(() =>
      parseEnv({ ...validEnv, DOMAIN_DAILY_AUDIT_LIMIT: "-1" }),
    ).toThrow(/DOMAIN_DAILY_AUDIT_LIMIT/);
  });
});
