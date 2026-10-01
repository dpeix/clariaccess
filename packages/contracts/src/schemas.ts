import { z } from "zod";

// Tuples are exported so other packages (db) reuse the same values.
export const IMPACTS = ["minor", "moderate", "serious", "critical"] as const;
export const AUDIT_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
] as const;
export const AUDIT_TYPES = ["free", "scheduled", "manual"] as const;

export const impactSchema = z.enum(IMPACTS).meta({ id: "Impact" });
export const auditStatusSchema = z
  .enum(AUDIT_STATUSES)
  .meta({ id: "AuditStatus" });
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
  })
  .meta({ id: "Audit" });

export const issueSchema = z
  .object({
    ruleId: z.string().min(1),
    impact: impactSchema,
    selector: z.string(),
    htmlExcerpt: z.string(),
    message: z.string(),
    wcagCriteria: z.array(z.string()),
    rgaaCriteria: z.array(z.string()),
  })
  .meta({ id: "Issue" });

export const auditReportSchema = z
  .object({
    audit: auditSchema,
    issues: z.array(issueSchema),
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
export type Issue = z.infer<typeof issueSchema>;
export type AuditReport = z.infer<typeof auditReportSchema>;
export type LeadRequest = z.infer<typeof leadRequestSchema>;
