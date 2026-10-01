import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations, seedRules } from "./migrate.js";
import {
  accessibilityStatements,
  audits,
  manualChecks,
  organizations,
  sites,
  users,
} from "./schema.js";
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

describe.skipIf(adminUrl === undefined)("manual checks and statements", () => {
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
      })
      .returning();
    return site!;
  }
  async function newUser() {
    n += 1;
    return (
      await test.db
        .insert(users)
        .values({ email: `u${n}@example.fr` })
        .returning()
    )[0]!;
  }

  describe("manual_checks", () => {
    it("stores one check per site and criterion, with no evidence by default", async () => {
      const site = await newSite();
      const [row] = await test.db
        .insert(manualChecks)
        .values({ siteId: site.id, criterionId: "1.1", status: "ok" })
        .returning();

      expect(row).toMatchObject({
        notes: "",
        evidenceUrl: null,
        checkedBy: null,
      });
      expect(row?.checkedAt).toBeInstanceOf(Date);
      expect(
        pgErrorCode(
          await failure(
            test.db
              .insert(manualChecks)
              .values({ siteId: site.id, criterionId: "1.1", status: "ko" }),
          ),
        ),
      ).toBe("23505");
    });

    it("allows the same criterion on another site", async () => {
      const a = await newSite();
      const b = await newSite();
      await test.db
        .insert(manualChecks)
        .values({ siteId: a.id, criterionId: "1.1", status: "ok" });

      await expect(
        test.db
          .insert(manualChecks)
          .values({ siteId: b.id, criterionId: "1.1", status: "ok" }),
      ).resolves.toBeDefined();
    });

    it("rejects an unknown status and a malformed criterion id", async () => {
      const site = await newSite();

      const status = await failure(
        test.db
          .insert(manualChecks)
          // @ts-expect-error deliberately outside the enum
          .values({ siteId: site.id, criterionId: "1.1", status: "maybe" }),
      );
      expect(pgErrorCode(status)).toBe("22P02");
      for (const criterionId of [
        "",
        "1",
        "a.b",
        "1.1.1",
        "1.1; drop table x",
      ]) {
        const bad = await failure(
          test.db
            .insert(manualChecks)
            .values({ siteId: site.id, criterionId, status: "ok" }),
        );
        expect(pgErrorCode(bad), criterionId).toBe("23514");
      }
    });

    it("bounds the notes", async () => {
      const site = await newSite();

      const error = await failure(
        test.db.insert(manualChecks).values({
          siteId: site.id,
          criterionId: "1.1",
          status: "ko",
          notes: "x".repeat(5001),
        }),
      );

      expect(pgErrorCode(error)).toBe("23514");
    });

    it("keeps the check when its author is deleted, and goes with its site", async () => {
      const site = await newSite();
      const user = await newUser();
      await test.db.insert(manualChecks).values({
        siteId: site.id,
        criterionId: "2.1",
        status: "ok",
        checkedBy: user.id,
      });

      await test.db.delete(users).where(eq(users.id, user.id));
      const [kept] = await test.db
        .select()
        .from(manualChecks)
        .where(eq(manualChecks.siteId, site.id));
      expect(kept?.checkedBy).toBeNull();

      await test.db.delete(sites).where(eq(sites.id, site.id));
      expect(
        await test.db
          .select()
          .from(manualChecks)
          .where(eq(manualChecks.siteId, site.id)),
      ).toHaveLength(0);
    });
  });

  describe("accessibility_statements", () => {
    const base = (
      siteId: string,
      patch: Partial<typeof accessibilityStatements.$inferInsert> = {},
    ) => ({
      siteId,
      version: 1,
      computedStatus: "partiel" as const,
      referentialVersion: "4.1",
      ...patch,
    });
    const published = (suffix: string) => ({
      status: "published" as const,
      declaredStatus: "partiel" as const,
      publishedAt: new Date(),
      publicSlug: `slugslugslug${suffix}`,
      criteriaSnapshot: [],
    });

    it("starts as a draft, French, with nothing declared or published", async () => {
      const site = await newSite();

      const [row] = await test.db
        .insert(accessibilityStatements)
        .values(base(site.id))
        .returning();

      expect(row).toMatchObject({
        status: "draft",
        locale: "fr",
        declaredStatus: null,
        publicSlug: null,
        publishedAt: null,
        pdf: null,
      });
    });

    it("allows one draft per site", async () => {
      const site = await newSite();
      await test.db.insert(accessibilityStatements).values(base(site.id));

      const error = await failure(
        test.db
          .insert(accessibilityStatements)
          .values(base(site.id, { version: 2 })),
      );

      expect(pgErrorCode(error)).toBe("23505");
    });

    it("numbers versions once per site", async () => {
      const site = await newSite();
      await test.db
        .insert(accessibilityStatements)
        .values(base(site.id, { ...published("aaa"), status: "superseded" }));

      const error = await failure(
        test.db.insert(accessibilityStatements).values(base(site.id)),
      );

      expect(pgErrorCode(error)).toBe("23505");
    });

    it("allows a single published statement per site, however many are superseded", async () => {
      const site = await newSite();
      await test.db
        .insert(accessibilityStatements)
        .values(base(site.id, { ...published("one"), status: "superseded" }));
      await test.db.insert(accessibilityStatements).values(
        base(site.id, {
          ...published("two"),
          version: 2,
          status: "superseded",
        }),
      );
      await test.db
        .insert(accessibilityStatements)
        .values(base(site.id, { ...published("three"), version: 3 }));

      const error = await failure(
        test.db
          .insert(accessibilityStatements)
          .values(base(site.id, { ...published("four"), version: 4 })),
      );

      expect(pgErrorCode(error)).toBe("23505");
    });

    it("requires everything a public statement needs", async () => {
      const site = await newSite();
      for (const patch of [
        { publicSlug: null },
        { publishedAt: null },
        { declaredStatus: null },
        { criteriaSnapshot: null },
      ]) {
        const error = await failure(
          test.db
            .insert(accessibilityStatements)
            .values(base(site.id, { ...published("x"), ...patch })),
        );
        expect(pgErrorCode(error), JSON.stringify(patch)).toBe("23514");
      }
    });

    it("keeps public slugs unique and of a safe shape", async () => {
      const a = await newSite();
      const b = await newSite();
      await test.db
        .insert(accessibilityStatements)
        .values(base(a.id, published("dup")));

      const dup = await failure(
        test.db
          .insert(accessibilityStatements)
          .values(base(b.id, published("dup"))),
      );
      expect(pgErrorCode(dup)).toBe("23505");
      for (const publicSlug of [
        "short",
        "UPPERCASEUPPERCASE",
        "with/slash/slash!",
        "../../etc/passwd",
      ]) {
        const bad = await failure(
          test.db
            .insert(accessibilityStatements)
            .values(base(b.id, { ...published("y"), publicSlug })),
        );
        expect(pgErrorCode(bad), publicSlug).toBe("23514");
      }
    });

    it("rejects a rate outside 0-100, an unknown status and a language we do not offer", async () => {
      const site = await newSite();

      expect(
        pgErrorCode(
          await failure(
            test.db
              .insert(accessibilityStatements)
              .values(base(site.id, { complianceRate: 101 })),
          ),
        ),
      ).toBe("23514");
      expect(
        pgErrorCode(
          await failure(
            test.db
              .insert(accessibilityStatements)
              // @ts-expect-error deliberately outside the enum
              .values(base(site.id, { computedStatus: "great" })),
          ),
        ),
      ).toBe("22P02");
      expect(
        pgErrorCode(
          await failure(
            test.db
              .insert(accessibilityStatements)
              .values(base(site.id, { locale: "xx" })),
          ),
        ),
      ).toBe("23514");
    });

    it("cannot declare an undetermined level", async () => {
      const site = await newSite();

      const error = await failure(
        test.db.insert(accessibilityStatements).values(
          base(site.id, {
            ...published("ind"),
            // "indetermine" is a computed level, never a declared one.
            declaredStatus: "indetermine" as never,
          }),
        ),
      );

      expect(pgErrorCode(error)).toBe("22P02");
    });

    it("stores a PDF as bytes and the reference audit as optional", async () => {
      const site = await newSite();
      const [audit] = await test.db
        .insert(audits)
        .values({ siteId: site.id, type: "manual", status: "completed" })
        .returning();
      const pdf = Buffer.from("%PDF-1.7\n%test");
      const [row] = await test.db
        .insert(accessibilityStatements)
        .values(
          base(site.id, {
            auditId: audit!.id,
            pdf,
            pdfGeneratedAt: new Date(),
          }),
        )
        .returning();

      expect(Buffer.isBuffer(row?.pdf)).toBe(true);
      expect(row?.pdf?.toString()).toBe("%PDF-1.7\n%test");

      await test.db.delete(audits).where(eq(audits.id, audit!.id));
      const [after] = await test.db
        .select()
        .from(accessibilityStatements)
        .where(eq(accessibilityStatements.id, row!.id));
      expect(after?.auditId).toBeNull();
    });

    it("keeps its history when the publisher leaves, and goes with its site", async () => {
      const site = await newSite();
      const user = await newUser();
      const [row] = await test.db
        .insert(accessibilityStatements)
        .values(base(site.id, { ...published("gone"), publishedBy: user.id }))
        .returning();

      await test.db.delete(users).where(eq(users.id, user.id));
      const [kept] = await test.db
        .select()
        .from(accessibilityStatements)
        .where(eq(accessibilityStatements.id, row!.id));
      expect(kept?.publishedBy).toBeNull();

      await test.db.delete(sites).where(eq(sites.id, site.id));
      expect(
        await test.db
          .select()
          .from(accessibilityStatements)
          .where(eq(accessibilityStatements.id, row!.id)),
      ).toHaveLength(0);
    });
  });
});
