import { z } from "zod";

// Name and payload of the job that runs one audit. The payload only carries
// the id: the worker reads the URL from the database, never from the queue.
export const RUN_AUDIT_JOB = "run-audit";
export const runAuditPayloadSchema = z.object({ auditId: z.uuid() });
export type RunAuditPayload = z.infer<typeof runAuditPayloadSchema>;

// Scans one page of a multi-page audit. A page found by the scan becomes a new
// job, so the crawl is a chain of small jobs rather than one long one.
export const SCAN_PAGE_JOB = "scan-page";
export const scanPagePayloadSchema = z.object({
  auditId: z.uuid(),
  pageId: z.uuid(),
});
export type ScanPagePayload = z.infer<typeof scanPagePayloadSchema>;

// Emails the regression alert of one completed re-scan. Carries only the audit
// id: recipients and findings are read from the database.
export const SEND_ALERT_JOB = "send-alert";
export const sendAlertPayloadSchema = z.object({ auditId: z.uuid() });
export type SendAlertPayload = z.infer<typeof sendAlertPayloadSchema>;

// A mail server may be down for a while: more attempts than the default, spread
// over about ten minutes. Whichever process creates the queue first sets the
// policy, so every producer and consumer passes it.
export const SEND_ALERT_QUEUE_OPTIONS = {
  retryLimit: 6,
  retryDelaySeconds: 60,
  jobExpireSeconds: 120,
} as const;

// Renders a published accessibility statement to PDF. Carries only the id: the
// content is read from the database, never from the queue.
export const RENDER_STATEMENT_PDF_JOB = "render-statement-pdf";
export const renderStatementPdfPayloadSchema = z.object({
  statementId: z.uuid(),
});
export type RenderStatementPdfPayload = z.infer<
  typeof renderStatementPdfPayloadSchema
>;

// A browser may be busy or restarting: a few attempts, spread out.
export const RENDER_STATEMENT_PDF_QUEUE_OPTIONS = {
  retryLimit: 4,
  retryDelaySeconds: 30,
  jobExpireSeconds: 180,
} as const;

// Recurring tick of the scheduler: starts the re-scans that came due. Carries
// no payload; what is due is read from the database each time.
export const DUE_SCANS_JOB = "due-scans";

// Checks that a customer controls a site (DNS TXT or well-known file). Only the
// site id travels: the token to look for stays in the database.
export const VERIFY_SITE_JOB = "verify-site";
export const verifySitePayloadSchema = z.object({ siteId: z.uuid() });
export type VerifySitePayload = z.infer<typeof verifySitePayloadSchema>;

// Sends the report email of one lead. Carries only the lead id: the address
// stays in the database, not in the queue tables.
export const SEND_REPORT_JOB = "send-report";
export const sendReportPayloadSchema = z.object({ leadId: z.uuid() });
export type SendReportPayload = z.infer<typeof sendReportPayloadSchema>;

// The visitor may leave an address while the audit still runs: the job keeps
// retrying (about two minutes) until the report exists, instead of the default
// two attempts. Whichever process creates the queue first sets this policy, so
// callers pass it everywhere the queue is created.
export const SEND_REPORT_QUEUE_OPTIONS = {
  retryLimit: 8,
  retryDelaySeconds: 15,
  jobExpireSeconds: 120,
} as const;

// Recurring jobs. Separate from JobQueue because only the process that owns a
// periodic task (the worker's scheduler) needs it, and every fake of JobQueue
// would otherwise have to grow a method it never uses.
export interface JobScheduler {
  // Makes `name` run on a cron expression (UTC). Safe to call at every start:
  // the same name keeps a single schedule, updated if the expression changed,
  // and across several instances only one of them gets each occurrence.
  schedule(name: string, cron: string, payload?: object): Promise<void>;
}

// Narrow on purpose: what the worker needs, nothing pg-boss specific, so the
// implementation can be swapped (BullMQ, Temporal) without touching callers.
export interface JobQueue {
  start(): Promise<void>;
  // Resolves to the job id, or null when the queue refused to create it.
  enqueue(name: string, payload: object): Promise<string | null>;
  // Payloads come from a shared database: handlers must validate them.
  // A rejected handler marks the attempt failed and the queue may retry it.
  work(
    name: string,
    handler: (payload: unknown) => Promise<void>,
  ): Promise<void>;
  // Waits for running jobs to finish, then releases connections.
  stop(): Promise<void>;
}
