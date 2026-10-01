import { describe, expect, it } from "vitest";
import { fingerprint, normalizeSelector } from "./fingerprint.js";

describe("normalizeSelector", () => {
  it("joins nested targets (iframes, shadow DOM) in order", () => {
    expect(normalizeSelector(["iframe#a", ["#host", ".inner"], "img"])).toBe(
      "iframe#a >> #host >> .inner >> img",
    );
  });

  it("collapses whitespace", () => {
    expect(normalizeSelector(["  ul  >   li "])).toBe("ul > li");
  });
});

describe("fingerprint", () => {
  const base = { ruleId: "image-alt", selector: "img.logo", templateKey: null };

  it("is stable for identical input", () => {
    expect(fingerprint(base)).toBe(fingerprint({ ...base }));
  });

  it("is a sha256 hex digest", () => {
    expect(fingerprint(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes with the rule, the selector and the template", () => {
    const ref = fingerprint(base);
    expect(fingerprint({ ...base, ruleId: "button-name" })).not.toBe(ref);
    expect(fingerprint({ ...base, selector: "img.hero" })).not.toBe(ref);
    expect(fingerprint({ ...base, templateKey: "home" })).not.toBe(ref);
  });

  it("does not confuse fields that concatenate to the same text", () => {
    expect(
      fingerprint({ ruleId: "ab", selector: "c", templateKey: null }),
    ).not.toBe(fingerprint({ ruleId: "a", selector: "bc", templateKey: null }));
  });
});
