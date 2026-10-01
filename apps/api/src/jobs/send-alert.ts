import { and, eq, inArray, isNull, lt, ne, or } from "drizzle-orm";
import {
  audits,
  findings,
  memberships,
  pages,
  sites,
  users,
  type Database,
} from "@accessibility/db";
import {
  SEND_ALERT_JOB,
  sendAlertPayloadSchema,
  type JobQueue,
} from "@accessibility/queue";
import { summarizeAlert, type AlertFinding } from "../alerts/summary.js";
import { renderAlertEmail } from "../mail/alert-email.js";
import type { Mailer } from "../mail/mailer.js";
import type { Logger } from "./send-report.js";

export interface SendAlertDeps {
  db: Database;
  mailer: Mailer;
  // Origin of the customer app, for the link to the audit.
  appUrl: string;
  log: Logger;
}

export async function registerSendAlertWorker(
  queue: JobQueue,
  deps: SendAlertDeps,
): Promise<void> {
  await queue.work(SEND_ALERT_JOB, async (payload) => {
    // Payloads come from a shared database: validate before trusting them.
    const { auditId } = sendAlertPayloadSchema.parse(payload);
    await sendAlert(deps, auditId);
  });
}

// Emails the members of an organization about a completed re-scan, once.
//
// The audit is claimed (alert_sent_at) before anything is sent, so two
// deliveries of the job never both send. If every send fails the claim is
// released and the job fails, to be retried. If only some fail the claim stays:
// the others already got the mail and a retry would send it to them again, so a
// recipient that failed is logged and dropped rather than duplicating mails.
async function sendAlert(deps: SendAlertDeps, auditId: string): Promise<void> {
  const { db, mailer, log } = deps;

  const [audit] = await db
    .select({
      id: audits.id,
      type: audits.type,
      status: audits.status,
      siteId: audits.siteId,
      createdAt: audits.createdAt,
      alertSentAt: audits.alertSentAt,
      baseUrl: sites.baseUrl,
      orgId: sites.orgId,
    })
    .from(audits)
    .innerJoin(sites, eq(sites.id, audits.siteId))
    .where(eq(audits.id, auditId));
  if (
    audit === undefined ||
    audit.orgId === null ||
    audit.type !== "scheduled" ||
    audit.status !== "completed" ||
    audit.alertSentAt !== null
  ) {
    log.info(`audit ${auditId}: no alert to send`);
    return;
  }

  const [previous] = await db
    .select({ id: audits.id })
    .from(audits)
    .where(
      and(
        eq(audits.siteId, audit.siteId),
        eq(audits.status, "completed"),
        ne(audits.type, "free"),
        ne(audits.id, audit.id),
        lt(audits.createdAt, audit.createdAt),
      ),
    )
    .limit(1);

  const rows = await db
    .select({
      ruleId: findings.ruleId,
      impact: findings.impact,
      pageUrl: pages.url,
      message: findings.message,
      regressedAuditId: findings.regressedAuditId,
    })
    .from(findings)
    .innerJoin(pages, eq(pages.id, findings.pageId))
    .where(
      and(
        eq(findings.lastSeenAuditId, audit.id),
        or(
          eq(findings.regressedAuditId, audit.id),
          and(
            eq(findings.firstSeenAuditId, audit.id),
            inArray(findings.impact, ["serious", "critical"]),
          ),
        ),
      ),
    );
  const alertFindings: AlertFinding[] = rows.map((row) => ({
    ruleId: row.ruleId,
    impact: row.impact,
    pageUrl: row.pageUrl,
    message: row.message,
    kind: row.regressedAuditId === audit.id ? "regression" : "new",
  }));
  const summary = summarizeAlert({
    hasPreviousAudit: previous !== undefined,
    findings: alertFindings,
  });
  if (summary === null) {
    log.info(`audit ${auditId}: nothing new, no alert`);
    return;
  }

  const recipients = await db
    .select({ email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, audit.orgId))
    .orderBy(users.email);
  if (recipients.length === 0) return;

  const [claimed] = await db
    .update(audits)
    .set({ alertSentAt: new Date() })
    .where(and(eq(audits.id, audit.id), isNull(audits.alertSentAt)))
    .returning({ id: audits.id });
  if (claimed === undefined) return;

  const link = new URL(`/audits/${audit.id}`, deps.appUrl).href;
  const message = renderAlertEmail(audit.baseUrl, summary, link);
  let sent = 0;
  let failed = 0;
  for (const { email } of recipients) {
    try {
      await mailer.send({ to: email, ...message });
      sent += 1;
    } catch (error) {
      failed += 1;
      // Not logged with the address: it is personal data.
      log.error(
        `audit ${auditId}: alert not sent to one recipient, ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (sent === 0) {
    await db
      .update(audits)
      .set({ alertSentAt: null })
      .where(eq(audits.id, audit.id));
    throw new Error(`Alert for audit ${auditId} could not be sent to anyone`);
  }
  log.info(`audit ${auditId}: alert sent to ${sent} of ${sent + failed}`);
}
