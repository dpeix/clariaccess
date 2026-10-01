import { createDb } from "@accessibility/db";
import {
  PgBossQueue,
  RENDER_STATEMENT_PDF_JOB,
  RENDER_STATEMENT_PDF_QUEUE_OPTIONS,
  SEND_ALERT_JOB,
  SEND_ALERT_QUEUE_OPTIONS,
  SEND_REPORT_QUEUE_OPTIONS,
  SEND_REPORT_JOB,
} from "@accessibility/queue";
import { buildApp } from "./app.js";
import { parseEnv } from "./env.js";
import { registerSendAlertWorker } from "./jobs/send-alert.js";
import { registerSendReportWorker } from "./jobs/send-report.js";
import { createSmtpMailer } from "./mail/nodemailer-mailer.js";

const env = parseEnv(process.env);

const db = createDb(env.DATABASE_URL);
const queue = new PgBossQueue(env.DATABASE_URL, {
  queueOptions: {
    [SEND_REPORT_JOB]: SEND_REPORT_QUEUE_OPTIONS,
    [SEND_ALERT_JOB]: SEND_ALERT_QUEUE_OPTIONS,
    [RENDER_STATEMENT_PDF_JOB]: RENDER_STATEMENT_PDF_QUEUE_OPTIONS,
  },
});
await queue.start();

const mailer = createSmtpMailer(env.SMTP_URL, env.MAIL_FROM);

const app = buildApp({
  db,
  queue,
  logger: true,
  mailer,
  config: {
    ipRateLimit: {
      max: env.RATE_LIMIT_IP_MAX,
      windowSeconds: env.RATE_LIMIT_IP_WINDOW_SECONDS,
    },
    domainDailyAuditLimit: env.DOMAIN_DAILY_AUDIT_LIMIT,
    trustProxy: env.TRUST_PROXY,
    // PUBLIC_SITE_URL may carry a path or trailing slash; CORS wants the origin.
    corsOrigin: new URL(env.PUBLIC_SITE_URL).origin,
    appOrigin: new URL(env.APP_URL).origin,
    secureCookies: env.NODE_ENV === "production",
    loginRateLimit: {
      max: env.LOGIN_RATE_LIMIT_MAX,
      windowSeconds: env.LOGIN_RATE_LIMIT_WINDOW_SECONDS,
    },
    loginEmailsPerAddressPerHour: 5,
    siteDailyAuditLimit: env.SITE_DAILY_AUDIT_LIMIT,
  },
});

await registerSendReportWorker(queue, {
  db,
  mailer,
  publicSiteUrl: env.PUBLIC_SITE_URL,
  log: app.log,
});

await registerSendAlertWorker(queue, {
  db,
  mailer,
  appUrl: env.APP_URL,
  log: app.log,
});

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (error) {
  console.error("api failed to start", error);
  process.exit(1);
}

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  app.log.info(`${signal} received, stopping`);
  await app.close();
  await queue.stop();
  await db.$client.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
