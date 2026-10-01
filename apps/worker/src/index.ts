import { chromium } from "playwright";
import { createDb } from "@accessibility/db";
import { registerAuditWorker } from "./audit/audit-worker.js";
import { runAudit } from "./audit/run-audit.js";
import { createScanner } from "./audit/scanner.js";
import { parseEnv } from "./env.js";
import { PgBossQueue } from "@accessibility/queue";
import { checkRobots } from "./security/robots.js";
import { assertPublicUrl } from "./security/ssrf.js";

const USER_AGENT = "ClariAccessBot/1.0";

const env = parseEnv(process.env);

const db = createDb(env.DATABASE_URL);
const browser = await chromium.launch();
const scan = createScanner(browser, {
  userAgent: USER_AGENT,
  timeoutMs: env.AUDIT_TIMEOUT_MS,
});

// A job may use the whole scan budget plus robots.txt; past that it is lost.
const queue = new PgBossQueue(env.DATABASE_URL, {
  jobExpireSeconds: Math.ceil((env.AUDIT_TIMEOUT_MS * 2) / 1000) + 60,
});

await queue.start();
await registerAuditWorker(queue, (auditId) =>
  runAudit(
    {
      db,
      scan,
      checkRobots: (url) =>
        checkRobots(url, {
          userAgent: USER_AGENT,
          fetch,
          guard: (target) => assertPublicUrl(target),
        }),
      maxIssues: env.AUDIT_MAX_ISSUES,
      log: console,
    },
    auditId,
  ),
);

console.log(`worker ready (${env.NODE_ENV})`);

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} received, stopping`);
  await queue.stop();
  await browser.close();
  await db.$client.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
