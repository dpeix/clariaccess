import { describe, expect, it } from "vitest";
import {
  AUDIT_FAILURE_REASONS,
  AUDIT_STATUSES,
  AUDIT_TYPES,
  IMPACTS,
  auditReportSchema,
  auditSchema,
  freeAuditRequestSchema,
  impactSchema,
  leadRequestSchema,
} from "./schemas.js";

const auditId = "6f1c1c1e-8d5e-4a37-9d57-3c1a4f0f2a10";

describe("shared enums", () => {
  it("lists the axe impacts from least to most severe", () => {
    expect(IMPACTS).toEqual(["minor", "moderate", "serious", "critical"]);
  });

  it("exposes audit statuses and types", () => {
    expect(AUDIT_STATUSES).toEqual([
      "queued",
      "running",
      "completed",
      "failed",
    ]);
    expect(AUDIT_TYPES).toEqual(["free", "scheduled", "manual"]);
    expect(AUDIT_FAILURE_REASONS).toEqual([
      "forbidden_url",
      "robots_disallowed",
      "scan_failed",
    ]);
  });

  it("rejects an impact outside the enum", () => {
    expect(impactSchema.safeParse("blocker").success).toBe(false);
  });
});

describe("freeAuditRequestSchema", () => {
  it("accepts an http(s) URL", () => {
    expect(
      freeAuditRequestSchema.safeParse({ url: "https://example.fr/page" })
        .success,
    ).toBe(true);
    expect(
      freeAuditRequestSchema.safeParse({ url: "http://example.fr" }).success,
    ).toBe(true);
  });

  it.each([
    "not a url",
    "ftp://example.fr",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "",
  ])("rejects %j", (url) => {
    expect(freeAuditRequestSchema.safeParse({ url }).success).toBe(false);
  });

  it("rejects a missing url", () => {
    expect(freeAuditRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("leadRequestSchema", () => {
  const valid = { email: "contact@example.fr", auditId, consent: true };

  it("accepts a lead with consent", () => {
    expect(leadRequestSchema.safeParse(valid).success).toBe(true);
  });

  it("requires consent to be explicitly true", () => {
    expect(
      leadRequestSchema.safeParse({ ...valid, consent: false }).success,
    ).toBe(false);
    expect(
      leadRequestSchema.safeParse({ email: valid.email, auditId }).success,
    ).toBe(false);
  });

  it("rejects an invalid email or audit id", () => {
    expect(
      leadRequestSchema.safeParse({ ...valid, email: "nope" }).success,
    ).toBe(false);
    expect(
      leadRequestSchema.safeParse({ ...valid, auditId: "123" }).success,
    ).toBe(false);
  });

  it("accepts optional source and utm", () => {
    const result = leadRequestSchema.safeParse({
      ...valid,
      source: "seo",
      utm: { utm_source: "newsletter" },
    });
    expect(result.success).toBe(true);
  });
});

describe("auditSchema and auditReportSchema", () => {
  const audit = {
    id: auditId,
    url: "https://example.fr",
    type: "free",
    status: "completed",
    startedAt: "2026-10-01T10:00:00.000Z",
    finishedAt: "2026-10-01T10:00:30.000Z",
    pagesScanned: 1,
    score: 82,
    failureReason: null,
  };

  it("accepts a completed audit", () => {
    expect(auditSchema.safeParse(audit).success).toBe(true);
  });

  it("accepts a queued audit with no dates or score yet", () => {
    const queued = {
      ...audit,
      status: "queued",
      startedAt: null,
      finishedAt: null,
      score: null,
      pagesScanned: 0,
    };
    expect(auditSchema.safeParse(queued).success).toBe(true);
  });

  it("rejects a score outside 0-100 or an unknown status", () => {
    expect(auditSchema.safeParse({ ...audit, score: 101 }).success).toBe(false);
    expect(auditSchema.safeParse({ ...audit, status: "done" }).success).toBe(
      false,
    );
  });

  it("accepts a failed audit with its reason and rejects an unknown one", () => {
    const failed = {
      ...audit,
      status: "failed",
      score: null,
      failureReason: "robots_disallowed",
    };
    expect(auditSchema.safeParse(failed).success).toBe(true);
    expect(
      auditSchema.safeParse({ ...failed, failureReason: "oops" }).success,
    ).toBe(false);
  });

  const group = {
    ruleId: "image-alt",
    title: "Images must have alternate text",
    helpUrl: "https://dequeuniversity.com/rules/axe/4.13/image-alt",
    impact: "critical",
    occurrences: 3,
    examples: [{ selector: "img.hero", htmlExcerpt: '<img src="a.png">' }],
    wcagCriteria: ["1.1.1"],
    rgaaCriteria: ["1.1"],
  };
  const report = {
    audit,
    totalIssues: 3,
    groups: [group],
    automatedCoverageNotice: "Seule une partie des critères est automatisable.",
  };

  it("accepts a report with grouped issues and the coverage notice", () => {
    expect(auditReportSchema.safeParse(report).success).toBe(true);
  });

  it("accepts a clean report with no group and a rule without help link", () => {
    expect(
      auditReportSchema.safeParse({ ...report, totalIssues: 0, groups: [] })
        .success,
    ).toBe(true);
    expect(
      auditReportSchema.safeParse({
        ...report,
        groups: [{ ...group, helpUrl: null }],
      }).success,
    ).toBe(true);
  });

  it("requires the coverage notice and a positive occurrence count", () => {
    const withoutNotice = { audit, totalIssues: 3, groups: [group] };
    expect(auditReportSchema.safeParse(withoutNotice).success).toBe(false);
    expect(
      auditReportSchema.safeParse({
        ...report,
        groups: [{ ...group, occurrences: 0 }],
      }).success,
    ).toBe(false);
  });
});
