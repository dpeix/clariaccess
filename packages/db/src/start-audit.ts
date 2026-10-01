import { and, count, eq, gte, inArray, lt, ne } from "drizzle-orm";
import type { Database } from "./client.js";
import { auditPages, audits, pages } from "./schema.js";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type AuditRow = typeof audits.$inferSelect;

export type StartSiteAudit =
  | { kind: "created"; audit: AuditRow; pageId: string }
  | { kind: "in_progress" }
  | { kind: "limit" };

export interface StartSiteAuditOptions {
  type: "manual" | "scheduled";
  // Manual audits per site over 24 hours. Scheduled ones are not counted nor
  // limited: the schedule itself is their limit.
  dailyLimit?: number;
}

// An audit still active after this long lost its jobs (worker crash, expired
// job): it is abandoned so the site is not blocked for good.
const STALE_AUDIT_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Creates the audit and its first page (the home page) to scan. The unique
// index on active audits decides between racing requests: the loser's insert
// conflicts and nothing is created. Accepts a transaction, so a caller can make
// the creation atomic with its own bookkeeping (the scheduler moves the next
// due date together with it).
export async function startSiteAudit(
  db: Database | Tx,
  site: { id: string; baseUrl: string },
  options: StartSiteAuditOptions,
): Promise<StartSiteAudit> {
  return db.transaction(async (tx) => {
    const now = Date.now();
    await tx
      .update(audits)
      .set({
        status: "failed",
        failureReason: "scan_failed",
        finishedAt: new Date(now),
      })
      .where(
        and(
          eq(audits.siteId, site.id),
          ne(audits.type, "free"),
          inArray(audits.status, ["queued", "running"]),
          lt(audits.createdAt, new Date(now - STALE_AUDIT_MS)),
        ),
      );

    if (options.type === "manual" && options.dailyLimit !== undefined) {
      const [recent] = await tx
        .select({ total: count() })
        .from(audits)
        .where(
          and(
            eq(audits.siteId, site.id),
            eq(audits.type, "manual"),
            gte(audits.createdAt, new Date(now - DAY_MS)),
          ),
        );
      if ((recent?.total ?? 0) >= options.dailyLimit) return { kind: "limit" };
    }

    const [audit] = await tx
      .insert(audits)
      .values({ siteId: site.id, type: options.type, status: "queued" })
      .onConflictDoNothing()
      .returning();
    if (audit === undefined) return { kind: "in_progress" };

    const homeUrl = new URL("/", site.baseUrl).href;
    const [page] = await tx
      .insert(pages)
      .values({ siteId: site.id, url: homeUrl })
      .onConflictDoUpdate({
        target: [pages.siteId, pages.url],
        set: { lastSeenAt: new Date(now) },
      })
      .returning({ id: pages.id });
    if (page === undefined) throw new Error("Page upsert returned no row");
    await tx.insert(auditPages).values({ auditId: audit.id, pageId: page.id });
    return { kind: "created", audit, pageId: page.id };
  });
}
