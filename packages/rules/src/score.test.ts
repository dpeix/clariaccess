import { describe, expect, it } from "vitest";
import { computeScore, priorityScore } from "./score.js";

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

describe("priorityScore", () => {
  it("ranks a more severe impact higher on the same number of pages", () => {
    expect(priorityScore("critical", 1)).toBeGreaterThan(
      priorityScore("serious", 1),
    );
    expect(priorityScore("serious", 1)).toBeGreaterThan(
      priorityScore("moderate", 1),
    );
    expect(priorityScore("moderate", 1)).toBeGreaterThan(
      priorityScore("minor", 1),
    );
  });

  it("grows with the number of pages affected", () => {
    expect(priorityScore("serious", 5)).toBeGreaterThan(
      priorityScore("serious", 1),
    );
  });

  it("is a positive integer, even for a single minor issue", () => {
    expect(priorityScore("minor", 1)).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(priorityScore("critical", 7))).toBe(true);
  });

  it("rejects a page count below 1", () => {
    expect(() => priorityScore("minor", 0)).toThrow();
  });
});
