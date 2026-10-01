import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  audits,
  findings,
  memberships,
  organizations,
  pages,
  sites,
  users,
} from "@accessibility/db";
import { SEND_ALERT_JOB } from "@accessibility/queue";
import { adminDatabaseUrl } from "../test/integration.js";
import { FakeMailer, FakeQueue } from "../test/fakes.js";
import { createHarness, type Harness } from "../test/harness.js";
import { registerSendAlertWorker } from "./send-alert.js";

const adminUrl = adminDatabaseUrl();
const APP = "https://app.example.fr";

describe.skipIf(adminUrl === undefined)("send-alert job", () => {
  let h: Harness;
  let n = 0;

  beforeAll(async () => {
    h = await createHarness(adminUrl as string);
  });
  afterAll(async () => {
    await h.close();
  });

  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  async function member(orgId: string, email: string) {
    const [user] = await h.db.insert(users).values({ email }).returning();
    await h.db
      .insert(memberships)
      .values({ userId: user!.id, orgId, role: "member" });
  }

  // A site with an earlier completed audit and a scheduled one that just ended.
  async function setup(
    options: {
      previous?: boolean;
      type?: "scheduled" | "manual";
      status?: "completed" | "running";
    } = {},
  ) {
    n += 1;
    const [org] = await h.db
      .insert(organizations)
      .values({ name: `Org ${n}`, plan: "pro" })
      .returning();
    await member(org!.id, `owner${n}@example.fr`);
    await member(org!.id, `second${n}@example.fr`);
    const [site] = await h.db
      .insert(sites)
      .values({
        orgId: org!.id,
        baseUrl: `https://site${n}.example`,
        verificationToken: "t",
        verifiedAt: new Date(),
      })
      .returning();
    let previousId: string | undefined;
    if (options.previous !== false) {
      const [previous] = await h.db
        .insert(audits)
        .values({
          siteId: site!.id,
          type: "scheduled",
          status: "completed",
          createdAt: new Date(Date.now() - 24 * 3600 * 1000),
        })
        .returning();
      previousId = previous!.id;
    }
    const [audit] = await h.db
      .insert(audits)
      .values({
        siteId: site!.id,
        type: options.type ?? "scheduled",
        status: options.status ?? "completed",
      })
      .returning();
    const [page] = await h.db
      .insert(pages)
      .values({ siteId: site!.id, url: `${site!.baseUrl}/` })
      .returning();
    let k = 0;
    const addFinding = async (patch: Partial<typeof findings.$inferInsert>) => {
      k += 1;
      await h.db.insert(findings).values({
        siteId: site!.id,
        pageId: page!.id,
        ruleId: "image-alt",
        fingerprint: `fp-${n}-${k}`,
        impact: "serious",
        selector: `img.n${k}`,
        htmlExcerpt: "<img>",
        message: "Images must have alternate text",
        firstSeenAuditId: previousId ?? audit!.id,
        lastSeenAuditId: audit!.id,
        priorityScore: 6,
        ...patch,
      });
    };
    return {
      org: org!,
      site: site!,
      audit: audit!,
      previousId,
      addFinding,
      orgN: n,
    };
  }

  async function handler(mailer = new FakeMailer()) {
    const queue = new FakeQueue();
    await registerSendAlertWorker(queue, {
      db: h.db,
      mailer,
      appUrl: APP,
      log,
    });
    const run = queue.handlers.get(SEND_ALERT_JOB);
    if (run === undefined) throw new Error("handler not registered");
    return { run, mailer };
  }
  const sentAt = async (id: string) =>
    (await h.db.select().from(audits).where(eq(audits.id, id)))[0]!.alertSentAt;

  it("emails every member when a re-scan found a regression", async () => {
    const s = await setup();
    await s.addFinding({ status: "regressed", regressedAuditId: s.audit.id });
    const { run, mailer } = await handler();

    await run({ auditId: s.audit.id });

    expect(mailer.sent.map((m) => m.to).sort()).toEqual([
      `owner${s.orgN}@example.fr`,
      `second${s.orgN}@example.fr`,
    ]);
    expect(mailer.sent[0]?.text).toContain(`${APP}/audits/${s.audit.id}`);
    expect(mailer.sent[0]?.text).toContain("1 régression");
    expect(await sentAt(s.audit.id)).toBeInstanceOf(Date);
  });

  it("emails about a new critical problem", async () => {
    const s = await setup();
    await s.addFinding({ impact: "critical", firstSeenAuditId: s.audit.id });
    const { run, mailer } = await handler();

    await run({ auditId: s.audit.id });

    expect(mailer.sent).toHaveLength(2);
    expect(mailer.sent[0]?.text).toContain(
      "nouveau problème sérieux ou critique",
    );
  });

  it("sends nothing when there is nothing new, and does not mark it as sent", async () => {
    const s = await setup();
    // Seen again, but already known and never regressed; plus a new minor one.
    await s.addFinding({});
    await s.addFinding({ impact: "minor", firstSeenAuditId: s.audit.id });
    const { run, mailer } = await handler();

    await run({ auditId: s.audit.id });

    expect(mailer.sent).toEqual([]);
    expect(await sentAt(s.audit.id)).toBeNull();
  });

  it("is not about a regression that an earlier audit already reported", async () => {
    const s = await setup();
    await s.addFinding({ status: "regressed", regressedAuditId: s.previousId });
    const { run, mailer } = await handler();

    await run({ auditId: s.audit.id });

    expect(mailer.sent).toEqual([]);
  });

  it("sends nothing on the first audit of a site", async () => {
    const s = await setup({ previous: false });
    await s.addFinding({ status: "regressed", regressedAuditId: s.audit.id });
    const { run, mailer } = await handler();

    await run({ auditId: s.audit.id });

    expect(mailer.sent).toEqual([]);
  });

  it("sends nothing for a manual audit, an audit still running or one that does not exist", async () => {
    const manual = await setup({ type: "manual" });
    await manual.addFinding({
      status: "regressed",
      regressedAuditId: manual.audit.id,
    });
    const running = await setup({ status: "running" });
    await running.addFinding({
      status: "regressed",
      regressedAuditId: running.audit.id,
    });
    const { run, mailer } = await handler();

    await run({ auditId: manual.audit.id });
    await run({ auditId: running.audit.id });
    await run({ auditId: "00000000-0000-4000-8000-000000000000" });

    expect(mailer.sent).toEqual([]);
  });

  it("does not send twice when the job is delivered again", async () => {
    const s = await setup();
    await s.addFinding({ status: "regressed", regressedAuditId: s.audit.id });
    const { run, mailer } = await handler();

    await run({ auditId: s.audit.id });
    await run({ auditId: s.audit.id });

    expect(mailer.sent).toHaveLength(2);
  });

  it("does not send twice when delivered at the same time", async () => {
    const s = await setup();
    await s.addFinding({ status: "regressed", regressedAuditId: s.audit.id });
    const { run, mailer } = await handler();

    await Promise.all([
      run({ auditId: s.audit.id }),
      run({ auditId: s.audit.id }),
    ]);

    expect(mailer.sent).toHaveLength(2);
  });

  it("fails, to be retried, when the mail server is down for everyone, and sends later", async () => {
    const s = await setup();
    await s.addFinding({ status: "regressed", regressedAuditId: s.audit.id });
    const mailer = new FakeMailer();
    const { run } = await handler(mailer);
    mailer.fail = true;

    await expect(run({ auditId: s.audit.id })).rejects.toThrow();
    expect(await sentAt(s.audit.id)).toBeNull();

    mailer.fail = false;
    await run({ auditId: s.audit.id });
    expect(mailer.sent).toHaveLength(2);
  });

  it("keeps going and does not resend when only some recipients fail", async () => {
    const s = await setup();
    await s.addFinding({ status: "regressed", regressedAuditId: s.audit.id });
    const mailer = new FakeMailer();
    const original = mailer.send.bind(mailer);
    mailer.send = async (message) => {
      if (message.to.startsWith("owner")) throw new Error("mailbox full");
      await original(message);
    };
    const { run } = await handler(mailer);

    await expect(run({ auditId: s.audit.id })).resolves.toBeUndefined();
    await run({ auditId: s.audit.id });

    expect(mailer.sent.map((m) => m.to)).toEqual([
      `second${s.orgN}@example.fr`,
    ]);
    expect(await sentAt(s.audit.id)).toBeInstanceOf(Date);
    expect(log.error).toHaveBeenCalled();
  });

  it("rejects an invalid payload without doing anything", async () => {
    const { run, mailer } = await handler();

    await expect(run({ auditId: "nope" })).rejects.toThrow();
    expect(mailer.sent).toEqual([]);
  });
});
