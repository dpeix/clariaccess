import { and, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import {
  auditPages,
  findings,
  issues,
  remediationTasks,
  type Database,
} from "@accessibility/db";
import { priorityScore } from "@accessibility/rules";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

// Keeps every statement well under Postgres' 65535 bind-parameter limit.
const UPSERT_CHUNK = 500;

// Brings the findings of a site up to date with a completed audit. Called in
// the transaction that completes the audit, so findings and audit agree.
//
// - A problem seen again stays as it is, except a fixed one: it regressed.
//   An ignored one stays ignored: that was the customer's decision.
// - An open or regressed problem not seen again is fixed, but only if its page
//   was actually scanned: a page skipped by the cap, robots.txt or an error
//   says nothing about its problems.
export async function syncFindings(
  tx: Tx,
  auditId: string,
  siteId: string,
): Promise<void> {
  const found = await tx
    .select({
      pageId: issues.pageId,
      ruleId: issues.ruleId,
      impact: issues.impact,
      selector: issues.selector,
      htmlExcerpt: issues.htmlExcerpt,
      message: issues.message,
      fingerprint: issues.fingerprint,
    })
    .from(issues)
    .where(eq(issues.auditId, auditId));

  // One finding per page and problem, even if the audit repeats it.
  const byKey = new Map<string, (typeof found)[number]>();
  const pagesByFingerprint = new Map<string, Set<string>>();
  for (const issue of found) {
    byKey.set(`${issue.pageId}|${issue.fingerprint}`, issue);
    const pagesWith = pagesByFingerprint.get(issue.fingerprint) ?? new Set();
    pagesWith.add(issue.pageId);
    pagesByFingerprint.set(issue.fingerprint, pagesWith);
  }

  const rows = [...byKey.values()].map((issue) => ({
    siteId,
    pageId: issue.pageId,
    ruleId: issue.ruleId,
    fingerprint: issue.fingerprint,
    impact: issue.impact,
    selector: issue.selector,
    htmlExcerpt: issue.htmlExcerpt,
    message: issue.message,
    firstSeenAuditId: auditId,
    lastSeenAuditId: auditId,
    // The same problem on several pages is one shared fix: more urgent.
    priorityScore: priorityScore(
      issue.impact,
      pagesByFingerprint.get(issue.fingerprint)?.size ?? 1,
    ),
  }));

  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    await tx
      .insert(findings)
      .values(rows.slice(i, i + UPSERT_CHUNK))
      .onConflictDoUpdate({
        target: [findings.siteId, findings.pageId, findings.fingerprint],
        set: {
          ruleId: sql`excluded.rule_id`,
          impact: sql`excluded.impact`,
          selector: sql`excluded.selector`,
          htmlExcerpt: sql`excluded.html_excerpt`,
          message: sql`excluded.message`,
          lastSeenAuditId: sql`excluded.last_seen_audit_id`,
          priorityScore: sql`excluded.priority_score`,
          // Evaluated against the row as it was before this update.
          regressedAuditId: sql`case when ${findings.status} = 'fixed' then excluded.last_seen_audit_id else ${findings.regressedAuditId} end`,
          status: sql`case when ${findings.status} = 'fixed' then 'regressed'::finding_status else ${findings.status} end`,
          updatedAt: sql`now()`,
        },
      });
  }

  const scanned = tx
    .select({ pageId: auditPages.pageId })
    .from(auditPages)
    .where(and(eq(auditPages.auditId, auditId), eq(auditPages.status, "done")));
  await tx
    .update(findings)
    .set({ status: "fixed", updatedAt: sql`now()` })
    .where(
      and(
        eq(findings.siteId, siteId),
        inArray(findings.status, ["open", "regressed"]),
        inArray(findings.pageId, scanned),
        // Not refreshed by this audit (also true for a purged audit id: null).
        sql`${findings.lastSeenAuditId} is distinct from ${auditId}`,
      ),
    );
}

// One task per rule on the site, kept in step with its findings:
// - its priority is the sum of the open and regressed findings' priority;
// - a rule with no such finding left is done (fixed, or ignored by the customer);
// - a done task whose problem is back is to do again;
// - a status a person set ("doing") is kept while the problem is still there.
export async function syncTasks(tx: Tx, siteId: string): Promise<void> {
  const live = await tx
    .select({
      ruleId: findings.ruleId,
      priority: sql<number>`sum(${findings.priorityScore})::int`,
    })
    .from(findings)
    .where(
      and(
        eq(findings.siteId, siteId),
        inArray(findings.status, ["open", "regressed"]),
      ),
    )
    .groupBy(findings.ruleId);

  if (live.length > 0) {
    await tx
      .insert(remediationTasks)
      .values(
        live.map((rule) => ({
          siteId,
          ruleId: rule.ruleId,
          priorityScore: rule.priority,
        })),
      )
      .onConflictDoUpdate({
        target: [remediationTasks.siteId, remediationTasks.ruleId],
        set: {
          priorityScore: sql`excluded.priority_score`,
          status: sql`case when ${remediationTasks.status} = 'done' then 'todo'::task_status else ${remediationTasks.status} end`,
          updatedAt: sql`now()`,
        },
      });
  }

  await tx
    .update(remediationTasks)
    .set({ status: "done", priorityScore: 0, updatedAt: sql`now()` })
    .where(
      and(
        eq(remediationTasks.siteId, siteId),
        ne(remediationTasks.status, "done"),
        live.length === 0
          ? undefined
          : notInArray(
              remediationTasks.ruleId,
              live.map((rule) => rule.ruleId),
            ),
      ),
    );
}
