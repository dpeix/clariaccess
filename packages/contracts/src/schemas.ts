import { z } from "zod";
import { PLANS, SCAN_FREQUENCIES } from "./plans.js";

// Tuples are exported so other packages (db) reuse the same values.
export const IMPACTS = ["minor", "moderate", "serious", "critical"] as const;
export const AUDIT_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
] as const;
// Why an audit ended in 'failed', short enough to show to the visitor.
export const AUDIT_FAILURE_REASONS = [
  "forbidden_url",
  "robots_disallowed",
  "scan_failed",
] as const;
export const AUDIT_TYPES = ["free", "scheduled", "manual"] as const;
export const MEMBERSHIP_ROLES = ["owner", "member"] as const;
export const VERIFICATION_METHODS = ["dns", "file"] as const;
export const FINDING_STATUSES = [
  "open",
  "fixed",
  "ignored",
  "regressed",
] as const;
export const MANUAL_STATUSES = ["ok", "ko", "na"] as const;
// "indetermine" is only ever computed (the audit is incomplete); a declaration
// states one of the other three.
export const COMPLIANCE_STATUSES = ["total", "partiel", "non"] as const;
export const COMPUTED_COMPLIANCE_STATUSES = [
  ...COMPLIANCE_STATUSES,
  "indetermine",
] as const;
export const STATEMENT_STATUSES = ["draft", "published", "superseded"] as const;
export const STATEMENT_LOCALES = ["fr"] as const;
export const TASK_STATUSES = ["todo", "doing", "done"] as const;
export const AUDIT_PAGE_STATUSES = ["pending", "done", "failed"] as const;

export const impactSchema = z.enum(IMPACTS).meta({ id: "Impact" });
export const auditStatusSchema = z
  .enum(AUDIT_STATUSES)
  .meta({ id: "AuditStatus" });
export const auditFailureReasonSchema = z
  .enum(AUDIT_FAILURE_REASONS)
  .meta({ id: "AuditFailureReason" });
export const auditTypeSchema = z.enum(AUDIT_TYPES).meta({ id: "AuditType" });

export const freeAuditRequestSchema = z
  .object({ url: z.url({ protocol: /^https?$/ }) })
  .meta({ id: "FreeAuditRequest" });

export const auditSchema = z
  .object({
    id: z.uuid(),
    url: z.url(),
    type: auditTypeSchema,
    status: auditStatusSchema,
    startedAt: z.iso.datetime().nullable(),
    finishedAt: z.iso.datetime().nullable(),
    pagesScanned: z.number().int().min(0),
    // Automated score only: manual criteria are not covered (see plan.md §3).
    score: z.number().int().min(0).max(100).nullable(),
    // Only set when status is 'failed'.
    failureReason: auditFailureReasonSchema.nullable(),
  })
  .meta({ id: "Audit" });

export const reportExampleSchema = z
  .object({ selector: z.string(), htmlExcerpt: z.string() })
  .meta({ id: "ReportExample" });

// All occurrences of one rule on the audited page.
export const reportGroupSchema = z
  .object({
    ruleId: z.string().min(1),
    title: z.string(),
    helpUrl: z.url().nullable(),
    impact: impactSchema,
    occurrences: z.number().int().min(1),
    // A few representative elements, not every occurrence.
    examples: z.array(reportExampleSchema),
    wcagCriteria: z.array(z.string()),
    rgaaCriteria: z.array(z.string()),
  })
  .meta({ id: "ReportGroup" });

export const auditReportSchema = z
  .object({
    audit: auditSchema,
    totalIssues: z.number().int().min(0),
    // Most urgent first.
    groups: z.array(reportGroupSchema),
    // Automated testing covers only part of the criteria: the report must say
    // so (plan.md §3).
    automatedCoverageNotice: z.string().min(1),
  })
  .meta({ id: "AuditReport" });

export const leadRequestSchema = z
  .object({
    email: z.email(),
    auditId: z.uuid(),
    // No lead without explicit consent (GDPR).
    consent: z.literal(true),
    source: z.string().min(1).max(100).optional(),
    utm: z.record(z.string(), z.string()).optional(),
  })
  .meta({ id: "LeadRequest" });

