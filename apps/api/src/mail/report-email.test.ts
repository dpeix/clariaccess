import { describe, expect, it } from "vitest";
import type { AuditReport } from "@accessibility/contracts";
import { AUTOMATED_COVERAGE_NOTICE } from "../report/build-report.js";
import { renderReportEmail } from "./report-email.js";

const report: AuditReport = {
  audit: {
    id: "6f1c1c1e-8d5e-4a37-9d57-3c1a4f0f2a10",
    url: "https://example.fr/",
    type: "free",
    status: "completed",
    startedAt: "2026-10-01T10:00:00.000Z",
    finishedAt: "2026-10-01T10:00:30.000Z",
    pagesScanned: 1,
    score: 62,
    failureReason: null,
  },
  totalIssues: 4,
  groups: [
    {
      ruleId: "image-alt",
      title: "Images must have alternate text",
      helpUrl: null,
      impact: "critical",
      occurrences: 3,
      examples: [],
      wcagCriteria: ["1.1.1"],
      rgaaCriteria: [],
    },
    {
      ruleId: "label",
      title: "Form elements must have labels",
      helpUrl: null,
      impact: "serious",
      occurrences: 1,
      examples: [],
      wcagCriteria: ["1.3.1"],
      rgaaCriteria: [],
    },
  ],
  automatedCoverageNotice: AUTOMATED_COVERAGE_NOTICE,
};

const link = "https://www.example.fr/audit/6f1c1c1e";

describe("renderReportEmail", () => {
  it("has a fixed subject that carries nothing from the audited site", () => {
    const hostile = {
      ...report,
      audit: { ...report.audit, url: "https://evil.example/\r\nBcc: x@y.z" },
    };
    expect(renderReportEmail(hostile, link).subject).toBe(
      renderReportEmail(report, link).subject,
    );
    expect(renderReportEmail(report, link).subject).not.toMatch(/example\.fr/);
  });

  it("gives the score, the top problems, the link and the coverage notice in both formats", () => {
    const { text, html } = renderReportEmail(report, link);
    for (const body of [text, html]) {
      expect(body).toContain("62");
      expect(body).toContain("Images must have alternate text");
      expect(body).toContain(link);
      // First words only: the apostrophes are escaped in the HTML body.
      expect(body).toContain("Cet audit automatisé ne couvre");
    }
    expect(text).toContain(report.automatedCoverageNotice);
  });

  it("escapes what comes from the audited page in the HTML body", () => {
    const hostile: AuditReport = {
      ...report,
      groups: [
        {
          ...(report.groups[0] as AuditReport["groups"][number]),
          title: '<script>alert("x")</script>',
        },
      ],
    };
    const { html, text } = renderReportEmail(hostile, link);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(text).toContain("<script>");
  });

  it("limits the list to the most urgent problems", () => {
    const many: AuditReport = {
      ...report,
      groups: Array.from({ length: 12 }, (_, i) => ({
        ...(report.groups[0] as AuditReport["groups"][number]),
        ruleId: `rule-${i}`,
        title: `Problem ${i}`,
      })),
    };
    const { text } = renderReportEmail(many, link);
    expect(text).toContain("Problem 0");
    expect(text).toContain("Problem 4");
    expect(text).not.toContain("Problem 5");
  });

  it("says so when no problem was found", () => {
    const clean: AuditReport = {
      ...report,
      audit: { ...report.audit, score: 100 },
      totalIssues: 0,
      groups: [],
    };
    expect(renderReportEmail(clean, link).text).toMatch(/aucun problème/i);
  });
});
