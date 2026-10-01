import { describe, expect, it } from "vitest";
import type { Audit } from "@accessibility/contracts";
import {
  AUTOMATED_COVERAGE_NOTICE,
  buildReport,
  type ReportIssueRow,
} from "./build-report.js";

const audit: Audit = {
  id: "6f1c1c1e-8d5e-4a37-9d57-3c1a4f0f2a10",
  url: "https://example.fr/",
  type: "free",
  status: "completed",
  startedAt: "2026-10-01T10:00:00.000Z",
  finishedAt: "2026-10-01T10:00:30.000Z",
  pagesScanned: 1,
  score: 70,
  failureReason: null,
};

function row(overrides: Partial<ReportIssueRow> = {}): ReportIssueRow {
  return {
    ruleId: "image-alt",
    impact: "critical",
    selector: "img.hero",
    htmlExcerpt: "<img>",
    raw: {
      help: "Images must have alternate text",
      helpUrl: "https://dequeuniversity.com/rules/axe/4.13/image-alt",
    },
    wcagCriteria: ["1.1.1"],
    rgaaCriteria: ["1.1"],
    ...overrides,
  };
}

describe("buildReport", () => {
  it("returns the audit, the notice and no group for a clean page", () => {
    const report = buildReport({ ...audit, score: 100 }, []);
    expect(report.totalIssues).toBe(0);
    expect(report.groups).toEqual([]);
    expect(report.automatedCoverageNotice).toBe(AUTOMATED_COVERAGE_NOTICE);
    expect(AUTOMATED_COVERAGE_NOTICE).toMatch(/partie|pas/i);
  });

  it("groups the occurrences of one rule", () => {
    const report = buildReport(audit, [
      row({ selector: "img.a" }),
      row({ selector: "img.b" }),
      row({ ruleId: "button-name", impact: "serious", selector: "button" }),
    ]);
    expect(report.totalIssues).toBe(3);
    const imageAlt = report.groups.find((g) => g.ruleId === "image-alt");
    expect(imageAlt).toMatchObject({
      title: "Images must have alternate text",
      helpUrl: "https://dequeuniversity.com/rules/axe/4.13/image-alt",
      impact: "critical",
      occurrences: 2,
      wcagCriteria: ["1.1.1"],
      rgaaCriteria: ["1.1"],
    });
    expect(imageAlt?.examples.map((e) => e.selector)).toEqual([
      "img.a",
      "img.b",
    ]);
  });

  it("orders groups by impact, then by occurrences, then by rule id", () => {
    const report = buildReport(audit, [
      row({ ruleId: "b-minor", impact: "minor" }),
      row({ ruleId: "a-serious", impact: "serious" }),
      row({ ruleId: "c-serious", impact: "serious" }),
      row({ ruleId: "c-serious", impact: "serious" }),
      row({ ruleId: "z-critical", impact: "critical" }),
      row({ ruleId: "a-minor", impact: "minor" }),
    ]);
    expect(report.groups.map((g) => g.ruleId)).toEqual([
      "z-critical",
      "c-serious",
      "a-serious",
      "a-minor",
      "b-minor",
    ]);
  });

  it("keeps at most three examples per group", () => {
    const rows = ["1", "2", "3", "4", "5"].map((n) =>
      row({ selector: `img.${n}` }),
    );
    const [group] = buildReport(audit, rows).groups;
    expect(group?.occurrences).toBe(5);
    expect(group?.examples).toHaveLength(3);
  });

  it("falls back to the rule id when the stored help text is missing or malformed", () => {
    const [missing] = buildReport(audit, [row({ raw: {} })]).groups;
    expect(missing?.title).toBe("image-alt");
    expect(missing?.helpUrl).toBeNull();

    const [malformed] = buildReport(audit, [
      row({ raw: { help: 42, helpUrl: "javascript:alert(1)" } }),
    ]).groups;
    expect(malformed?.title).toBe("image-alt");
    expect(malformed?.helpUrl).toBeNull();

    const [nullRaw] = buildReport(audit, [row({ raw: null })]).groups;
    expect(nullRaw?.title).toBe("image-alt");
  });

  it("only keeps http(s) help links", () => {
    const [group] = buildReport(audit, [
      row({ raw: { help: "h", helpUrl: "ftp://example.fr/x" } }),
    ]).groups;
    expect(group?.helpUrl).toBeNull();
  });
});
