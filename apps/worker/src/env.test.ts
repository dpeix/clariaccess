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
      CRAWL_MAX_PAGES: 25,
      CRAWL_MAX_DURATION_MS: 600_000,
      SCAN_TICK_CRON: "*/5 * * * *",
      SCAN_TICK_BATCH: 20,
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

  it("reads the crawl limits from the environment", () => {
    const env = parseEnv({
      ...validEnv,
      CRAWL_MAX_PAGES: "5",
      CRAWL_MAX_DURATION_MS: "120000",
    });
    expect(env.CRAWL_MAX_PAGES).toBe(5);
    expect(env.CRAWL_MAX_DURATION_MS).toBe(120_000);
  });

  it("reads the scheduler settings from the environment", () => {
    const env = parseEnv({
      ...validEnv,
      SCAN_TICK_CRON: "*/10 * * * *",
      SCAN_TICK_BATCH: "5",
    });
    expect(env.SCAN_TICK_CRON).toBe("*/10 * * * *");
    expect(env.SCAN_TICK_BATCH).toBe(5);
  });

  it.each([
    ["SCAN_TICK_BATCH", "0"],
    ["SCAN_TICK_BATCH", "1000"],
    ["SCAN_TICK_CRON", ""],
    ["CRAWL_MAX_PAGES", "0"],
    ["CRAWL_MAX_PAGES", "500"],
    ["CRAWL_MAX_DURATION_MS", "-5"],
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
