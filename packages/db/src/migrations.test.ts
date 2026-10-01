import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { KNOWN_UNMAPPED, MAPPED_AXE_RULE_IDS } from "@accessibility/rules";
import { runMigrations, seedRules } from "./migrate.js";
import { rules } from "./schema.js";
import {
  adminDatabaseUrl,
  createTestDatabase,
  type TestDatabase,
} from "./test-helpers.js";

const adminUrl = adminDatabaseUrl();

describe.skipIf(adminUrl === undefined)("migrations", () => {
  let test: TestDatabase;

  beforeAll(async () => {
    test = await createTestDatabase(adminUrl as string);
  });
  afterAll(async () => {
    await test.close();
  });

  it("creates the step 1 tables on an empty database", async () => {
    await runMigrations(test.db);

    const result = await test.db.execute<{ table_name: string }>(
      sql`SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' ORDER BY table_name`,
    );
    const names = result.rows.map((row) => row.table_name);

    expect(names).toEqual(
      expect.arrayContaining([
        "audit_pages",
        "audits",
        "issues",
        "leads",
        "organizations",
        "pages",
        "rules",
        "sites",
      ]),
    );
  });

  it("can be applied again without error or change", async () => {
    await runMigrations(test.db);
    await expect(runMigrations(test.db)).resolves.toBeUndefined();
  });

  it("seeds one rule per axe rule known to @accessibility/rules, idempotently", async () => {
    await seedRules(test.db);
    await seedRules(test.db);

    const rows = await test.db.select().from(rules);
    expect(rows).toHaveLength(
      MAPPED_AXE_RULE_IDS.length + KNOWN_UNMAPPED.length,
    );

    const imageAlt = rows.find((row) => row.id === "image-alt");
    expect(imageAlt).toMatchObject({
      source: "axe",
      wcagCriteria: ["1.1.1"],
      en301549Clauses: ["9.1.1.1"],
      rgaaCriteria: ["1.1"],
      level: "A",
    });

    // Best-practice rules stay referenceable by issues, without criteria.
    const region = rows.find((row) => row.id === "region");
    expect(region).toMatchObject({ wcagCriteria: [], level: null });
  });
});
