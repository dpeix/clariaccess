import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.js";

const validEnv = { DATABASE_URL: "postgres://user:pass@localhost:5432/db" };

describe("parseEnv", () => {
  it("applies defaults for optional variables", () => {
    const env = parseEnv(validEnv);

    expect(env).toEqual({
      NODE_ENV: "development",
      HOST: "127.0.0.1",
      PORT: 3000,
      DATABASE_URL: validEnv.DATABASE_URL,
    });
  });

  it("coerces PORT from a string", () => {
    expect(parseEnv({ ...validEnv, PORT: "8080" }).PORT).toBe(8080);
  });

  it("fails with a message naming the missing variable", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it("rejects an invalid DATABASE_URL", () => {
    expect(() => parseEnv({ DATABASE_URL: "not a url" })).toThrow(
      /DATABASE_URL/,
    );
  });

  it("rejects an out-of-range PORT", () => {
    expect(() => parseEnv({ ...validEnv, PORT: "70000" })).toThrow(/PORT/);
  });
});
