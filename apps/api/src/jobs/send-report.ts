import { and, eq, isNull } from "drizzle-orm";
import { leads, type Database } from "@accessibility/db";
import {
  SEND_REPORT_JOB,
  sendReportPayloadSchema,
  type JobQueue,
} from "@accessibility/queue";
import { findAudit, findReportIssues } from "../audits/store.js";
import type { Mailer } from "../mail/mailer.js";
import { renderReportEmail } from "../mail/report-email.js";
import { buildReport } from "../report/build-report.js";

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface SendReportDeps {
  db: Database;
  mailer: Mailer;
  publicSiteUrl: string;
  log: Logger;
}

export async function registerSendReportWorker(
  queue: JobQueue,
  deps: SendReportDeps,
): Promise<void> {
  await queue.work(SEND_REPORT_JOB, async (payload) => {
    // Payloads come from a shared database: validate before trusting them.
    const { leadId } = sendReportPayloadSchema.parse(payload);
    await sendReport(deps, leadId);
  });
}

// Delivery is at-least-once: a crash between sending and recording could send
// twice, never zero times. Errors are thrown so that the queue retries.
async function sendReport(deps: SendReportDeps, leadId: string): Promise<void> {
  const { db, mailer, log } = deps;

  const [lead] = await db
    .select({
      email: leads.email,
      auditId: leads.auditId,
      reportSentAt: leads.reportSentAt,
    })
    .from(leads)
    .where(eq(leads.id, leadId));
  if (lead === undefined || lead.auditId === null) {
    log.warn(`lead ${leadId}: not found or without audit, nothing to send`);
    return;
  }
  if (lead.reportSentAt !== null) return;

  const audit = await findAudit(db, lead.auditId);
  if (audit === null) {
    log.warn(`lead ${leadId}: audit ${lead.auditId} not found`);
    return;
  }
  if (audit.status === "failed") {
    log.warn(`lead ${leadId}: audit ${audit.id} failed, no report to send`);
    return;
  }
  // The visitor may leave their address while the audit still runs.
  if (audit.status !== "completed") {
    throw new Error(`Audit ${audit.id} is not finished yet`);
  }

  const report = buildReport(audit, await findReportIssues(db, audit.id));
  // The public site is static: one /audit/ page that reads the id from the
  // query, since ids cannot be pre-rendered.
  const reportUrl = new URL("/audit/", deps.publicSiteUrl);
  reportUrl.searchParams.set("id", audit.id);
  await mailer.send({
    to: lead.email,
    ...renderReportEmail(report, reportUrl.href),
  });

  await db
    .update(leads)
    .set({ reportSentAt: new Date() })
    .where(and(eq(leads.id, leadId), isNull(leads.reportSentAt)));
  log.info(`lead ${leadId}: report sent`);
}
