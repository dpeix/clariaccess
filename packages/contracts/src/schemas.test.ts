import { describe, expect, it } from "vitest";
import {
  AUDIT_FAILURE_REASONS,
  AUDIT_STATUSES,
  AUDIT_TYPES,
  AUDIT_PAGE_STATUSES,
  FINDING_STATUSES,
  IMPACTS,
  MEMBERSHIP_ROLES,
  VERIFICATION_METHODS,
  auditReportSchema,
  auditSchema,
  freeAuditRequestSchema,
  createOrganizationRequestSchema,
  createSiteRequestSchema,
  findingListSchema,
  impactSchema,
  leadRequestSchema,
  loginRequestSchema,
  organizationSchema,
  setScheduleRequestSchema,
  TASK_STATUSES,
  taskListSchema,
  taskSchema,
  tasksQuerySchema,
  updateTaskRequestSchema,
  siteSchema,
  updateFindingRequestSchema,
  verifyLoginRequestSchema,
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

describe("account enums", () => {
  it("lists roles, verification methods, finding and page statuses", () => {
    expect(MEMBERSHIP_ROLES).toEqual(["owner", "member"]);
    expect(VERIFICATION_METHODS).toEqual(["dns", "file"]);
    expect(FINDING_STATUSES).toEqual(["open", "fixed", "ignored", "regressed"]);
    expect(AUDIT_PAGE_STATUSES).toEqual(["pending", "done", "failed"]);
  });
});

describe("loginRequestSchema", () => {
  it("accepts an email and rejects anything else", () => {
    expect(loginRequestSchema.safeParse({ email: "a@b.fr" }).success).toBe(
      true,
    );
    expect(loginRequestSchema.safeParse({ email: "nope" }).success).toBe(false);
    expect(loginRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("verifyLoginRequestSchema", () => {
  it("requires a plausible token and bounds its size", () => {
    const token = "a".repeat(43);
    expect(verifyLoginRequestSchema.safeParse({ token }).success).toBe(true);
    expect(verifyLoginRequestSchema.safeParse({ token: "" }).success).toBe(
      false,
    );
    expect(
      verifyLoginRequestSchema.safeParse({ token: "a".repeat(500) }).success,
    ).toBe(false);
  });
});

describe("createOrganizationRequestSchema", () => {
  it("trims the name and refuses an empty or huge one", () => {
    expect(
      createOrganizationRequestSchema.parse({ name: "  Acme  " }).name,
    ).toBe("Acme");
    expect(
      createOrganizationRequestSchema.safeParse({ name: "   " }).success,
    ).toBe(false);
    expect(
      createOrganizationRequestSchema.safeParse({ name: "x".repeat(101) })
        .success,
    ).toBe(false);
  });
});

describe("createSiteRequestSchema", () => {
  it("accepts http(s) urls only", () => {
    expect(
      createSiteRequestSchema.safeParse({ baseUrl: "https://acme.fr" }).success,
    ).toBe(true);
    expect(
      createSiteRequestSchema.safeParse({ baseUrl: "ftp://acme.fr" }).success,
    ).toBe(false);
  });
});

describe("updateFindingRequestSchema", () => {
  it("lets a user ignore or reopen, never mark fixed or regressed", () => {
    expect(
      updateFindingRequestSchema.safeParse({ status: "ignored" }).success,
    ).toBe(true);
    expect(
      updateFindingRequestSchema.safeParse({ status: "open" }).success,
    ).toBe(true);
    expect(
      updateFindingRequestSchema.safeParse({ status: "fixed" }).success,
    ).toBe(false);
    expect(
      updateFindingRequestSchema.safeParse({ status: "regressed" }).success,
    ).toBe(false);
  });
});

describe("siteSchema", () => {
  const site = {
    id: auditId,
    orgId: auditId,
    baseUrl: "https://acme.fr",
    verifiedAt: null,
    verificationMethod: null,
    scanFrequency: null,
    nextScanAt: null,
    verification: {
      dnsRecord: {
        type: "TXT",
        name: "_clariaccess.acme.fr",
        value: "clariaccess-verify=abc",
      },
      file: {
        path: "/.well-known/clariaccess-abc.txt",
        content: "clariaccess-verify=abc",
      },
    },
  };

  it("describes how to prove ownership", () => {
    expect(siteSchema.safeParse(site).success).toBe(true);
  });

  it("rejects an unknown verification method", () => {
    expect(
      siteSchema.safeParse({ ...site, verificationMethod: "carrier-pigeon" })
        .success,
    ).toBe(false);
  });
});

describe("findingListSchema", () => {
  it("wraps findings with the total count", () => {
    expect(findingListSchema.safeParse({ items: [], total: 0 }).success).toBe(
      true,
    );
    expect(findingListSchema.safeParse({ items: [] }).success).toBe(false);
  });
});

describe("organizationSchema", () => {
  const org = {
    id: auditId,
    name: "Acme",
    role: "owner",
    plan: "free",
    limits: {
      maxSites: 1,
      maxPagesPerAudit: 10,
      scheduledFrequencies: [],
      manualAuditsPerDayPerSite: 2,
    },
  };

  it("carries the plan and what it allows", () => {
    expect(organizationSchema.safeParse(org).success).toBe(true);
  });

  it("rejects a plan that is not in the grid", () => {
    expect(
      organizationSchema.safeParse({ ...org, plan: "enterprise" }).success,
    ).toBe(false);
  });
});

describe("setScheduleRequestSchema", () => {
  it("accepts a frequency or null to switch re-scans off", () => {
    expect(
      setScheduleRequestSchema.safeParse({ frequency: "daily" }).success,
    ).toBe(true);
    expect(
      setScheduleRequestSchema.safeParse({ frequency: "weekly" }).success,
    ).toBe(true);
    expect(
      setScheduleRequestSchema.safeParse({ frequency: null }).success,
    ).toBe(true);
  });

  it("rejects anything else, and a missing field", () => {
    expect(
      setScheduleRequestSchema.safeParse({ frequency: "hourly" }).success,
    ).toBe(false);
    expect(setScheduleRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("tasks", () => {
  const task = {
    id: auditId,
    siteId: auditId,
    ruleId: "image-alt",
    status: "todo",
    priorityScore: 12,
    openFindings: 3,
    pagesAffected: 2,
    assignee: null,
    guide: {
      summary: "Une image n'a pas d'alternative.",
      steps: ["Ajoutez alt."],
      generic: false,
    },
    wcagCriteria: ["1.1.1"],
    rgaaCriteria: ["1.1"],
    updatedAt: "2026-10-01T10:00:00.000Z",
  };

  it("lists the task statuses", () => {
    expect(TASK_STATUSES).toEqual(["todo", "doing", "done"]);
  });

  it("describes a task with its guide and who has it", () => {
    expect(taskSchema.safeParse(task).success).toBe(true);
    expect(
      taskSchema.safeParse({
        ...task,
        assignee: { id: auditId, email: "a@b.fr" },
      }).success,
    ).toBe(true);
  });

  it("rejects a task with a negative count or an unknown status", () => {
    expect(taskSchema.safeParse({ ...task, openFindings: -1 }).success).toBe(
      false,
    );
    expect(taskSchema.safeParse({ ...task, status: "stuck" }).success).toBe(
      false,
    );
  });

  it("wraps tasks with the total", () => {
    expect(taskListSchema.safeParse({ items: [task], total: 1 }).success).toBe(
      true,
    );
    expect(taskListSchema.safeParse({ items: [] }).success).toBe(false);
  });

  it("bounds the list query like the findings one", () => {
    expect(
      tasksQuerySchema.safeParse({ status: "doing", limit: "20", offset: "0" })
        .success,
    ).toBe(true);
    expect(tasksQuerySchema.safeParse({ status: "gone" }).success).toBe(false);
    expect(tasksQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
  });

  it("lets a task be moved and assigned, or unassigned with null, but not left empty", () => {
    expect(updateTaskRequestSchema.safeParse({ status: "doing" }).success).toBe(
      true,
    );
    expect(
      updateTaskRequestSchema.safeParse({ assigneeUserId: auditId }).success,
    ).toBe(true);
    expect(
      updateTaskRequestSchema.safeParse({ assigneeUserId: null }).success,
    ).toBe(true);
    expect(
      updateTaskRequestSchema.safeParse({
        status: "done",
        assigneeUserId: null,
      }).success,
    ).toBe(true);
    expect(updateTaskRequestSchema.safeParse({}).success).toBe(false);
    expect(updateTaskRequestSchema.safeParse({ status: "stuck" }).success).toBe(
      false,
    );
    expect(
      updateTaskRequestSchema.safeParse({ assigneeUserId: "not-a-uuid" })
        .success,
    ).toBe(false);
  });
});
