import { and, count, eq, inArray, sql } from "drizzle-orm";
import { planLimits } from "@accessibility/contracts";
import {
  auditPages,
  audits,
  issues,
  organizations,
  pages,
  sites,
  type Database,
} from "@accessibility/db";
import {
  SCAN_PAGE_JOB,
  SEND_ALERT_JOB,
  type JobQueue,
} from "@accessibility/queue";
import { RULES_VERSION, computeScore } from "@accessibility/rules";
import {
  ISSUE_INSERT_CHUNK,
  MAX_HTML_EXCERPT_LENGTH,
  type Logger,
} from "../audit/run-audit.js";
import { normalizeViolations } from "../audit/normalize.js";
import type { Scan } from "../audit/scanner.js";
import type { RobotsDecision } from "../security/robots.js";
import { UrlNotAllowedError } from "../security/ssrf.js";
import { syncFindings, syncTasks } from "./findings.js";
import { crawlableUrls, normalizeCrawlUrl, sitemapLocations } from "./urls.js";

export interface ScanPageDeps {
  db: Database;
  queue: JobQueue;
  scan: Scan;
  checkRobots: (url: URL) => Promise<RobotsDecision>;
  // Body of a guarded GET, or null when the answer is not a success.
  fetchText: (url: URL) => Promise<string | null>;
  maxIssues: number;
  // Pages per audit, home page included.
  maxPages: number;
  // From the first page's start; pages still waiting after it are abandoned.
  maxDurationMs: number;
  log: Logger;
}

export type ScanPageOutcome = "done" | "failed" | "skipped";

