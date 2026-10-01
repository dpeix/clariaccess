import { and, count, desc, eq, gte, isNull, ne, sql } from "drizzle-orm";
import type { Audit, AuditPage } from "@accessibility/contracts";
import {
  auditPages,
  audits,
  issues,
  pages,
  rules,
  sites,
  startSiteAudit as startAudit,
  type Database,
} from "@accessibility/db";
import type { ReportIssueRow } from "../report/build-report.js";

type AuditRow = typeof audits.$inferSelect;

function toAudit(row: AuditRow, url: string): Audit {
  return {
    id: row.id,
    url,
    type: row.type,
    status: row.status,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    pagesScanned: row.pagesScanned,
    score: row.score,
    failureReason: row.failureReason,
  };
}

export async function findAudit(
  db: Database,
  id: string,
): Promise<Audit | null> {
  const [row] = await db
    .select({ audit: audits, url: sites.baseUrl })
    .from(audits)
    .innerJoin(sites, eq(sites.id, audits.siteId))
    .where(eq(audits.id, id));
  return row === undefined ? null : toAudit(row.audit, row.url);
}

// Issues come back in a stable order so the report does not change between
// two reads of the same audit.
export async function findReportIssues(
  db: Database,
  auditId: string,
): Promise<ReportIssueRow[]> {
  return db
    .select({
      ruleId: issues.ruleId,
      impact: issues.impact,
      selector: issues.selector,
      htmlExcerpt: issues.htmlExcerpt,
      raw: issues.raw,
      wcagCriteria: rules.wcagCriteria,
      rgaaCriteria: rules.rgaaCriteria,
    })
    .from(issues)
    .innerJoin(rules, eq(rules.id, issues.ruleId))
    .where(eq(issues.auditId, auditId))
    .orderBy(issues.ruleId, issues.selector, issues.id);
}

// Anonymous sites (no organization) are shared by URL, so a URL audited many
// times has one site. Two concurrent first audits may create two: harmless.
export async function createFreeAudit(
  db: Database,
  href: string,
): Promise<Audit> {
  const [existing] = await db
    .select({ id: sites.id })
    .from(sites)
    .where(and(isNull(sites.orgId), eq(sites.baseUrl, href)));
  const siteId =
    existing?.id ??
    (
      await db
        .insert(sites)
        .values({ baseUrl: href })
        .returning({ id: sites.id })
    )[0]?.id;
  if (siteId === undefined) throw new Error("Site insert returned no row");

  const [audit] = await db
    .insert(audits)
    .values({ siteId, type: "free", status: "queued" })
    .returning();
  if (audit === undefined) throw new Error("Audit insert returned no row");
  return toAudit(audit, href);
}

// Used when the job could not be queued: nothing will ever run this audit.
export async function deleteAudit(db: Database, id: string): Promise<void> {
  await db.delete(audits).where(eq(audits.id, id));
}

// Counts free audits of one host (port included) since a date, whoever asked.
export async function countFreeAuditsForHost(
  db: Database,
  host: string,
  since: Date,
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(audits)
    .innerJoin(sites, eq(sites.id, audits.siteId))
    .where(
      and(
        eq(audits.type, "free"),
        gte(audits.createdAt, since),
        sql`lower(substring(${sites.baseUrl} from '^https?://([^/?#]+)')) = ${host}`,
      ),
    );
  return row?.total ?? 0;
}

// Who may read an audit: free audits have no owner (the unguessable link is
// the capability); organization audits belong to their site's organization.
export async function findAuditAccess(
  db: Database,
  id: string,
): Promise<{ orgId: string | null } | null> {
  const [row] = await db
    .select({ orgId: sites.orgId })
    .from(audits)
    .innerJoin(sites, eq(sites.id, audits.siteId))
    .where(eq(audits.id, id));
  return row ?? null;
}

export async function listAuditPages(
  db: Database,
  auditId: string,
): Promise<AuditPage[]> {
  return db
    .select({ url: pages.url, status: auditPages.status })
    .from(auditPages)
    .innerJoin(pages, eq(pages.id, auditPages.pageId))
    .where(eq(auditPages.auditId, auditId))
    .orderBy(pages.url);
}

export async function listSiteAudits(
  db: Database,
  site: { id: string; baseUrl: string },
  limit = 50,
): Promise<Audit[]> {
  const rows = await db
    .select()
    .from(audits)
    .where(and(eq(audits.siteId, site.id), ne(audits.type, "free")))
    .orderBy(desc(audits.createdAt), audits.id)
    .limit(limit);
  return rows.map((row) => toAudit(row, site.baseUrl));
}

export type StartSiteAudit =
  | { kind: "created"; audit: Audit; pageId: string }
  | { kind: "in_progress" }
  | { kind: "limit" };

// A customer's manual audit: see startSiteAudit in @accessibility/db.
export async function startSiteAudit(
  db: Database,
  site: { id: string; baseUrl: string },
  dailyLimit: number,
): Promise<StartSiteAudit> {
  const started = await startAudit(db, site, { type: "manual", dailyLimit });
  return started.kind === "created"
    ? {
        kind: "created",
        audit: toAudit(started.audit, site.baseUrl),
        pageId: started.pageId,
      }
    : started;
}
