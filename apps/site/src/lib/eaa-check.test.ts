import { describe, expect, it } from "vitest";
import { assessEaa, type EaaAnswers } from "./eaa-check.js";

const base: EaaAnswers = {
  audience: "consumers",
  offer: "ecommerce",
  size: "larger",
};

describe("assessEaa", () => {
  it("flags a consumer-facing online shop as concerned", () => {
    expect(assessEaa(base).verdict).toBe("concerned");
  });

  it.each([
    "ecommerce",
    "banking",
    "transport",
    "telecom",
    "media",
    "ebooks",
  ] as const)("treats %s as in scope for consumers", (offer) => {
    expect(assessEaa({ ...base, offer }).verdict).toBe("concerned");
  });

  it("treats a mixed consumer and business audience as concerned", () => {
    expect(assessEaa({ ...base, audience: "both" }).verdict).toBe("concerned");
  });

  it("does not consider a business-only audience in scope", () => {
    expect(assessEaa({ ...base, audience: "businesses" }).verdict).toBe(
      "likely_not_concerned",
    );
  });

  it("does not consider an offer outside the listed families in scope", () => {
    expect(assessEaa({ ...base, offer: "other" }).verdict).toBe(
      "likely_not_concerned",
    );
  });

  it("exempts a microenterprise providing services", () => {
    expect(assessEaa({ ...base, size: "micro" }).verdict).toBe("likely_exempt");
    expect(
      assessEaa({ ...base, size: "micro", offer: "banking" }).verdict,
    ).toBe("likely_exempt");
  });

  it("does not exempt a microenterprise for products", () => {
    expect(
      assessEaa({ ...base, size: "micro", offer: "hardware" }).verdict,
    ).toBe("concerned");
  });

  it("never states a certainty: every result carries a caveat", () => {
    for (const offer of ["ecommerce", "other", "hardware"] as const) {
      for (const size of ["micro", "larger"] as const) {
        const result = assessEaa({ ...base, offer, size });
        expect(result.caveat.length).toBeGreaterThan(0);
        expect(result.title.length).toBeGreaterThan(0);
        expect(result.explanation.length).toBeGreaterThan(0);
      }
    }
  });
});
