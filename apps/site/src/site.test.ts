import { describe, expect, it } from "vitest";
import { siteConfig } from "./site.js";

describe("siteConfig", () => {
  it("declares French as the page language (required for screen readers)", () => {
    expect(siteConfig.lang).toBe("fr");
  });

  it("has a non-empty title", () => {
    expect(siteConfig.title.length).toBeGreaterThan(0);
  });
});