export const loginRequestSchema = z
  .object({ email: z.email() })
  .meta({ id: "LoginRequest" });

// The token travels in the login link: random, opaque, bounded.
export const verifyLoginRequestSchema = z
  .object({ token: z.string().min(1).max(200) })
  .meta({ id: "VerifyLoginRequest" });

export const membershipRoleSchema = z
  .enum(MEMBERSHIP_ROLES)
  .meta({ id: "MembershipRole" });

export const planSchema = z.enum(PLANS).meta({ id: "Plan" });
export const scanFrequencySchema = z
  .enum(SCAN_FREQUENCIES)
  .meta({ id: "ScanFrequency" });

export const planLimitsSchema = z
  .object({
    maxSites: z.number().int().min(1),
    maxPagesPerAudit: z.number().int().min(1),
    scheduledFrequencies: z.array(scanFrequencySchema),
    manualAuditsPerDayPerSite: z.number().int().min(1),
  })
  .meta({ id: "PlanLimits" });

export const organizationSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    // The caller's role in this organization.
    role: membershipRoleSchema,
    plan: planSchema,
    // What the plan allows, so screens can explain a refusal before it happens.
    limits: planLimitsSchema,
  })
  .meta({ id: "Organization" });

export const meSchema = z
  .object({
    user: z.object({ id: z.uuid(), email: z.email() }),
    organizations: z.array(organizationSchema),
  })
  .meta({ id: "Me" });

export const createOrganizationRequestSchema = z
  .object({ name: z.string().trim().min(1).max(100) })
  .meta({ id: "CreateOrganizationRequest" });

export const verificationMethodSchema = z
  .enum(VERIFICATION_METHODS)
  .meta({ id: "VerificationMethod" });

export const siteSchema = z
  .object({
    id: z.uuid(),
    orgId: z.uuid(),
    baseUrl: z.url(),
    verifiedAt: z.iso.datetime().nullable(),
    verificationMethod: verificationMethodSchema.nullable(),
    // Re-scan schedule; null: none.
    // Inline enum: a referenced enum made nullable generates a client type that
    // cannot hold null.
    scanFrequency: z.enum(SCAN_FREQUENCIES).nullable(),
    nextScanAt: z.iso.datetime().nullable(),
    // Either proof is enough: a DNS TXT record or a file on the site.
    verification: z.object({
      dnsRecord: z.object({
        type: z.literal("TXT"),
        name: z.string(),
        value: z.string(),
      }),
      file: z.object({ path: z.string(), content: z.string() }),
    }),
  })
  .meta({ id: "Site" });

export const taskStatusSchema = z
  .enum(TASK_STATUSES)
  .meta({ id: "TaskStatus" });

export const memberSchema = z
  .object({ id: z.uuid(), email: z.email() })
  .meta({ id: "Member" });

export const taskSchema = z
  .object({
    id: z.uuid(),
    siteId: z.uuid(),
    ruleId: z.string(),
    status: taskStatusSchema,
    // Sum of the priority of the rule's open findings; 0 when the task is done.
    priorityScore: z.number().int().min(0),
    openFindings: z.number().int().min(0),
    pagesAffected: z.number().int().min(0),
    assignee: memberSchema.nullable(),
    // Written advice for the rule; generic when there is none yet.
    guide: z.object({
      summary: z.string(),
      steps: z.array(z.string()),
      generic: z.boolean(),
    }),
    wcagCriteria: z.array(z.string()),
    rgaaCriteria: z.array(z.string()),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "Task" });

export const taskListSchema = z
  .object({ items: z.array(taskSchema), total: z.number().int().min(0) })
  .meta({ id: "TaskList" });

