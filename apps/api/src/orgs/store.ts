import { and, eq } from "drizzle-orm";
import {
  normalizePlan,
  planLimits,
  type Organization,
} from "@accessibility/contracts";
import { memberships, organizations, type Database } from "@accessibility/db";

type OrgRow = {
  id: string;
  name: string;
  plan: string;
  role: Organization["role"];
};

// The stored plan is text: a value outside the grid reads as the free plan.
function toOrganization(row: OrgRow): Organization {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    plan: normalizePlan(row.plan),
    limits: planLimits(row.plan),
  };
}

export async function listOrganizations(
  db: Database,
  userId: string,
): Promise<Organization[]> {
  const rows = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      plan: organizations.plan,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(eq(memberships.userId, userId))
    .orderBy(organizations.name, organizations.id);
  return rows.map(toOrganization);
}

export async function findOrganizationPlan(
  db: Database,
  orgId: string,
): Promise<string> {
  const [row] = await db
    .select({ plan: organizations.plan })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  return row?.plan ?? "free";
}

export async function createOrganization(
  db: Database,
  userId: string,
  name: string,
): Promise<Organization> {
  return db.transaction(async (tx) => {
    const [org] = await tx.insert(organizations).values({ name }).returning({
      id: organizations.id,
      name: organizations.name,
      plan: organizations.plan,
    });
    if (org === undefined)
      throw new Error("Organization insert returned no row");
    await tx
      .insert(memberships)
      .values({ userId, orgId: org.id, role: "owner" });
    return toOrganization({ ...org, role: "owner" });
  });
}

export async function isMember(
  db: Database,
  userId: string,
  orgId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)));
  return row !== undefined;
}
