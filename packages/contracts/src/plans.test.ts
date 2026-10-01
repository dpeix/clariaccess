import { describe, expect, it } from "vitest";
import {
  PLANS,
  PLAN_LIMITS,
  SCAN_FREQUENCIES,
  frequencyIntervalMs,
  isPlan,
  normalizePlan,
  planLimits,
} from "./plans.js";

describe("plan grid", () => {
  it("lists the plans from the least to the most generous", () => {
    expect(PLANS).toEqual(["free", "pro"]);
    expect(SCAN_FREQUENCIES).toEqual(["weekly", "daily"]);
  });

  it("gives a paid plan at least what the free one has, and re-scans only to paid", () => {
    const free = PLAN_LIMITS.free;
    const pro = PLAN_LIMITS.pro;

    expect(pro.maxSites).toBeGreaterThanOrEqual(free.maxSites);
    expect(pro.maxPagesPerAudit).toBeGreaterThanOrEqual(free.maxPagesPerAudit);
    expect(pro.manualAuditsPerDayPerSite).toBeGreaterThanOrEqual(
      free.manualAuditsPerDayPerSite,
    );
    expect(free.scheduledFrequencies).toEqual([]);
    expect(pro.scheduledFrequencies).toEqual(["weekly", "daily"]);
  });

  it("only uses positive whole limits", () => {
    for (const plan of PLANS) {
      const limits = PLAN_LIMITS[plan];
      for (const value of [
        limits.maxSites,
        limits.maxPagesPerAudit,
        limits.manualAuditsPerDayPerSite,
      ]) {
        expect(Number.isInteger(value) && value > 0).toBe(true);
      }
    }
  });
});

describe("planLimits", () => {
  it("returns the limits of a known plan", () => {
    expect(planLimits("pro")).toBe(PLAN_LIMITS.pro);
  });

  it("falls back on the free plan for an unknown value, never on a paid one", () => {
    expect(planLimits("enterprise")).toBe(PLAN_LIMITS.free);
    expect(planLimits("")).toBe(PLAN_LIMITS.free);
    expect(planLimits("constructor")).toBe(PLAN_LIMITS.free);
  });
});

describe("normalizePlan", () => {
  it("keeps a known plan and reads anything else as free", () => {
    expect(normalizePlan("pro")).toBe("pro");
    expect(normalizePlan("free")).toBe("free");
    expect(normalizePlan("enterprise")).toBe("free");
    expect(normalizePlan("")).toBe("free");
  });
});

describe("isPlan", () => {
  it("accepts only listed plans", () => {
    expect(isPlan("free")).toBe(true);
    expect(isPlan("pro")).toBe(true);
    expect(isPlan("enterprise")).toBe(false);
    expect(isPlan("toString")).toBe(false);
  });
});

describe("frequencyIntervalMs", () => {
  it("is a week and a day", () => {
    expect(frequencyIntervalMs("weekly")).toBe(7 * 24 * 60 * 60 * 1000);
    expect(frequencyIntervalMs("daily")).toBe(24 * 60 * 60 * 1000);
  });
});
