import { and, desc, eq, sql } from "drizzle-orm";
import type { Finding, FindingStatus } from "@accessibility/contracts";
import {
  findings,
  memberships,
  pages,
  sites,
  type Database,
} from "@accessibility/db";

const columns = {
  id: findings.id,
  siteId: findings.siteId,
  pageUrl: pages.url,
  ruleId: findings.ruleId,
  impact: findings.impact,
  status: findings.status,
  selector: findings.selector,
  htmlExcerpt: findings.htmlExcerpt,
  message: findings.message,
  firstSeenAuditId: findings.firstSeenAuditId,
  lastSeenAuditId: findings.lastSeenAuditId,
  priorityScore: findings.priorityScore,
  updatedAt: findings.updatedAt,
};

type Row = Omit<Finding, "updatedAt"> & { updatedAt: Date };

function toFinding(row: Row): Finding {
  return { ...row, updatedAt: row.updatedAt.toISOString() };
}

export async function listFindings(
  db: Database,
  siteId: string,
  options: { status?: FindingStatus; limit: number; offset: number },
): Promise<{ items: Finding[]; total: number }> {
  const where = and(
    eq(findings.siteId, siteId),
    options.status === undefined
      ? undefined
      : eq(findings.status, options.status),
  );
  const [items, [counted]] = await Promise.all([
    db
      .select(columns)
      .from(findings)
      .innerJoin(pages, eq(pages.id, findings.pageId))
      .where(where)
      .orderBy(
        desc(findings.priorityScore),
        desc(findings.updatedAt),
        findings.id,
      )
      .limit(options.limit)
      .offset(options.offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(findings)
      .where(where),
  ]);
  return { items: items.map(toFinding), total: counted?.total ?? 0 };
}

// Null when the finding does not exist or its site belongs to an organization
// the user is not in: callers answer 404 either way.
export async function findUserFinding(
  db: Database,
  userId: string,
  findingId: string,
): Promise<Finding | null> {
  const [row] = await db
    .select(columns)
    .from(findings)
    .innerJoin(pages, eq(pages.id, findings.pageId))
    .innerJoin(sites, eq(sites.id, findings.siteId))
    .innerJoin(
      memberships,
      and(eq(memberships.orgId, sites.orgId), eq(memberships.userId, userId)),
    )
    .where(eq(findings.id, findingId));
  return row === undefined ? null : toFinding(row);
}

// Only moves a finding that is still in the status the caller saw, so two
// concurrent changes (or an audit finishing in between) cannot be overwritten
// blindly. False when it moved in the meantime.
export async function changeFindingStatus(
  db: Database,
  findingId: string,
  from: FindingStatus,
  to: "open" | "ignored",
): Promise<boolean> {
  const updated = await db
    .update(findings)
    .set({ status: to, updatedAt: sql`now()` })
    .where(and(eq(findings.id, findingId), eq(findings.status, from)))
    .returning({ id: findings.id });
  return updated.length > 0;
}
