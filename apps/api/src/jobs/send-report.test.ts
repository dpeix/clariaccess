import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { audits, leads, sites, type Database } from "@accessibility/db";
import { SEND_REPORT_JOB } from "@accessibility/queue";
import { adminDatabaseUrl } from "../test/integration.js";
import { FakeMailer, FakeQueue } from "../test/fakes.js";
import { createHarness, type Harness } from "../test/harness.js";
import { registerSendReportWorker } from "./send-report.js";

const adminUrl = adminDatabaseUrl();

describe.skipIf(adminUrl === undefined)("send-report job", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness(adminUrl as string);
  });
  afterAll(async () => {
    await h.close();
  });

  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  async function setup(
    status: "queued" | "completed" | "failed",
    email = "visiteur@example.fr",
  ) {
    const db: Database = h.db;
    const [site] = await db
      .insert(sites)
      .values({ baseUrl: `https://${status}-${Math.random()}.example.fr/` })
      .returning();
    const [audit] = await db
      .insert(audits)
      .values({
        siteId: site!.id,
        type: "free",
        status,
        score: status === "completed" ? 80 : null,
      })
      .returning();
    const [lead] = await db
      .insert(leads)
      .values({ email, consent: true, auditId: audit!.id })
      .returning();
    return { audit: audit!, lead: lead! };
  }

  async function handler(mailer = new FakeMailer()) {
    const queue = new FakeQueue();
    await registerSendReportWorker(queue, {
      db: h.db,
      mailer,
      publicSiteUrl: "https://www.example.fr",
      log,
    });
    const run = queue.handlers.get(SEND_REPORT_JOB);
    if (run === undefined) throw new Error("handler not registered");
    return { run, mailer };
  }

  const reportSentAt = async (leadId: string) =>
    (await h.db.select().from(leads).where(eq(leads.id, leadId)))[0]
      ?.reportSentAt;

  it("emails the report of a completed audit once and records it", async () => {
    const { audit, lead } = await setup("completed");
    const { run, mailer } = await handler();

    await run({ leadId: lead.id });

    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe("visiteur@example.fr");
    expect(mailer.sent[0]?.text).toContain(
      `https://www.example.fr/audit/${audit.id}`,
    );
    expect(mailer.sent[0]?.text).toContain("80");
    expect(await reportSentAt(lead.id)).toBeInstanceOf(Date);

    await run({ leadId: lead.id });
    expect(mailer.sent).toHaveLength(1);
  });

  it("throws while the audit is not finished so that the queue retries", async () => {
    const { lead } = await setup("queued");
    const { run, mailer } = await handler();
    await expect(run({ leadId: lead.id })).rejects.toThrow(/not finished/i);
    expect(mailer.sent).toEqual([]);
    expect(await reportSentAt(lead.id)).toBeNull();
  });

  it("sends nothing and does not retry for a failed audit", async () => {
    const { lead } = await setup("failed");
    const { run, mailer } = await handler();
    await expect(run({ leadId: lead.id })).resolves.toBeUndefined();
    expect(mailer.sent).toEqual([]);
    expect(log.warn).toHaveBeenCalled();
  });

  it("ignores a lead that no longer exists", async () => {
    const { run, mailer } = await handler();
    await expect(
      run({ leadId: "6f1c1c1e-8d5e-4a37-9d57-3c1a4f0f2a10" }),
    ).resolves.toBeUndefined();
    expect(mailer.sent).toEqual([]);
  });

  it("rejects an invalid payload", async () => {
    const { run } = await handler();
    await expect(run({ leadId: "nope" })).rejects.toThrow();
    await expect(run(undefined)).rejects.toThrow();
  });

  it("does not mark the report as sent when the mail is refused", async () => {
    const { lead } = await setup("completed");
    const mailer = new FakeMailer();
    mailer.fail = true;
    const { run } = await handler(mailer);
    await expect(run({ leadId: lead.id })).rejects.toThrow("smtp down");
    expect(await reportSentAt(lead.id)).toBeNull();
  });

  it("does not log the address of the visitor", async () => {
    const { lead } = await setup("completed", "private.person@example.fr");
    const { run } = await handler();
    await run({ leadId: lead.id });
    const logged = [log.info, log.warn, log.error]
      .flatMap((fn) => fn.mock.calls)
      .join(" ");
    expect(logged).not.toContain("private.person");
  });
});
