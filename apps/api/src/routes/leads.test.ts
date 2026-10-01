import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditSchema, errorSchema } from "@accessibility/contracts";
import { leads } from "@accessibility/db";
import { SEND_REPORT_JOB } from "@accessibility/queue";
import { adminDatabaseUrl } from "../test/integration.js";
import { createHarness, type Harness } from "../test/harness.js";

const adminUrl = adminDatabaseUrl();

describe.skipIf(adminUrl === undefined)("POST /leads", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness(adminUrl as string);
  });
  afterAll(async () => {
    await h.close();
  });

  async function newAudit(url: string) {
    const response = await h.app.inject({
      method: "POST",
      url: "/audits/free",
      payload: { url },
    });
    return auditSchema.parse(response.json());
  }

  const postLead = (payload: Record<string, unknown>) =>
    h.app.inject({ method: "POST", url: "/leads", payload });

  const leadsOf = (auditId: string) =>
    h.db.select().from(leads).where(eq(leads.auditId, auditId));

  const sendReportJobs = () =>
    h.queue.jobs.filter((job) => job.name === SEND_REPORT_JOB);

  it("records the lead with its consent and queues the report email", async () => {
    const audit = await newAudit("https://lead1.example.fr/");
    const before = sendReportJobs().length;

    const response = await postLead({
      email: "Visiteur@Example.FR",
      auditId: audit.id,
      consent: true,
      source: "seo",
      utm: { utm_source: "newsletter" },
    });

    expect(response.statusCode).toBe(201);
    const [lead] = await leadsOf(audit.id);
    expect(lead).toMatchObject({
      email: "visiteur@example.fr",
      url: "https://lead1.example.fr/",
      consent: true,
      source: "seo",
      utm: { utm_source: "newsletter" },
      reportSentAt: null,
    });
    expect(lead?.consentedAt).toBeInstanceOf(Date);
    expect(sendReportJobs()).toHaveLength(before + 1);
    expect(sendReportJobs().at(-1)?.payload).toEqual({ leadId: lead?.id });
  });

  it.each([
    ["without consent", { consent: false }],
    ["with consent missing", { consent: undefined }],
    ["with an invalid email", { email: "nope" }],
    ["with an invalid audit id", { auditId: "123" }],
  ])("rejects a lead %s and stores nothing", async (_name, override) => {
    const audit = await newAudit(
      `https://lead-bad-${_name.length}.example.fr/`,
    );
    const before = sendReportJobs().length;
    const response = await postLead({
      email: "a@example.fr",
      auditId: audit.id,
      consent: true,
      ...override,
    });
    expect(response.statusCode).toBe(400);
    expect(errorSchema.parse(response.json()).error).toBe("invalid_request");
    expect(await leadsOf(audit.id)).toEqual([]);
    expect(sendReportJobs()).toHaveLength(before);
  });

  it("answers 404 for an unknown audit", async () => {
    const response = await postLead({
      email: "a@example.fr",
      auditId: "6f1c1c1e-8d5e-4a37-9d57-3c1a4f0f2a10",
      consent: true,
    });
    expect(response.statusCode).toBe(404);
    expect(errorSchema.parse(response.json()).error).toBe("not_found");
  });

  it("keeps a single lead per email and audit, whatever the email case", async () => {
    const audit = await newAudit("https://lead2.example.fr/");
    const body = { auditId: audit.id, consent: true };
    expect(
      (await postLead({ ...body, email: "dup@example.fr" })).statusCode,
    ).toBe(201);
    expect(
      (await postLead({ ...body, email: "DUP@example.fr" })).statusCode,
    ).toBe(201);
    expect(await leadsOf(audit.id)).toHaveLength(1);
  });

  it("does not queue the email again once the report was sent", async () => {
    const audit = await newAudit("https://lead3.example.fr/");
    const body = { email: "sent@example.fr", auditId: audit.id, consent: true };
    await postLead(body);
    await h.db
      .update(leads)
      .set({ reportSentAt: new Date() })
      .where(eq(leads.auditId, audit.id));
    const before = sendReportJobs().length;

    expect((await postLead(body)).statusCode).toBe(201);
    expect(sendReportJobs()).toHaveLength(before);
  });

  it("queues the email again on resubmission while it was not sent yet", async () => {
    const audit = await newAudit("https://lead4.example.fr/");
    const body = {
      email: "again@example.fr",
      auditId: audit.id,
      consent: true,
    };
    await postLead(body);
    const before = sendReportJobs().length;

    expect((await postLead(body)).statusCode).toBe(201);
    expect(sendReportJobs()).toHaveLength(before + 1);
  });

  it("answers 503 when the email cannot be queued, and recovers on retry", async () => {
    const audit = await newAudit("https://lead5.example.fr/");
    const body = {
      email: "outage@example.fr",
      auditId: audit.id,
      consent: true,
    };
    h.queue.failEnqueue = true;
    try {
      const failed = await postLead(body);
      expect(failed.statusCode).toBe(503);
      expect(errorSchema.parse(failed.json()).error).toBe("queue_unavailable");
    } finally {
      h.queue.failEnqueue = false;
    }
    expect(await leadsOf(audit.id)).toHaveLength(1);

    const before = sendReportJobs().length;
    expect((await postLead(body)).statusCode).toBe(201);
    expect(sendReportJobs()).toHaveLength(before + 1);
  });
});

describe.skipIf(adminUrl === undefined)("POST /leads rate limit", () => {
  it("limits submissions per IP", async () => {
    const h = await createHarness(adminUrl as string, {
      ipRateLimit: { max: 1, windowSeconds: 3600 },
    });
    try {
      const send = () =>
        h.app.inject({
          method: "POST",
          url: "/leads",
          payload: {
            email: "a@example.fr",
            auditId: "6f1c1c1e-8d5e-4a37-9d57-3c1a4f0f2a10",
            consent: true,
          },
          remoteAddress: "10.7.7.7",
        });
      expect((await send()).statusCode).toBe(404);
      expect((await send()).statusCode).toBe(429);
    } finally {
      await h.close();
    }
  });
});
