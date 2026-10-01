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
import { runMigrations, seedRules } from "./migrate.js";
import {
  adminDatabaseUrl,
  createTestDatabase,
  type TestDatabase,
} from "./test-helpers.js";

const adminUrl = adminDatabaseUrl();
const drizzleDir = fileURLToPath(new URL("../drizzle", import.meta.url));

describe.skipIf(adminUrl === undefined)("migration 0006", () => {
  let test: TestDatabase;
  let oldFolder: string;

  beforeAll(async () => {
    test = await createTestDatabase(adminUrl as string);
    // The schema as it was before 0006: the first six migrations.
    oldFolder = mkdtempSync(join(tmpdir(), "drizzle-before-0006-"));
    cpSync(drizzleDir, oldFolder, { recursive: true });
    const journalPath = join(oldFolder, "meta/_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: unknown[];
    };
    journal.entries = journal.entries.slice(0, 6);
    writeFileSync(journalPath, JSON.stringify(journal));
  });
  afterAll(async () => {
    rmSync(oldFolder, { recursive: true, force: true });
    await test.close();
  });

  it("creates a task per rule for the findings already followed, summing their priority", async () => {
    await migrate(test.db, { migrationsFolder: oldFolder });
    await seedRules(test.db);
    await test.db.execute(sql`
      WITH o AS (INSERT INTO organizations (name) VALUES ('Old') RETURNING id),
           s AS (INSERT INTO sites (org_id, base_url, verification_token) SELECT id, 'https://old.example', 't' FROM o RETURNING id),
           p1 AS (INSERT INTO pages (site_id, url) SELECT id, 'https://old.example/' FROM s RETURNING id, site_id),
           p2 AS (INSERT INTO pages (site_id, url) SELECT id, 'https://old.example/b' FROM s RETURNING id, site_id)
      INSERT INTO findings (site_id, page_id, rule_id, fingerprint, impact, status, selector, html_excerpt, message, priority_score)
      SELECT p1.site_id, p1.id, 'image-alt', 'f1', 'serious'::impact, 'open'::finding_status, 'img', '<img>', 'm', 6 FROM p1
      UNION ALL SELECT p2.site_id, p2.id, 'image-alt', 'f1', 'serious'::impact, 'regressed'::finding_status, 'img', '<img>', 'm', 4 FROM p2
      UNION ALL SELECT p1.site_id, p1.id, 'image-alt', 'f2', 'serious'::impact, 'fixed'::finding_status, 'img.b', '<img>', 'm', 100 FROM p1
      UNION ALL SELECT p1.site_id, p1.id, 'button-name', 'f3', 'serious'::impact, 'ignored'::finding_status, 'button', '<b>', 'm', 50 FROM p1
      UNION ALL SELECT p1.site_id, p1.id, 'label', 'f4', 'critical'::impact, 'open'::finding_status, 'input', '<i>', 'm', 10 FROM p1`);

    await runMigrations(test.db);

    const result = await test.db.execute<{
      rule_id: string;
      status: string;
      priority_score: number;
    }>(
      sql`SELECT rule_id, status, priority_score FROM remediation_tasks ORDER BY rule_id`,
    );
    expect(result.rows).toEqual([
      { rule_id: "image-alt", status: "todo", priority_score: 10 },
      { rule_id: "label", status: "todo", priority_score: 10 },
    ]);
  });
});