export const tasksQuerySchema = z.object({
  status: taskStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const updateTaskRequestSchema = z
  .object({
    status: taskStatusSchema.optional(),
    // null unassigns; absent leaves the assignee as it is.
    assigneeUserId: z.uuid().nullable().optional(),
  })
  .refine(
    (body) => body.status !== undefined || body.assigneeUserId !== undefined,
    {
      message: "status or assigneeUserId is required",
    },
  )
  .meta({ id: "UpdateTaskRequest" });

const httpUrl = z.url({ protocol: /^https?$/ });

export const manualStatusSchema = z
  .enum(MANUAL_STATUSES)
  .meta({ id: "ManualStatus" });
export const complianceStatusSchema = z
  .enum(COMPLIANCE_STATUSES)
  .meta({ id: "ComplianceStatus" });
export const computedComplianceStatusSchema = z
  .enum(COMPUTED_COMPLIANCE_STATUSES)
  .meta({ id: "ComputedComplianceStatus" });
export const statementStatusSchema = z
  .enum(STATEMENT_STATUSES)
  .meta({ id: "StatementStatus" });

export const upsertManualCheckRequestSchema = z
  .object({
    status: manualStatusSchema,
    notes: z.string().max(5000).optional(),
    // Only http(s): the link is shown to other people.
    evidenceUrl: httpUrl.max(2000).nullable().optional(),
  })
  .meta({ id: "UpsertManualCheckRequest" });

export const manualCheckListSchema = z
  .object({
    referentialVersion: z.string(),
    themes: z.array(z.object({ number: z.number().int(), title: z.string() })),
    criteria: z.array(
      z.object({
        id: z.string(),
        theme: z.number().int(),
        title: z.string(),
        // The scan looks at this criterion (it never validates it).
        autoTested: z.boolean(),
        axeRules: z.array(z.string()),
        // Open problems the scan reports on it; a person's "ok" is contradicted.
        autoProblems: z.number().int().min(0),
        check: z
          .object({
            status: manualStatusSchema,
            notes: z.string(),
            evidenceUrl: z.string().nullable(),
            checkedBy: z.string().nullable(),
            checkedAt: z.iso.datetime(),
          })
          .nullable(),
      }),
    ),
    progress: z.object({
      checked: z.number().int().min(0),
      total: z.number().int().min(0),
    }),
  })
  .meta({ id: "ManualCheckList" });

const STATEMENT_TEXT = 2000;

export const updateStatementRequestSchema = z
  .object({
    entityName: z.string().max(200).nullable().optional(),
    contactEmail: z.email().max(200).nullable().optional(),
    contactUrl: httpUrl.max(2000).nullable().optional(),
    derogations: z.string().max(STATEMENT_TEXT).nullable().optional(),
    samplePages: z.array(httpUrl.max(2000)).max(50).optional(),
    technologies: z.string().max(STATEMENT_TEXT).nullable().optional(),
    testEnvironment: z.string().max(STATEMENT_TEXT).nullable().optional(),
    tools: z.string().max(STATEMENT_TEXT).nullable().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "at least one field is required",
  })
  .meta({ id: "UpdateStatementRequest" });

export const publishStatementRequestSchema = z
  .object({ declaredStatus: complianceStatusSchema })
  .meta({ id: "PublishStatementRequest" });

export const statementSchema = z
  .object({
    id: z.uuid(),
    siteId: z.uuid(),
    version: z.number().int().min(1),
    status: statementStatusSchema,
    // What the audit supports (live for a draft, frozen once published).
    computedStatus: computedComplianceStatusSchema,
    // Inline enum: a referenced enum made nullable would turn the shared
    // component itself nullable in the generated client types.
    declaredStatus: z.enum(COMPLIANCE_STATUSES).nullable(),
    complianceRate: z.number().int().min(0).max(100).nullable(),
    // Levels the publisher may declare: the computed one or a more cautious one.
    allowedStatuses: z.array(complianceStatusSchema),
    counts: z.object({
      conforme: z.number().int().min(0),
      nonConforme: z.number().int().min(0),
      na: z.number().int().min(0),
      aVerifier: z.number().int().min(0),
    }),
    unattributed: z.number().int().min(0),
    entityName: z.string().nullable(),
    contactEmail: z.string().nullable(),
    contactUrl: z.string().nullable(),
    derogations: z.string().nullable(),
    samplePages: z.array(z.string()),
    technologies: z.string().nullable(),
    testEnvironment: z.string().nullable(),
    tools: z.string().nullable(),
    nonAccessibleContent: z.array(
      z.object({
        criterionId: z.string(),
        title: z.string(),
        sources: z.array(z.enum(["manual", "auto"])),
        notes: z.string(),
      }),
    ),
    locale: z.string(),
    referentialVersion: z.string(),
    // Fields still to fill in before publishing (see missingStatementFields).
    missing: z.array(z.string()),
    publicPath: z.string().nullable(),
    pdfReady: z.boolean(),
    publishedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "Statement" });

export const setScheduleRequestSchema = z
  .object({ frequency: z.enum(SCAN_FREQUENCIES).nullable() })
  .meta({ id: "SetScheduleRequest" });

export const createSiteRequestSchema = z
  .object({ baseUrl: z.url({ protocol: /^https?$/ }) })
  .meta({ id: "CreateSiteRequest" });

export const auditPageStatusSchema = z
  .enum(AUDIT_PAGE_STATUSES)
  .meta({ id: "AuditPageStatus" });

export const auditPageSchema = z
  .object({ url: z.url(), status: auditPageStatusSchema })
  .meta({ id: "AuditPage" });

export const findingStatusSchema = z
  .enum(FINDING_STATUSES)
  .meta({ id: "FindingStatus" });

export const findingSchema = z
  .object({
    id: z.uuid(),
    siteId: z.uuid(),
    pageUrl: z.url(),
    ruleId: z.string(),
    impact: impactSchema,
    status: findingStatusSchema,
    selector: z.string(),
    htmlExcerpt: z.string(),
    message: z.string(),
    firstSeenAuditId: z.uuid().nullable(),
    lastSeenAuditId: z.uuid().nullable(),
    priorityScore: z.number().int().min(1),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "Finding" });

export const findingListSchema = z
  .object({ items: z.array(findingSchema), total: z.number().int().min(0) })
  .meta({ id: "FindingList" });

export const findingsQuerySchema = z.object({
  status: findingStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// "fixed" and "regressed" are decided by audits, never by hand.
export const updateFindingRequestSchema = z
  .object({ status: z.enum(["open", "ignored"]) })
  .meta({ id: "UpdateFindingRequest" });

export const errorSchema = z
  .object({ error: z.string(), message: z.string() })
  .meta({ id: "Error" });

export type Impact = z.infer<typeof impactSchema>;
export type AuditStatus = z.infer<typeof auditStatusSchema>;
export type AuditType = z.infer<typeof auditTypeSchema>;
export type FreeAuditRequest = z.infer<typeof freeAuditRequestSchema>;
export type Audit = z.infer<typeof auditSchema>;
export type AuditFailureReason = z.infer<typeof auditFailureReasonSchema>;
export type ReportGroup = z.infer<typeof reportGroupSchema>;
export type AuditReport = z.infer<typeof auditReportSchema>;
export type LeadRequest = z.infer<typeof leadRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type Me = z.infer<typeof meSchema>;
export type Organization = z.infer<typeof organizationSchema>;
export type Site = z.infer<typeof siteSchema>;
export type AuditPage = z.infer<typeof auditPageSchema>;
export type Finding = z.infer<typeof findingSchema>;
export type FindingStatus = z.infer<typeof findingStatusSchema>;
export type Task = z.infer<typeof taskSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type Member = z.infer<typeof memberSchema>;
export type ManualStatus = z.infer<typeof manualStatusSchema>;
export type ComplianceStatus = z.infer<typeof complianceStatusSchema>;
export type ComputedComplianceStatus = z.infer<
  typeof computedComplianceStatusSchema
>;
export type StatementStatus = z.infer<typeof statementStatusSchema>;
export type Statement = z.infer<typeof statementSchema>;
export type ManualCheckList = z.infer<typeof manualCheckListSchema>;
