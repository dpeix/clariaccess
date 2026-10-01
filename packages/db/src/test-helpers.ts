import pg from "pg";
import { randomBytes } from "node:crypto";
import { createDb, type Database } from "./client.js";

export interface TestDatabase {
  db: Database;
  // Connection string of the throwaway database (e.g. for pg-boss).
  url: string;
  close: () => Promise<void>;
}

// Returns undefined when no database is configured, except in CI where a
// missing DATABASE_URL must fail loudly instead of silently skipping tests.
export function adminDatabaseUrl(): string | undefined {
  const url = process.env["DATABASE_URL"];
  if (url === undefined && process.env["CI"] !== undefined) {
    throw new Error("DATABASE_URL is required to run db tests in CI");
  }
  return url;
}

// Every test file gets its own throwaway database so the dev database is
// never migrated, truncated or dropped by tests.
export async function createTestDatabase(
  adminUrl: string,
): Promise<TestDatabase> {
  const name = `test_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const db = createDb(url.toString());

  return {
    db,
    url: url.toString(),
    close: async () => {
      await db.$client.end();
      await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
      await admin.end();
    },
  };
}

// Drizzle wraps driver errors; the Postgres SQLSTATE is on the cause.
export function pgErrorCode(error: unknown): string | undefined {
  const source =
    error instanceof Error && error.cause !== undefined ? error.cause : error;
  return (source as { code?: string }).code;
}
