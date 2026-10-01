import { and, desc, eq, sql } from "drizzle-orm";
import type { Task, TaskStatus } from "@accessibility/contracts";
import {
  memberships,
  remediationTasks,
  rules,
  sites,
  users,
  type Database,
} from "@accessibility/db";
import { remediationGuide } from "@accessibility/rules";

const columns = {
  id: remediationTasks.id,
  siteId: remediationTasks.siteId,
  ruleId: remediationTasks.ruleId,
  status: remediationTasks.status,
  priorityScore: remediationTasks.priorityScore,
  updatedAt: remediationTasks.updatedAt,
  assigneeId: users.id,
  assigneeEmail: users.email,
  wcagCriteria: rules.wcagCriteria,
  rgaaCriteria: rules.rgaaCriteria,
  // Counted live from the findings: they are what the task is about.
  openFindings: sql<number>`(select count(*)::int from findings f where f.site_id = ${remediationTasks.siteId} and f.rule_id = ${remediationTasks.ruleId} and f.status in ('open', 'regressed'))`,
  pagesAffected: sql<number>`(select count(distinct f.page_id)::int from findings f where f.site_id = ${remediationTasks.siteId} and f.rule_id = ${remediationTasks.ruleId} and f.status in ('open', 'regressed'))`,
};

type Row = {
  id: string;
  siteId: string;
  ruleId: string;
  status: TaskStatus;
  priorityScore: number;
  updatedAt: Date;
  assigneeId: string | null;
  assigneeEmail: string | null;
  wcagCriteria: string[];
  rgaaCriteria: string[];
  openFindings: number;
  pagesAffected: number;
};

function toTask(row: Row): Task {
  return {
    id: row.id,
    siteId: row.siteId,
    ruleId: row.ruleId,
    status: row.status,
    priorityScore: row.priorityScore,
    openFindings: row.openFindings,
    pagesAffected: row.pagesAffected,
    assignee:
      row.assigneeId !== null && row.assigneeEmail !== null
        ? { id: row.assigneeId, email: row.assigneeEmail }
        : null,
    guide: remediationGuide(row.ruleId),
    wcagCriteria: row.wcagCriteria,
    rgaaCriteria: row.rgaaCriteria,
    updatedAt: row.updatedAt.toISOString(),
  };
}

const base = (db: Database) =>
  db
    .select(columns)
    .from(remediationTasks)
    .innerJoin(rules, eq(rules.id, remediationTasks.ruleId))
    .leftJoin(users, eq(users.id, remediationTasks.assigneeUserId));

// Work still to do first, by priority; finished tasks at the end.
export async function listTasks(
  db: Database,
  siteId: string,
  options: { status?: TaskStatus; limit: number; offset: number },
): Promise<{ items: Task[]; total: number }> {
  const where = and(
    eq(remediationTasks.siteId, siteId),
    options.status === undefined
      ? undefined
      : eq(remediationTasks.status, options.status),
  );
  const [rows, [counted]] = await Promise.all([
    base(db)
      .where(where)
      .orderBy(
        sql`(${remediationTasks.status} = 'done')`,
        desc(remediationTasks.priorityScore),
        desc(remediationTasks.updatedAt),
        remediationTasks.id,
      )
      .limit(options.limit)
      .offset(options.offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(remediationTasks)
      .where(where),
  ]);
  return { items: rows.map(toTask), total: counted?.total ?? 0 };
}

// Null when the task does not exist or its site belongs to an organization the
// user is not in: callers answer 404 either way.
export async function findUserTask(
  db: Database,
  userId: string,
  taskId: string,
): Promise<{ task: Task; orgId: string } | null> {
  const [row] = await db
    .select({ ...columns, orgId: sites.orgId })
    .from(remediationTasks)
    .innerJoin(rules, eq(rules.id, remediationTasks.ruleId))
    .innerJoin(sites, eq(sites.id, remediationTasks.siteId))
    .innerJoin(
      memberships,
      and(eq(memberships.orgId, sites.orgId), eq(memberships.userId, userId)),
    )
    .leftJoin(users, eq(users.id, remediationTasks.assigneeUserId))
    .where(eq(remediationTasks.id, taskId));
  return row === undefined || row.orgId === null
    ? null
    : { task: toTask(row), orgId: row.orgId };
}

export async function updateTask(
  db: Database,
  taskId: string,
  changes: { status?: TaskStatus; assigneeUserId?: string | null },
): Promise<void> {
  await db
    .update(remediationTasks)
    .set({
      ...(changes.status !== undefined ? { status: changes.status } : {}),
      ...(changes.assigneeUserId !== undefined
        ? { assigneeUserId: changes.assigneeUserId }
        : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(remediationTasks.id, taskId));
}

export async function listMembers(
  db: Database,
  orgId: string,
): Promise<{ id: string; email: string }[]> {
  return db
    .select({ id: users.id, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, orgId))
    .orderBy(users.email);
}
