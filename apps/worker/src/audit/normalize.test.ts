import type { Result } from "axe-core";
import { describe, expect, it } from "vitest";
import { normalizeViolations } from "./normalize.js";

function violation(overrides: Partial<Result> = {}): Result {
  return {
    id: "image-alt",
    impact: "critical",
    tags: ["wcag2a"],
    description: "Images must have alternative text",
    help: "Images must have alternative text",
    helpUrl: "https://dequeuniversity.com/rules/axe/4.13/image-alt",
    nodes: [
      {
        html: '<img src="logo.png">',
        target: ["img"],
        impact: "critical",
        failureSummary: "Fix any of the following: no alt attribute",
      },
    ],
    ...overrides,
  } as Result;
}

const options = { templateKey: null, maxIssues: 100, maxHtmlLength: 500 };

describe("normalizeViolations", () => {
  it("emits one issue per violating node", () => {
    const { issues } = normalizeViolations(
      [
        violation({
          nodes: [
            { html: "<img>", target: ["img.a"], failureSummary: "x" },
            { html: "<img>", target: ["img.b"], failureSummary: "x" },
          ] as Result["nodes"],
        }),
      ],
      options,
    );
    expect(issues.map((i) => i.selector)).toEqual(["img.a", "img.b"]);
    expect(issues.every((i) => i.ruleId === "image-alt")).toBe(true);
  });

  it("fills the issue columns and keeps the raw axe node", () => {
    const { issues } = normalizeViolations([violation()], options);
    expect(issues).toHaveLength(1);
    const issue = issues[0]!;
    expect(issue).toMatchObject({
      ruleId: "image-alt",
      impact: "critical",
      selector: "img",
      htmlExcerpt: '<img src="logo.png">',
      message: "Fix any of the following: no alt attribute",
    });
    expect(issue.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(issue.raw).toMatchObject({
      ruleId: "image-alt",
      helpUrl: expect.stringContaining("image-alt"),
      node: { html: '<img src="logo.png">' },
    });
  });

  it("falls back to the rule help when a node has no failure summary", () => {
    const { issues } = normalizeViolations(
      [
        violation({
          nodes: [{ html: "<img>", target: ["img"] }] as Result["nodes"],
        }),
      ],
      options,
    );
    expect(issues[0]?.message).toBe("Images must have alternative text");
  });

  it("uses the node impact, then the rule impact, then 'minor' when axe gives none", () => {
    const node = { html: "<i>", target: ["i"], failureSummary: "x" };
    const nodeLevel = normalizeViolations(
      [
        violation({
          impact: "minor",
          nodes: [{ ...node, impact: "serious" }] as Result["nodes"],
        }),
      ],
      options,
    );
    expect(nodeLevel.issues[0]?.impact).toBe("serious");

    const ruleLevel = normalizeViolations(
      [violation({ impact: "moderate", nodes: [node] as Result["nodes"] })],
      options,
    );
    expect(ruleLevel.issues[0]?.impact).toBe("moderate");

    const none = normalizeViolations(
      [violation({ impact: null, nodes: [node] as Result["nodes"] })],
      options,
    );
    expect(none.issues[0]?.impact).toBe("minor");
  });

  it("keeps best-practice rules that are seeded but not mapped to WCAG", () => {
    const { issues, skippedUnknownRules } = normalizeViolations(
      [violation({ id: "empty-heading" })],
      options,
    );
    expect(issues).toHaveLength(1);
    expect(skippedUnknownRules).toEqual([]);
  });

  it("skips and reports rules absent from the rules table", () => {
    const { issues, skippedUnknownRules } = normalizeViolations(
      [violation({ id: "rule-from-the-future" }), violation()],
      options,
    );
    expect(issues.map((i) => i.ruleId)).toEqual(["image-alt"]);
    expect(skippedUnknownRules).toEqual(["rule-from-the-future"]);
  });

  it("truncates long html excerpts", () => {
    const { issues } = normalizeViolations(
      [
        violation({
          nodes: [
            { html: "x".repeat(2000), target: ["a"], failureSummary: "x" },
          ] as Result["nodes"],
        }),
      ],
      { ...options, maxHtmlLength: 50 },
    );
    expect(issues[0]?.htmlExcerpt.length).toBeLessThanOrEqual(50);
  });

  it("caps the number of issues and says so", () => {
    const nodes = Array.from({ length: 5 }, (_, i) => ({
      html: "<img>",
      target: [`img.n${i}`],
      failureSummary: "x",
    })) as Result["nodes"];
    const result = normalizeViolations([violation({ nodes })], {
      ...options,
      maxIssues: 3,
    });
    expect(result.issues).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });

  it("returns nothing for a page without violations", () => {
    expect(normalizeViolations([], options)).toEqual({
      issues: [],
      skippedUnknownRules: [],
      truncated: false,
    });
  });
});
