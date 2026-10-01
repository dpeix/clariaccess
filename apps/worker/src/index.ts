import { resolveTxt } from "node:dns/promises";
import { chromium } from "playwright";
import { createDb } from "@accessibility/db";
import { registerAuditWorker } from "./audit/audit-worker.js";
import { runAudit } from "./audit/run-audit.js";
import { createScanner } from "./audit/scanner.js";
import { runDueScans } from "./scheduler/due-scans.js";
import { registerDueScansWorker } from "./scheduler/due-scans-worker.js";
import { createFetchText } from "./crawl/fetch-text.js";
import { scanPage } from "./crawl/scan-page.js";
import { registerScanPageWorker } from "./crawl/scan-page-worker.js";
import { parseEnv } from "./env.js";
import { renderStatementPdf } from "./statement/render-pdf.js";
import { registerRenderStatementWorker } from "./statement/render-worker.js";
import { verifySite } from "./verify/verify-site.js";
import { registerVerifyWorker } from "./verify/verify-worker.js";
import {
  PgBossQueue,
  RENDER_STATEMENT_PDF_JOB,
  RENDER_STATEMENT_PDF_QUEUE_OPTIONS,
  SEND_ALERT_JOB,
  SEND_ALERT_QUEUE_OPTIONS,
} from "@accessibility/queue";
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
  // The alert job is consumed by the API: both sides must create its queue
  // with the same policy.
  queueOptions: {
    [SEND_ALERT_JOB]: SEND_ALERT_QUEUE_OPTIONS,
    [RENDER_STATEMENT_PDF_JOB]: RENDER_STATEMENT_PDF_QUEUE_OPTIONS,
  },
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

await registerVerifyWorker(queue, (siteId) =>
  verifySite(
    {
      db,
      resolveTxt,
      fetch,
      guard: (target) => assertPublicUrl(target),
      userAgent: USER_AGENT,
      log: console,
    },
    siteId,
  ),
);

const robotsOptions = {
  userAgent: USER_AGENT,
  fetch,
  guard: (target: string) => assertPublicUrl(target),
};
const fetchText = createFetchText({
  ...robotsOptions,
  timeoutMs: 10_000,
  maxBytes: 2 * 1024 * 1024,
});
await registerScanPageWorker(queue, (job) =>
  scanPage(
    {
      db,
      queue,
      scan,
      checkRobots: (url) => checkRobots(url, robotsOptions),
      fetchText,
      maxIssues: env.AUDIT_MAX_ISSUES,
      maxPages: env.CRAWL_MAX_PAGES,
      maxDurationMs: env.CRAWL_MAX_DURATION_MS,
      log: console,
    },
    job,
  ),
);

await registerDueScansWorker(queue, queue, env.SCAN_TICK_CRON, () =>
  runDueScans({
    db,
    queue,
    now: () => new Date(),
    batchSize: env.SCAN_TICK_BATCH,
    log: console,
  }),
);

await registerRenderStatementWorker(queue, (statementId) =>
  renderStatementPdf({ db, browser, log: console }, statementId),
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
