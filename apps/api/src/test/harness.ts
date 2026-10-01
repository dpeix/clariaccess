import { runMigrations, seedRules, type Database } from "@accessibility/db";
import {
  createTestDatabase,
  type TestDatabase,
} from "@accessibility/db/test-helpers";
import { buildApp, type AppConfig } from "../app.js";
import { FakeMailer, FakeQueue } from "./fakes.js";

export const defaultTestConfig: AppConfig = {
  ipRateLimit: { max: 1000, windowSeconds: 3600 },
  domainDailyAuditLimit: 100,
  trustProxy: false,
  corsOrigin: "https://www.example.fr",
  appOrigin: "https://app.example.fr",
  secureCookies: false,
  loginRateLimit: { max: 1000, windowSeconds: 3600 },
  loginEmailsPerAddressPerHour: 5,
  siteDailyAuditLimit: 100,
};

export interface Harness {
  app: ReturnType<typeof buildApp>;
  db: Database;
  queue: FakeQueue;
  mailer: FakeMailer;
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
  const mailer = new FakeMailer();
  const app = buildApp({
    db: test.db,
    queue,
    mailer,
    config: { ...defaultTestConfig, ...config },
  });
  return {
    app,
    db: test.db,
    queue,
    mailer,
    test,
    close: async () => {
      await app.close();
      await test.close();
    },
  };
}

// Signs in through the real endpoints (login link, then verify) and returns
// what a browser would send afterwards. The Origin header is the app's, as it
// is for every request the customer app makes.
export async function signIn(
  harness: Pick<Harness, "app" | "mailer">,
  email: string,
): Promise<{ cookie: string; headers: { cookie: string; origin: string } }> {
  const before = harness.mailer.sent.length;
  await harness.app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email },
  });
  const mail = harness.mailer.sent[before];
  const token = /token=([A-Za-z0-9_-]+)/.exec(mail?.text ?? "")?.[1];
  if (token === undefined) throw new Error("no login link was sent");
  const response = await harness.app.inject({
    method: "POST",
    url: "/auth/verify",
    payload: { token },
  });
  const session = response.cookies.find((c) => c.name === "session");
  if (session === undefined) throw new Error("no session cookie was set");
  const cookie = `session=${session.value}`;
  return {
    cookie,
    headers: { cookie, origin: defaultTestConfig.appOrigin },
  };
}
