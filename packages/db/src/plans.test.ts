import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations, seedRules } from "./migrate.js";
import { audits, organizations, sites } from "./schema.js";
import {
  adminDatabaseUrl,
  createTestDatabase,
  pgErrorCode,
  type TestDatabase,
} from "./test-helpers.js";

const adminUrl = adminDatabaseUrl();

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (e: unknown) => e,
  );

describe.skipIf(adminUrl === undefined)("plans, schedules and alerts", () => {
  let test: TestDatabase;

  beforeAll(async () => {
    test = await createTestDatabase(adminUrl as string);
    await runMigrations(test.db);
    await seedRules(test.db);
  });
  afterAll(async () => {
    await test.close();
  });

  async function newSite(values: Partial<typeof sites.$inferInsert> = {}) {
    const [org] = await test.db
      .insert(organizations)
      .values({ name: "Acme" })
      .returning();
    const [site] = await test.db
      .insert(sites)
      .values({
        orgId: org!.id,
        baseUrl: "https://acme.example",
        verificationToken: "t",
        ...values,
      })
      .returning();
    return { org: org!, site: site! };
  }

  describe("organization plan", () => {
    it("starts free", async () => {
      const { org } = await newSite();

      expect(org.plan).toBe("free");
    });

    it("accepts the listed plans", async () => {
      const { org } = await newSite();

      await expect(
        test.db
          .update(organizations)
          .set({ plan: "pro" })
          .where(eq(organizations.id, org.id)),
      ).resolves.toBeDefined();
    });

    it("rejects a plan that is not in the grid", async () => {
      const { org } = await newSite();
      const error = await failure(
        test.db
          .update(organizations)
          .set({ plan: "enterprise" })
          .where(eq(organizations.id, org.id)),
      );

      expect(pgErrorCode(error)).toBe("23514");
    });
  });

  describe("site schedule", () => {
    it("has no re-scan by default", async () => {
      const { site } = await newSite();

      expect(site.scanFrequency).toBeNull();
      expect(site.nextScanAt).toBeNull();
    });

    it.each(["weekly", "daily"])("accepts %s", async (scanFrequency) => {
      await expect(newSite({ scanFrequency })).resolves.toBeDefined();
    });

    it("rejects an unknown frequency", async () => {
      const error = await failure(newSite({ scanFrequency: "hourly" }));

      expect(pgErrorCode(error)).toBe("23514");
    });
  });

  describe("alerts", () => {
    it("starts an audit with no alert sent", async () => {
      const { site } = await newSite();
      const [audit] = await test.db
        .insert(audits)
        .values({ siteId: site.id, type: "scheduled", status: "completed" })
        .returning();

      expect(audit?.alertSentAt).toBeNull();
    });
  });
});
