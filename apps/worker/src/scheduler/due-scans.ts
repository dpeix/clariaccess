import { and, eq, inArray, isNotNull, lte, or, type SQL } from "drizzle-orm";
import {
  PLANS,
  PLAN_LIMITS,
  SCAN_FREQUENCIES,
  frequencyIntervalMs,
  type ScanFrequency,
} from "@accessibility/contracts";
import {
  audits,
  organizations,
  sites,
  startSiteAudit,
  type Database,
} from "@accessibility/db";
import { SCAN_PAGE_JOB, type JobQueue } from "@accessibility/queue";
import type { Logger } from "../audit/run-audit.js";

export interface DueScansDeps {
  db: Database;
  queue: JobQueue;
  now: () => Date;
  // Sites handled per tick: the rest wait for the next one, so a burst of due
  // sites cannot flood the crawl queue.
  batchSize: number;
  log: Logger;
}

export interface DueScansOutcome {
  started: number;
  // Due, but an audit was already running: tried again soon.
  busy: number;
  // Audit created but its job could not be queued: undone, due again next tick.
  failed: number;
}

// A site whose audit slot is taken is looked at again after this, not after a
// whole interval: a manual audit finishes in minutes.
const BUSY_RETRY_MS = 60 * 60 * 1000;

// What the current plans allow, from the grid: a downgraded organization's
// sites simply stop matching, and match again if it upgrades.
function allowedByPlan(): SQL | undefined {
  const clauses = SCAN_FREQUENCIES.flatMap((frequency: ScanFrequency) => {
    const plans = PLANS.filter((plan) =>
      PLAN_LIMITS[plan].scheduledFrequencies.includes(frequency),
    );
    return plans.length === 0
      ? []
      : [
          and(
            eq(sites.scanFrequency, frequency),
            inArray(organizations.plan, [...plans]),
          ),
        ];
  });
  return or(...clauses);
}

// One tick of the scheduler: starts a scheduled audit for every verified site
// whose re-scan came due and whose plan allows it. Each site's audit and its
// next due date change in the same transaction, and rows are taken with SKIP
// LOCKED, so a repeated or concurrent tick never starts a site twice.
export async function runDueScans(
  deps: DueScansDeps,
): Promise<DueScansOutcome> {
  const { db, queue, log } = deps;
  const now = deps.now();
  const outcome: DueScansOutcome = { started: 0, busy: 0, failed: 0 };

  const created = await db.transaction(async (tx) => {
    const due = await tx
      .select({
        id: sites.id,
        baseUrl: sites.baseUrl,
        frequency: sites.scanFrequency,
        nextScanAt: sites.nextScanAt,
      })
      .from(sites)
      .innerJoin(organizations, eq(organizations.id, sites.orgId))
      .where(
        and(
          isNotNull(sites.verifiedAt),
          isNotNull(sites.scanFrequency),
          lte(sites.nextScanAt, now),
          allowedByPlan(),
        ),
      )
      .orderBy(sites.nextScanAt, sites.id)
      .limit(deps.batchSize)
      .for("update", { of: sites, skipLocked: true });

    const started: {
      siteId: string;
      auditId: string;
      pageId: string;
      previousDue: Date | null;
    }[] = [];
    for (const site of due) {
      const frequency = site.frequency as ScanFrequency;
      const result = await startSiteAudit(tx, site, { type: "scheduled" });
      if (result.kind === "created") {
        await tx
          .update(sites)
          .set({
            nextScanAt: new Date(
              now.getTime() + frequencyIntervalMs(frequency),
            ),
          })
          .where(eq(sites.id, site.id));
        started.push({
          siteId: site.id,
          auditId: result.audit.id,
          pageId: result.pageId,
          previousDue: site.nextScanAt,
        });
      } else {
        // "limit" cannot happen for a scheduled audit; anything else is a
        // running audit.
        await tx
          .update(sites)
          .set({ nextScanAt: new Date(now.getTime() + BUSY_RETRY_MS) })
          .where(eq(sites.id, site.id));
        outcome.busy += 1;
      }
    }
    return started;
  });

  // After the commit: a job must never run before its audit exists.
  for (const item of created) {
    try {
      const jobId = await queue.enqueue(SCAN_PAGE_JOB, {
        auditId: item.auditId,
        pageId: item.pageId,
      });
      if (jobId === null) throw new Error("the queue refused the job");
      outcome.started += 1;
    } catch (error) {
      // Nothing would ever run this audit: undo it so the site is not blocked,
      // and keep the site due so the next tick tries again.
      log.error(
        `scheduler: audit ${item.auditId} not queued, ${error instanceof Error ? error.message : String(error)}`,
      );
      await db.transaction(async (tx) => {
        await tx.delete(audits).where(eq(audits.id, item.auditId));
        await tx
          .update(sites)
          .set({ nextScanAt: item.previousDue })
          .where(eq(sites.id, item.siteId));
      });
      outcome.failed += 1;
    }
  }
  if (created.length > 0 || outcome.busy > 0) {
    log.info(
      `scheduler: ${outcome.started} started, ${outcome.busy} busy, ${outcome.failed} failed`,
    );
  }
  return outcome;
}
