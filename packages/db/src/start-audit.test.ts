import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations, seedRules } from "./migrate.js";
import { startSiteAudit } from "./start-audit.js";
import { auditPages, audits, organizations, pages, sites } from "./schema.js";
import {
  adminDatabaseUrl,
  createTestDatabase,
  type TestDatabase,
} from "./test-helpers.js";

const adminUrl = adminDatabaseUrl();

describe.skipIf(adminUrl === undefined)("startSiteAudit", () => {
  let test: TestDatabase;
  let n = 0;

  beforeAll(async () => {
    test = await createTestDatabase(adminUrl as string);
    await runMigrations(test.db);
    await seedRules(test.db);
  });
  afterAll(async () => {
    await test.close();
  });

  async function newSite() {
    n += 1;
    const [org] = await test.db
      .insert(organizations)
      .values({ name: `Org ${n}` })
      .returning();
    const [site] = await test.db
      .insert(sites)
      .values({
        orgId: org!.id,
        baseUrl: `https://site${n}.example`,
        verificationToken: "t",
        verifiedAt: new Date(),
      })
      .returning();
    return site!;
  }
  const rows = (siteId: string) =>
    test.db.select().from(audits).where(eq(audits.siteId, siteId));

  it("creates a queued audit of the requested type and its home page to scan", async () => {
    const site = await newSite();

    const started = await startSiteAudit(test.db, site, { type: "scheduled" });

    expect(started.kind).toBe("created");
    if (started.kind !== "created") return;
    expect(started.audit).toMatchObject({
      type: "scheduled",
      status: "queued",
      siteId: site.id,
    });
    const [link] = await test.db
      .select({ url: pages.url, status: auditPages.status })
      .from(auditPages)
      .innerJoin(pages, eq(pages.id, auditPages.pageId))
      .where(eq(auditPages.auditId, started.audit.id));
    expect(link).toEqual({ url: `${site.baseUrl}/`, status: "pending" });
    expect(started.pageId).toEqual(expect.any(String));
  });

  it("allows one active audit per site, whatever started the others", async () => {
    const site = await newSite();
    await startSiteAudit(test.db, site, { type: "manual", dailyLimit: 10 });

    const scheduled = await startSiteAudit(test.db, site, {
      type: "scheduled",
    });
    const manual = await startSiteAudit(test.db, site, {
      type: "manual",
      dailyLimit: 10,
    });

    expect(scheduled.kind).toBe("in_progress");
    expect(manual.kind).toBe("in_progress");
    expect(await rows(site.id)).toHaveLength(1);
  });

  it("counts only manual audits against the manual quota", async () => {
    const site = await newSite();
    for (let i = 0; i < 3; i += 1) {
      await test.db
        .insert(audits)
        .values({ siteId: site.id, type: "scheduled", status: "completed" });
    }

    const manual = await startSiteAudit(test.db, site, {
      type: "manual",
      dailyLimit: 1,
    });
    expect(manual.kind).toBe("created");
    await test.db
      .update(audits)
      .set({ status: "completed" })
      .where(eq(audits.siteId, site.id));

    const second = await startSiteAudit(test.db, site, {
      type: "manual",
      dailyLimit: 1,
    });
    expect(second.kind).toBe("limit");
  });

  it("applies no daily quota to a scheduled audit", async () => {
    const site = await newSite();
    for (let i = 0; i < 3; i += 1) {
      await test.db
        .insert(audits)
        .values({ siteId: site.id, type: "manual", status: "completed" });
    }

    const scheduled = await startSiteAudit(test.db, site, {
      type: "scheduled",
    });

    expect(scheduled.kind).toBe("created");
  });

  it("abandons an audit that has been active for too long first", async () => {
    const site = await newSite();
    await test.db.insert(audits).values({
      siteId: site.id,
      type: "manual",
      status: "running",
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });

    const started = await startSiteAudit(test.db, site, { type: "scheduled" });

    expect(started.kind).toBe("created");
    const all = await rows(site.id);
    expect(all.find((a) => a.type === "manual")).toMatchObject({
      status: "failed",
      failureReason: "scan_failed",
    });
  });

  it("works inside a larger transaction and rolls back with it", async () => {
    const site = await newSite();

    await test.db
      .transaction(async (tx) => {
        const started = await startSiteAudit(tx, site, { type: "scheduled" });
        expect(started.kind).toBe("created");
        throw new Error("abort");
      })
      .catch(() => undefined);

    expect(await rows(site.id)).toHaveLength(0);
  });
});
