import { and, eq, inArray } from "drizzle-orm";
import {
  auditPages,
  audits,
  issues,
  pages,
  sites,
  type Database,
} from "@accessibility/db";
import { RULES_VERSION } from "@accessibility/rules";
import type { RobotsDecision } from "../security/robots.js";
import { UrlNotAllowedError } from "../security/ssrf.js";
import { normalizeViolations, type NormalizeResult } from "./normalize.js";
import type { Scan, ScanResult } from "./scanner.js";

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface RunAuditDeps {
  db: Database;
  scan: Scan;
  checkRobots: (url: URL) => Promise<RobotsDecision>;
  maxIssues: number;
  log: Logger;
}

export type RunAuditOutcome = "completed" | "failed" | "skipped";

const MAX_HTML_EXCERPT_LENGTH = 1000;
// Keeps each INSERT well under Postgres' 65535 bind-parameter limit.
const ISSUE_INSERT_CHUNK = 500;
// A crashed worker leaves its audit 'running'; the retried job must take over.
const RUNNABLE = ["queued", "running"] as const;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Scans one audit's site. Expected failures (forbidden URL, robots.txt, page
// that cannot be scanned) end in a 'failed' audit and are not retried; the
// outcome of an infrastructure failure (database down) is left to the job
// queue, which retries the job.
export async function runAudit(
  deps: RunAuditDeps,
  auditId: string,
): Promise<RunAuditOutcome> {
  const { db, log } = deps;

  const [row] = await db
    .select({ status: audits.status, baseUrl: sites.baseUrl, siteId: sites.id })
    .from(audits)
    .innerJoin(sites, eq(sites.id, audits.siteId))
    .where(eq(audits.id, auditId));
  if (row === undefined) throw new Error(`Audit ${auditId} not found`);
  if (!RUNNABLE.some((status) => status === row.status)) {
    log.info(`audit ${auditId}: already ${row.status}, skipping`);
    return "skipped";
  }

  const claimed = await db
    .update(audits)
    .set({ status: "running", startedAt: new Date() })
    .where(and(eq(audits.id, auditId), inArray(audits.status, [...RUNNABLE])))
    .returning({ id: audits.id });
  if (claimed.length === 0) return "skipped";

  let scan: ScanResult;
  let normalized: NormalizeResult;
  try {
    const url = new URL(row.baseUrl);
    const robots = await deps.checkRobots(url);
    if (!robots.allowed) {
      log.warn(`audit ${auditId}: refused, ${robots.reason}`);
      return await fail(db, auditId);
    }
    scan = await deps.scan(url);
    normalized = normalizeViolations(scan.violations, {
      templateKey: null,
      maxIssues: deps.maxIssues,
      maxHtmlLength: MAX_HTML_EXCERPT_LENGTH,
    });
  } catch (error) {
    const message = `audit ${auditId}: scan failed, ${errorMessage(error)}`;
    if (error instanceof UrlNotAllowedError) log.warn(message);
    else log.error(message);
    return await fail(db, auditId);
  }

  if (normalized.skippedUnknownRules.length > 0) {
    log.warn(
      `audit ${auditId}: ignored rules missing from the rules table: ${normalized.skippedUnknownRules.join(", ")}`,
    );
  }
  if (normalized.truncated) {
    log.warn(`audit ${auditId}: issues truncated at ${deps.maxIssues}`);
  }

  await db.transaction(async (tx) => {
    const now = new Date();
    const [page] = await tx
      .insert(pages)
      .values({ siteId: row.siteId, url: row.baseUrl, lastSeenAt: now })
      .onConflictDoUpdate({
        target: [pages.siteId, pages.url],
        set: { lastSeenAt: now },
      })
      .returning({ id: pages.id });
    if (page === undefined) throw new Error("Page upsert returned no row");

    // A retried job replaces what a previous attempt may have stored.
    await tx.delete(issues).where(eq(issues.auditId, auditId));
    await tx.delete(auditPages).where(eq(auditPages.auditId, auditId));
    await tx.insert(auditPages).values({ auditId, pageId: page.id });

    for (let i = 0; i < normalized.issues.length; i += ISSUE_INSERT_CHUNK) {
      await tx.insert(issues).values(
        normalized.issues.slice(i, i + ISSUE_INSERT_CHUNK).map((issue) => ({
          ...issue,
          auditId,
          pageId: page.id,
        })),
      );
    }

    await tx
      .update(audits)
      .set({
        status: "completed",
        finishedAt: now,
        pagesScanned: 1,
        engineVersion: `axe-core@${scan.axeVersion}+rules@${RULES_VERSION}`,
      })
      .where(eq(audits.id, auditId));
  });

  log.info(`audit ${auditId}: completed, ${normalized.issues.length} issues`);
  return "completed";
}

async function fail(db: Database, auditId: string): Promise<"failed"> {
  await db
    .update(audits)
    .set({ status: "failed", finishedAt: new Date() })
    .where(eq(audits.id, auditId));
  return "failed";
}
