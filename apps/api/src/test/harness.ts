import { runMigrations, seedRules, type Database } from "@accessibility/db";
import {
  createTestDatabase,
  type TestDatabase,
} from "@accessibility/db/test-helpers";
import { buildApp, type AppConfig } from "../app.js";
import { FakeQueue } from "./fakes.js";

export const defaultTestConfig: AppConfig = {
  ipRateLimit: { max: 1000, windowSeconds: 3600 },
  domainDailyAuditLimit: 100,
  trustProxy: false,
};

export interface Harness {
  app: ReturnType<typeof buildApp>;
  db: Database;
  queue: FakeQueue;
  close: () => Promise<void>;
}

// A throwaway, migrated and seeded database with the real app on top of it.
export async function createHarness(
  adminUrl: string,
  config: Partial<AppConfig> = {},
): Promise<Harness & { test: TestDatabase }> {
  const test: TestDatabase = await createTestDatabase(adminUrl);
  await runMigrations(test.db);
  await seedRules(test.db);
  const queue = new FakeQueue();
  const app = buildApp({
    db: test.db,
    queue,
    config: { ...defaultTestConfig, ...config },
  });
  return {
    app,
    db: test.db,
    queue,
    test,
    close: async () => {
      await app.close();
      await test.close();
    },
  };
}
