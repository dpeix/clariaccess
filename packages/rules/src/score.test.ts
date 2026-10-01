import { describe, expect, it } from "vitest";
import { computeScore } from "./score.js";

const issues = (impact: "minor" | "moderate" | "serious" | "critical", n = 1) =>
  Array.from({ length: n }, () => ({ impact }));

describe("computeScore", () => {
  it("is 100 when no issue was found", () => {
    expect(computeScore([])).toBe(100);
  });

  it("returns an integer between 0 and 100", () => {
    for (const n of [1, 5, 50, 5000]) {
      const score = computeScore(issues("critical", n));
      expect(Number.isInteger(score)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it("never reaches 0 or 100 by accident: any issue lowers a clean score", () => {
    expect(computeScore(issues("minor"))).toBeLessThan(100);
  });

  it("decreases as issues are added", () => {
    const scores = [0, 1, 2, 5, 20].map((n) =>
      computeScore(issues("serious", n)),
    );
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i] as number).toBeLessThan(scores[i - 1] as number);
    }
  });

  it("weighs a more severe impact more heavily", () => {
    const [minor, moderate, serious, critical] = (
      ["minor", "moderate", "serious", "critical"] as const
    ).map((impact) => computeScore(issues(impact, 3)));
    expect(critical).toBeLessThan(serious as number);
    expect(serious).toBeLessThan(moderate as number);
    expect(moderate).toBeLessThan(minor as number);
  });

  it("does not depend on the order of the issues", () => {
    const a = [...issues("minor", 2), ...issues("critical")];
    expect(computeScore(a)).toBe(computeScore([...a].reverse()));
  });
});
