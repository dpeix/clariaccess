import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations, seedRules } from "./migrate.js";
import { findPublicStatement } from "./public-statement.js";
import { accessibilityStatements, organizations, sites } from "./schema.js";
import {
  adminDatabaseUrl,
  createTestDatabase,
  type TestDatabase,
} from "./test-helpers.js";

const adminUrl = adminDatabaseUrl();

describe.skipIf(adminUrl === undefined)("findPublicStatement", () => {
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
      .values({ name: "Acme" })
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
  const slug = (k: string) => `slug${String(n).padStart(3, "0")}${k}abcdefgh`;
  const insert = async (
    siteId: string,
    version: number,
    status: "draft" | "published" | "superseded",
    key: string,
  ) =>
    (
      await test.db
        .insert(accessibilityStatements)
        .values({
          siteId,
          version,
          status,
          computedStatus: "partiel",
          referentialVersion: "4.1",
          ...(status === "draft"
            ? {}
            : {
                declaredStatus: "partiel" as const,
                publishedAt: new Date(),
                publicSlug: slug(key),
                criteriaSnapshot: {},
              }),
        })
        .returning()
    )[0]!;

  it("finds a published statement by slug, with its site address", async () => {
    const site = await newSite();
    const row = await insert(site.id, 1, "published", "a");

    const found = await findPublicStatement(test.db, { slug: slug("a") });

    expect(found?.row.id).toBe(row.id);
    expect(found?.siteUrl).toBe(site.baseUrl);
    expect(found?.currentSlug).toBeNull();
  });

  it("finds a replaced one and tells which statement is in force", async () => {
    const site = await newSite();
    await insert(site.id, 1, "superseded", "a");
    await insert(site.id, 2, "published", "b");

    const found = await findPublicStatement(test.db, { slug: slug("a") });

    expect(found?.row.status).toBe("superseded");
    expect(found?.currentSlug).toBe(slug("b"));
  });

  it("never exposes a draft, by slug or by id", async () => {
    const site = await newSite();
    const draft = await insert(site.id, 1, "draft", "a");

    expect(await findPublicStatement(test.db, { slug: slug("a") })).toBeNull();
    expect(await findPublicStatement(test.db, { id: draft.id })).toBeNull();
  });

  it("finds by id (the worker's way) and returns nothing for unknown values", async () => {
    const site = await newSite();
    const row = await insert(site.id, 1, "published", "a");

    expect((await findPublicStatement(test.db, { id: row.id }))?.row.id).toBe(
      row.id,
    );
    expect(await findPublicStatement(test.db, { slug: "nope" })).toBeNull();
    expect(
      await findPublicStatement(test.db, {
        id: "00000000-0000-4000-8000-000000000000",
      }),
    ).toBeNull();
    expect(
      await findPublicStatement(test.db, { slug: "x'; drop table sites; --" }),
    ).toBeNull();
    expect(
      await test.db.select().from(sites).where(eq(sites.id, site.id)),
    ).toHaveLength(1);
  });
});