const RUNNABLE = ["queued", "running"] as const;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Scans one page of a multi-page audit, queues the pages it leads to, and
// finishes the audit when it was the last one. A page that cannot be scanned
// is marked failed and does not stop the others; only infrastructure errors
// (database down) are thrown, for the queue to retry.
export async function scanPage(
  deps: ScanPageDeps,
  job: { auditId: string; pageId: string },
): Promise<ScanPageOutcome> {
  const { db, log } = deps;
  const { auditId, pageId } = job;

  const [row] = await db
    .select({
      auditStatus: audits.status,
      pageStatus: auditPages.status,
      pageUrl: pages.url,
      siteId: audits.siteId,
      baseUrl: sites.baseUrl,
      plan: organizations.plan,
    })
    .from(auditPages)
    .innerJoin(audits, eq(audits.id, auditPages.auditId))
    .innerJoin(
      pages,
      and(eq(pages.id, auditPages.pageId), eq(pages.siteId, audits.siteId)),
    )
    .innerJoin(sites, eq(sites.id, audits.siteId))
    .leftJoin(organizations, eq(organizations.id, sites.orgId))
    .where(and(eq(auditPages.auditId, auditId), eq(auditPages.pageId, pageId)));
  if (
    row === undefined ||
    row.pageStatus !== "pending" ||
    !RUNNABLE.some((status) => status === row.auditStatus)
  ) {
    log.info(`audit ${auditId}: page ${pageId} not runnable, skipping`);
    return "skipped";
  }

  const [claimed] = await db
    .update(audits)
    .set({
      status: "running",
      startedAt: sql`coalesce(${audits.startedAt}, now())`,
    })
    .where(and(eq(audits.id, auditId), inArray(audits.status, [...RUNNABLE])))
    .returning({ startedAt: audits.startedAt });
  if (claimed === undefined) return "skipped";

  const failPage = async (reason: string): Promise<ScanPageOutcome> => {
    log.warn(`audit ${auditId}: ${row.pageUrl} not scanned, ${reason}`);
    await markFailed(db, auditId, [pageId]);
    await finishAudit(deps, auditId);
    return "failed";
  };

  if (
    claimed.startedAt !== null &&
    Date.now() - claimed.startedAt.getTime() > deps.maxDurationMs
  ) {
    return failPage("time budget spent");
  }

  const url = new URL(row.pageUrl);
  const origin = new URL(row.baseUrl).origin;

  const robots = await deps.checkRobots(url);
  if (!robots.allowed) return failPage(robots.reason);

  let scan;
  let normalized;
  try {
    scan = await deps.scan(url);
    normalized = normalizeViolations(scan.violations, {
      templateKey: null,
      maxIssues: deps.maxIssues,
      maxHtmlLength: MAX_HTML_EXCERPT_LENGTH,
    });
  } catch (error) {
    const message = `audit ${auditId}: ${row.pageUrl} scan failed, ${errorMessage(error)}`;
    if (error instanceof UrlNotAllowedError) log.warn(message);
    else log.error(message);
    await markFailed(db, auditId, [pageId]);
    await finishAudit(deps, auditId);
    return "failed";
  }
  if (normalized.skippedUnknownRules.length > 0) {
    log.warn(
      `audit ${auditId}: ignored rules missing from the rules table: ${normalized.skippedUnknownRules.join(", ")}`,
    );
  }

  // The sitemap is read once, from the home page: it lists the whole site.
  const candidates = [...scan.links];
  if (normalizeCrawlUrl(row.pageUrl, origin) === new URL("/", origin).href) {
    try {
      const xml = await deps.fetchText(new URL("/sitemap.xml", origin));
      if (xml !== null) candidates.push(...sitemapLocations(xml));
    } catch (error) {
      log.warn(`audit ${auditId}: sitemap not read, ${errorMessage(error)}`);
    }
  }
  const discovered = crawlableUrls(candidates, origin);

  const newPageIds = await db.transaction(async (tx) => {
    // Pages of one audit are discovered by concurrent jobs: the cap check and
    // the inserts must not interleave.
    await tx
      .select({ id: audits.id })
      .from(audits)
      .where(eq(audits.id, auditId))
      .for("update");

    // A redelivered job replaces what a previous attempt stored.
    await tx
      .delete(issues)
      .where(and(eq(issues.auditId, auditId), eq(issues.pageId, pageId)));
    for (let i = 0; i < normalized.issues.length; i += ISSUE_INSERT_CHUNK) {
      await tx.insert(issues).values(
        normalized.issues.slice(i, i + ISSUE_INSERT_CHUNK).map((issue) => ({
          ...issue,
          auditId,
          pageId,
        })),
      );
    }
    const now = new Date();
    await tx.update(pages).set({ lastSeenAt: now }).where(eq(pages.id, pageId));
    await tx
      .update(auditPages)
      .set({ status: "done" })
      .where(
        and(eq(auditPages.auditId, auditId), eq(auditPages.pageId, pageId)),
      );
    await tx
      .update(audits)
      .set({
        engineVersion: `axe-core@${scan.axeVersion}+rules@${RULES_VERSION}`,
      })
      .where(eq(audits.id, auditId));

    const known = await tx
      .select({ url: pages.url })
      .from(auditPages)
      .innerJoin(pages, eq(pages.id, auditPages.pageId))
      .where(eq(auditPages.auditId, auditId));
    const knownUrls = new Set(known.map((page) => page.url));
    // The plan's cap, never above what the deployment allows. A site without
    // an organization is not a customer's: it gets the free plan's.
    const maxPages = Math.min(
      deps.maxPages,
      planLimits(row.plan ?? "free").maxPagesPerAudit,
    );
    const room = Math.max(0, maxPages - known.length);
    const fresh = discovered
      .filter((href) => !knownUrls.has(href))
      .slice(0, room);
    if (fresh.length === 0) return [];

    const inserted = await tx
      .insert(pages)
      .values(
        fresh.map((href) => ({
          siteId: row.siteId,
          url: href,
          lastSeenAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [pages.siteId, pages.url],
        set: { lastSeenAt: now },
      })
      .returning({ id: pages.id });
    await tx
      .insert(auditPages)
      .values(inserted.map((page) => ({ auditId, pageId: page.id })));
    return inserted.map((page) => page.id);
  });

  // After the commit: a job must never run before its row exists.
  const unqueued: string[] = [];
  for (const nextPageId of newPageIds) {
    try {
      const jobId = await deps.queue.enqueue(SCAN_PAGE_JOB, {
        auditId,
        pageId: nextPageId,
      });
      if (jobId === null) throw new Error("the queue refused the job");
    } catch (error) {
      log.error(
        `audit ${auditId}: page ${nextPageId} not queued, ${errorMessage(error)}`,
      );
      unqueued.push(nextPageId);
    }
  }
  if (unqueued.length > 0) await markFailed(db, auditId, unqueued);

  log.info(
    `audit ${auditId}: ${row.pageUrl} done, ${normalized.issues.length} issues`,
  );
  await finishAudit(deps, auditId);
  return "done";
}

async function markFailed(
  db: Database,
  auditId: string,
  pageIds: string[],
): Promise<void> {
  await db
    .update(auditPages)
    .set({ status: "failed" })
    .where(
      and(
        eq(auditPages.auditId, auditId),
        inArray(auditPages.pageId, pageIds),
        eq(auditPages.status, "pending"),
      ),
    );
}

// Ends the audit once no page is waiting. Every page job calls this; the row
// lock makes the last two finishing together agree on a single winner.
async function finalizeAudit(
  db: Database,
  auditId: string,
  log: Logger,
): Promise<{ completedScheduled: boolean }> {
  return db.transaction(async (tx) => {
    const [audit] = await tx
      .select({
        status: audits.status,
        siteId: audits.siteId,
        type: audits.type,
      })
      .from(audits)
      .where(eq(audits.id, auditId))
      .for("update");
    if (audit?.status !== "running") return { completedScheduled: false };

    const counts = await tx
      .select({ status: auditPages.status, total: count() })
      .from(auditPages)
      .where(eq(auditPages.auditId, auditId))
      .groupBy(auditPages.status);
    const total = (status: string) =>
      counts.find((c) => c.status === status)?.total ?? 0;
    if (total("pending") > 0) return { completedScheduled: false };

    const done = total("done");
    if (done === 0) {
      await tx
        .update(audits)
        .set({
          status: "failed",
          failureReason: "scan_failed",
          finishedAt: new Date(),
        })
        .where(eq(audits.id, auditId));
      log.warn(`audit ${auditId}: failed, no page could be scanned`);
      return { completedScheduled: false };
    }

    const found = await tx
      .select({ impact: issues.impact })
      .from(issues)
      .where(eq(issues.auditId, auditId));
    await tx
      .update(audits)
      .set({
        status: "completed",
        finishedAt: new Date(),
        pagesScanned: done,
        score: computeScore(found),
      })
      .where(eq(audits.id, auditId));
    await syncFindings(tx, auditId, audit.siteId);
    await syncTasks(tx, audit.siteId);
    log.info(
      `audit ${auditId}: completed, ${done} pages, ${found.length} issues`,
    );
    return { completedScheduled: audit.type === "scheduled" };
  });
}

// Finalizes, then tells the customer about a completed re-scan. The alert is
// queued after the commit and its failure is only logged: a mail problem must
// never undo or block an audit that succeeded.
async function finishAudit(deps: ScanPageDeps, auditId: string): Promise<void> {
  const { completedScheduled } = await finalizeAudit(
    deps.db,
    auditId,
    deps.log,
  );
  if (!completedScheduled) return;
  try {
    const jobId = await deps.queue.enqueue(SEND_ALERT_JOB, { auditId });
    if (jobId === null) throw new Error("the queue refused the job");
  } catch (error) {
    deps.log.error(
      `audit ${auditId}: alert not queued, ${errorMessage(error)}`,
    );
  }
}
