import { z } from "zod";

// Name and payload of the job that runs one audit. The payload only carries
// the id: the worker reads the URL from the database, never from the queue.
export const RUN_AUDIT_JOB = "run-audit";
export const runAuditPayloadSchema = z.object({ auditId: z.uuid() });
export type RunAuditPayload = z.infer<typeof runAuditPayloadSchema>;

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
