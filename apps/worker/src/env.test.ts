import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.js";

const validEnv = { DATABASE_URL: "postgres://user:pass@localhost:5432/db" };

describe("parseEnv", () => {
  it("applies the default NODE_ENV", () => {
    expect(parseEnv(validEnv)).toEqual({
      NODE_ENV: "development",
      DATABASE_URL: validEnv.DATABASE_URL,
    });
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
