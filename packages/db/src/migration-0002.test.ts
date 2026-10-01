import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "./migrate.js";
import {
  adminDatabaseUrl,
  createTestDatabase,
  type TestDatabase,
} from "./test-helpers.js";

const adminUrl = adminDatabaseUrl();
const drizzleDir = fileURLToPath(new URL("../drizzle", import.meta.url));

describe.skipIf(adminUrl === undefined)("migration 0002", () => {
  let test: TestDatabase;
  let oldFolder: string;

  beforeAll(async () => {
    test = await createTestDatabase(adminUrl as string);
    // The schema as it was before 0002: the first two migrations only.
    oldFolder = mkdtempSync(join(tmpdir(), "drizzle-before-0002-"));
    cpSync(drizzleDir, oldFolder, { recursive: true });
    const journalPath = join(oldFolder, "meta/_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: unknown[];
    };
    journal.entries = journal.entries.slice(0, 2);
    writeFileSync(journalPath, JSON.stringify(journal));
  });
  afterAll(async () => {
    rmSync(oldFolder, { recursive: true, force: true });
    await test.close();
  });

  it("marks the pages of audits stored before it as done", async () => {
    await migrate(test.db, { migrationsFolder: oldFolder });
    // Before 0002 a page was only stored once its scan had succeeded.
    await test.db.execute(sql`
      WITH s AS (INSERT INTO sites (base_url) VALUES ('https://old.example') RETURNING id),
           a AS (INSERT INTO audits (site_id, type, status) SELECT id, 'free', 'completed' FROM s RETURNING id, site_id),
           p AS (INSERT INTO pages (site_id, url) SELECT site_id, 'https://old.example/' FROM a RETURNING id)
      INSERT INTO audit_pages (audit_id, page_id) SELECT a.id, p.id FROM a, p`);

    await runMigrations(test.db);

    const result = await test.db.execute<{ status: string }>(
      sql`SELECT status FROM audit_pages`,
    );
    expect(result.rows.map((row) => row.status)).toEqual(["done"]);
  });
});
