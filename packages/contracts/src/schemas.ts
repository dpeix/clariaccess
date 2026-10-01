import { z } from "zod";

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
