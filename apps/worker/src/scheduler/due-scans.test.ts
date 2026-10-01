import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  audits,
  auditPages,
  organizations,
  runMigrations,
  seedRules,
  sites,
} from "@accessibility/db";
import {
  createTestDatabase,
  type TestDatabase,
} from "@accessibility/db/test-helpers";
import { frequencyIntervalMs } from "@accessibility/contracts";
import {
  SCAN_PAGE_JOB,
  scanPagePayloadSchema,
  type JobQueue,
} from "@accessibility/queue";
import { adminDatabaseUrl } from "../test/integration.js";
import { runDueScans, type DueScansDeps } from "./due-scans.js";

const adminUrl = adminDatabaseUrl();
const NOW = new Date("2026-10-01T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function recordingQueue() {
  const jobs: { name: string; payload: { auditId: string; pageId: string } }[] =
    [];
  const state = { fail: false };
  const queue: JobQueue = {
    start: async () => undefined,
    enqueue: async (name, payload) => {
      if (state.fail) throw new Error("queue down");
      jobs.push({ name, payload: scanPagePayloadSchema.parse(payload) });
      return `job-${jobs.length}`;
    },
    work: async () => undefined,
    stop: async () => undefined,
  };
  return { queue, jobs, state };
}

describe.skipIf(adminUrl === undefined)("runDueScans", () => {
  let test: TestDatabase;
  let n = 0;

  beforeAll(async () => {
    test = await createTestDatabase(adminUrl as string);
    await runMigrations(test.db);
    await seedRules(test.db);
  });
  afterAll(async () => {
    await test.close();
  });

  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  beforeEach(() => {
    vi.clearAllMocks();
  });

  interface SiteOptions {
    plan?: string;
    frequency?: "weekly" | "daily" | null;
    due?: Date | null;
    verified?: boolean;
    orgId?: string | null;
  }
  async function newSite(options: SiteOptions = {}) {
    n += 1;
    let orgId = options.orgId;
    if (orgId === undefined) {
      orgId = (
        await test.db
          .insert(organizations)
          .values({ name: `Org ${n}`, plan: options.plan ?? "pro" })
          .returning({ id: organizations.id })
      )[0]!.id;
    }
    const [site] = await test.db
      .insert(sites)
      .values({
        orgId,
        baseUrl: `https://site${n}.example`,
        verificationToken: "t",
        verifiedAt:
          options.verified === false ? null : new Date(NOW.getTime() - 1000),
        scanFrequency:
          options.frequency === undefined ? "daily" : options.frequency,
        nextScanAt:
          options.due === undefined
            ? new Date(NOW.getTime() - HOUR)
            : options.due,
      })
      .returning();
    return site!;
  }

  const deps = (
    queue: JobQueue,
    overrides: Partial<DueScansDeps> = {},
  ): DueScansDeps => ({
    db: test.db,
    queue,
    now: () => NOW,
    batchSize: 20,
    log,
    ...overrides,
  });
  const auditsOf = (siteId: string) =>
    test.db.select().from(audits).where(eq(audits.siteId, siteId));
  const siteRow = async (id: string) =>
    (await test.db.select().from(sites).where(eq(sites.id, id)))[0]!;

  it("starts a scheduled audit for a due site and queues its home page", async () => {
    const site = await newSite();
    const rec = recordingQueue();

    const outcome = await runDueScans(deps(rec.queue));

    expect(outcome.started).toBeGreaterThanOrEqual(1);
    const [audit] = await auditsOf(site.id);
    expect(audit).toMatchObject({ type: "scheduled", status: "queued" });
    const [link] = await test.db
      .select()
      .from(auditPages)
      .where(eq(auditPages.auditId, audit!.id));
    expect(rec.jobs).toContainEqual({
      name: SCAN_PAGE_JOB,
      payload: { auditId: audit!.id, pageId: link!.pageId },
    });
  });

  it("schedules the next scan one interval from now, not from the missed date", async () => {
    const daily = await newSite({
      frequency: "daily",
      due: new Date(NOW.getTime() - 10 * 24 * HOUR),
    });
    const weekly = await newSite({ frequency: "weekly" });

    await runDueScans(deps(recordingQueue().queue));

    expect((await siteRow(daily.id)).nextScanAt).toEqual(
      new Date(NOW.getTime() + frequencyIntervalMs("daily")),
    );
    expect((await siteRow(weekly.id)).nextScanAt).toEqual(
      new Date(NOW.getTime() + frequencyIntervalMs("weekly")),
    );
  });

  it("does not start a second audit when the tick repeats", async () => {
    const site = await newSite();
    const rec = recordingQueue();

    await runDueScans(deps(rec.queue));
    await runDueScans(deps(rec.queue));

    expect(await auditsOf(site.id)).toHaveLength(1);
  });

  it("starts exactly one audit when two ticks run at the same time", async () => {
    const site = await newSite();
    const rec = recordingQueue();

    await Promise.all([
      runDueScans(deps(rec.queue)),
      runDueScans(deps(rec.queue)),
    ]);

    const started = await auditsOf(site.id);
    expect(started).toHaveLength(1);
    expect(
      rec.jobs.filter((j) => j.payload.auditId === started[0]!.id),
    ).toHaveLength(1);
  });

  it.each([
    ["not due yet", { due: new Date(NOW.getTime() + HOUR) }],
    ["no schedule", { frequency: null, due: null }],
    ["not verified", { verified: false }],
    ["on the free plan", { plan: "free" }],
    ["without organization", { orgId: null }],
  ] as const)("ignores a site that is %s", async (_label, options) => {
    const site = await newSite(options as SiteOptions);

    await runDueScans(deps(recordingQueue().queue));

    expect(await auditsOf(site.id)).toHaveLength(0);
    const row = await siteRow(site.id);
    expect(row.nextScanAt?.getTime()).toBe(site.nextScanAt?.getTime());
  });

  it("resumes a downgraded organization's schedule once it is back on a paid plan", async () => {
    const site = await newSite({ plan: "free" });
    await runDueScans(deps(recordingQueue().queue));
    expect(await auditsOf(site.id)).toHaveLength(0);

    await test.db
      .update(organizations)
      .set({ plan: "pro" })
      .where(eq(organizations.id, site.orgId!));
    await runDueScans(deps(recordingQueue().queue));

    expect(await auditsOf(site.id)).toHaveLength(1);
  });

  it("does not start over a running audit and tries again soon", async () => {
    const site = await newSite({ frequency: "weekly" });
    await test.db
      .insert(audits)
      .values({ siteId: site.id, type: "manual", status: "running" });
    const rec = recordingQueue();

    const outcome = await runDueScans(deps(rec.queue));

    expect(await auditsOf(site.id)).toHaveLength(1);
    expect(outcome.busy).toBeGreaterThanOrEqual(1);
    const next = (await siteRow(site.id)).nextScanAt!.getTime();
    expect(next).toBeGreaterThan(NOW.getTime());
    expect(next).toBeLessThanOrEqual(NOW.getTime() + HOUR);
  });

  it("removes the audit and keeps the site due when the job cannot be queued", async () => {
    const site = await newSite();
    const rec = recordingQueue();
    rec.state.fail = true;

    await runDueScans(deps(rec.queue));

    expect(await auditsOf(site.id)).toHaveLength(0);
    expect((await siteRow(site.id)).nextScanAt).toEqual(site.nextScanAt);
    expect(log.error).toHaveBeenCalled();

    rec.state.fail = false;
    await runDueScans(deps(rec.queue));
    expect(await auditsOf(site.id)).toHaveLength(1);
  });

  it("handles at most one batch per tick, oldest due first, the rest on the next", async () => {
    const first = await newSite({ due: new Date(NOW.getTime() - 3 * HOUR) });
    const second = await newSite({ due: new Date(NOW.getTime() - 2 * HOUR) });
    const third = await newSite({ due: new Date(NOW.getTime() - 1 * HOUR) });
    // Other tests' sites are not due any more (their next scan moved forward).
    const rec = recordingQueue();

    const one = await runDueScans(deps(rec.queue, { batchSize: 2 }));

    expect(one.started).toBe(2);
    expect(await auditsOf(first.id)).toHaveLength(1);
    expect(await auditsOf(second.id)).toHaveLength(1);
    expect(await auditsOf(third.id)).toHaveLength(0);

    await runDueScans(deps(rec.queue, { batchSize: 2 }));
    expect(await auditsOf(third.id)).toHaveLength(1);
  });

  it("does not count scheduled scans against the customer's manual quota", async () => {
    const site = await newSite();
    for (let i = 0; i < 4; i += 1) {
      await test.db
        .insert(audits)
        .values({ siteId: site.id, type: "manual", status: "completed" });
    }

    await runDueScans(deps(recordingQueue().queue));

    expect(
      (await auditsOf(site.id)).filter((a) => a.type === "scheduled"),
    ).toHaveLength(1);
  });
});
