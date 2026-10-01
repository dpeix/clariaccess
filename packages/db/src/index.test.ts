import { describe, expect, it } from "vitest";
import { hello } from "./index.js";

describe("@accessibility/db", () => {
  it("exposes its package name", () => {
    expect(hello()).toBe("@accessibility/db");
  });
});
