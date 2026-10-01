import { describe, expect, it } from "vitest";
import { hello } from "./index.js";

describe("@accessibility/rules", () => {
  it("exposes its package name", () => {
    expect(hello()).toBe("@accessibility/rules");
  });
});
