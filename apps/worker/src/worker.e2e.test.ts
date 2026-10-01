import { eq } from "drizzle-orm";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  audits,
  issues,
  runMigrations,
  seedRules,
  sites,
} from "@accessibility/db";
import {
  createTestDatabase,
  type TestDatabase,
} from "@accessibility/db/test-helpers";
import { registerAuditWorker } from "./audit/audit-worker.js";
import { runAudit } from "./audit/run-audit.js";
import { createScanner } from "./audit/scanner.js";
import { RUN_AUDIT_JOB } from "./queue/job-queue.js";
import { PgBossQueue } from "./queue/pg-boss-queue.js";
import { checkRobots } from "./security/robots.js";
import { UrlNotAllowedError } from "./security/ssrf.js";
import { adminDatabaseUrl, chromiumAvailable } from "./test/integration.js";
import {
  startFixtureServer,
  type FixtureServer,
} from "./test/fixture-server.js";

const adminUrl = adminDatabaseUrl();

// Loopback is forbidden in production; the fixture server needs it.
const allowLoopback = async (url: string) => {
  if (new URL(url).hostname !== "127.0.0.1") throw new UrlNotAllowedError(url);
};

describe.skipIf(adminUrl === undefined || !chromiumAvailable())(
  "audit pipeline (queue → worker → Chromium → database)",
  () => {
    let test: TestDatabase;
    let browser: Browser;
    let server: FixtureServer;
    let queue: PgBossQueue;

    beforeAll(async () => {
      test = await createTestDatabase(adminUrl as string);
      await runMigrations(test.db);
      await seedRules(test.db);
      browser = await chromium.launch();
      server = await startFixtureServer(async (req, res) => {
        if (req.url === "/robots.txt") {
          res.writeHead(200, { "content-type": "text/plain" });
          res.end("User-agent: *\nDisallow: /blocked.html\n");
          return true;
        }
        return false;
      });
      queue = new PgBossQueue(test.url);
      await queue.start();
      const scan = createScanner(browser, {
        userAgent: "ClariAccessBot/1.0",
        timeoutMs: 20_000,
        guard: allowLoopback,
      });
      await registerAuditWorker(queue, (auditId) =>
        runAudit(
          {
            db: test.db,
            scan,
            checkRobots: (url) =>
              checkRobots(url, {
                userAgent: "ClariAccessBot/1.0",
                fetch,
                guard: allowLoopback,
              }),
            maxIssues: 2000,
            log: {
              info: () => undefined,
              warn: () => undefined,
              error: () => undefined,
            },
          },
          auditId,
        ),
      );
    });
    afterAll(async () => {
      await queue.stop();
      await browser.close();
      await server.close();
      await test.close();
    });

    async function enqueueAudit(path: string) {
      const [site] = await test.db
        .insert(sites)
        .values({ baseUrl: `${server.origin}${path}` })
        .returning();
      const [audit] = await test.db
        .insert(audits)
        .values({ siteId: site!.id, type: "free" })
        .returning();
      await queue.enqueue(RUN_AUDIT_JOB, { auditId: audit!.id });
      return audit!.id;
    }

    async function waitForStatus(auditId: string) {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const [row] = await test.db
          .select()
          .from(audits)
          .where(eq(audits.id, auditId));
        if (
          row !== undefined &&
          (row.status === "completed" || row.status === "failed")
        ) {
          return row;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error("audit did not finish in time");
    }

    it("audits a page with known violations", async () => {
      const auditId = await enqueueAudit("/violations.html");
      const audit = await waitForStatus(auditId);
      expect(audit.status).toBe("completed");
      const stored = await test.db
        .select()
        .from(issues)
        .where(eq(issues.auditId, auditId));
      expect(stored.map((i) => i.ruleId)).toEqual(
        expect.arrayContaining(["image-alt", "button-name", "color-contrast"]),
      );
    });

    it("refuses to audit a page disallowed by robots.txt", async () => {
      const auditId = await enqueueAudit("/blocked.html");
      const audit = await waitForStatus(auditId);
      expect(audit.status).toBe("failed");
      expect(server.hits).not.toContain("/blocked.html");
    });
  },
);
