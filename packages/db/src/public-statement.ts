import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "./client.js";
import { accessibilityStatements, sites } from "./schema.js";

export interface PublicStatement {
  row: typeof accessibilityStatements.$inferSelect;
  siteUrl: string;
  // Public slug of the statement currently in force for the site (set when the
  // one asked for has been replaced).
  currentSlug: string | null;
}

// A published or replaced statement, by public slug (the API's way) or by id
// (the worker's). A draft is never public.
export async function findPublicStatement(
  db: Database,
  by: { slug: string } | { id: string },
): Promise<PublicStatement | null> {
  const [found] = await db
    .select({ row: accessibilityStatements, siteUrl: sites.baseUrl })
    .from(accessibilityStatements)
    .innerJoin(sites, eq(sites.id, accessibilityStatements.siteId))
    .where(
      and(
        "slug" in by
          ? eq(accessibilityStatements.publicSlug, by.slug)
          : eq(accessibilityStatements.id, by.id),
        inArray(accessibilityStatements.status, ["published", "superseded"]),
      ),
    );
  if (found === undefined) return null;

  let currentSlug: string | null = null;
  if (found.row.status === "superseded") {
    const [current] = await db
      .select({ slug: accessibilityStatements.publicSlug })
      .from(accessibilityStatements)
      .where(
        and(
          eq(accessibilityStatements.siteId, found.row.siteId),
          eq(accessibilityStatements.status, "published"),
        ),
      );
    currentSlug = current?.slug ?? null;
  }
  return { row: found.row, siteUrl: found.siteUrl, currentSlug };
}
