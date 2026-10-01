import { and, eq, ne } from "drizzle-orm";
import {
  findings,
  manualChecks,
  users,
  type Database,
} from "@accessibility/db";
import type { AutoFinding, ManualStatus } from "@accessibility/rules";

// A connection or a transaction: both can run these reads.
type Db = Pick<Database, "select">;

export interface ManualCheckRow {
  criterionId: string;
  status: ManualStatus;
  notes: string;
  evidenceUrl: string | null;
  checkedByEmail: string | null;
  checkedAt: Date;
}

export async function loadManualChecks(
  db: Db,
  siteId: string,
): Promise<ManualCheckRow[]> {
  return db
    .select({
      criterionId: manualChecks.criterionId,
      status: manualChecks.status,
      notes: manualChecks.notes,
      evidenceUrl: manualChecks.evidenceUrl,
      checkedByEmail: users.email,
      checkedAt: manualChecks.checkedAt,
    })
    .from(manualChecks)
    .leftJoin(users, eq(users.id, manualChecks.checkedBy))
    .where(eq(manualChecks.siteId, siteId));
}

// What the scan reports on a site, one entry per finding that is not fixed.
export async function loadAutoFindings(
  db: Db,
  siteId: string,
): Promise<AutoFinding[]> {
  return db
    .select({ ruleId: findings.ruleId, status: findings.status })
    .from(findings)
    .where(and(eq(findings.siteId, siteId), ne(findings.status, "fixed")));
}
