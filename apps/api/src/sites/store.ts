import { and, count, desc, eq, isNotNull, sql } from "drizzle-orm";
import {
  planLimits,
  verificationInstructions,
  type ScanFrequency,
  type Site,
} from "@accessibility/contracts";
import {
  memberships,
  organizations,
  sites,
  type Database,
} from "@accessibility/db";

type SiteRow = typeof sites.$inferSelect;

export function toSite(row: SiteRow): Site {
  // Sites of an organization always get a token when they are created.
  if (row.orgId === null || row.verificationToken === null) {
    throw new Error(`Site ${row.id} is not an organization site`);
  }
  return {
    id: row.id,
    orgId: row.orgId,
    baseUrl: row.baseUrl,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    verificationMethod:
      row.verificationMethod === "dns" || row.verificationMethod === "file"
        ? row.verificationMethod
        : null,
    scanFrequency:
      row.scanFrequency === "weekly" || row.scanFrequency === "daily"
        ? row.scanFrequency
        : null,
    nextScanAt: row.nextScanAt?.toISOString() ?? null,
    verification: verificationInstructions(row.baseUrl, row.verificationToken),
  };
}

// Null when the site does not exist or the user is not a member of its
// organization: callers answer 404 either way, so ids reveal nothing.
export async function findUserSite(
  db: Database,
  userId: string,
  siteId: string,
): Promise<SiteRow | null> {
  const [row] = await db
    .select({ site: sites })
    .from(sites)
    .innerJoin(
      memberships,
      and(eq(memberships.orgId, sites.orgId), eq(memberships.userId, userId)),
    )
    .where(eq(sites.id, siteId));
  return row?.site ?? null;
}

export async function listSites(
  db: Database,
  orgId: string,
): Promise<SiteRow[]> {
  return db
    .select()
    .from(sites)
    .where(and(eq(sites.orgId, orgId), isNotNull(sites.verificationToken)))
    .orderBy(desc(sites.createdAt), sites.id);
}

export type CreateSiteResult =
  | { kind: "created"; site: SiteRow }
  | { kind: "duplicate" }
  | { kind: "plan_limit" };

// The organization row is locked while the count and the insert happen, so
// concurrent requests cannot together exceed the plan.
export async function createSite(
  db: Database,
  orgId: string,
  baseUrl: string,
  verificationToken: string,
): Promise<CreateSiteResult> {
  return db.transaction(async (tx) => {
    const [org] = await tx
      .select({ plan: organizations.plan })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .for("update");
    if (org === undefined) return { kind: "duplicate" };

    const [existing] = await tx
      .select({ id: sites.id })
      .from(sites)
      .where(and(eq(sites.orgId, orgId), eq(sites.baseUrl, baseUrl)));
    if (existing !== undefined) return { kind: "duplicate" };

    const [owned] = await tx
      .select({ total: count() })
      .from(sites)
      .where(eq(sites.orgId, orgId));
    if ((owned?.total ?? 0) >= planLimits(org.plan).maxSites) {
      return { kind: "plan_limit" };
    }

    const [row] = await tx
      .insert(sites)
      .values({ orgId, baseUrl, verificationToken })
      .returning();
    if (row === undefined) throw new Error("Site insert returned no row");
    return { kind: "created", site: row };
  });
}

// Sets (or clears) the re-scan schedule. Setting the frequency already in
// place keeps the due date: it is not a way to push the next scan away.
export async function setSchedule(
  db: Database,
  site: SiteRow,
  frequency: ScanFrequency | null,
  intervalMs: number,
): Promise<SiteRow> {
  const unchanged =
    frequency === site.scanFrequency && site.nextScanAt !== null;
  const [row] = await db
    .update(sites)
    .set(
      frequency === null
        ? { scanFrequency: null, nextScanAt: null }
        : {
            scanFrequency: frequency,
            nextScanAt: unchanged
              ? site.nextScanAt
              : sql`now() + ${intervalMs} * interval '1 millisecond'`,
          },
    )
    .where(eq(sites.id, site.id))
    .returning();
  if (row === undefined) throw new Error("Site update returned no row");
  return row;
}
