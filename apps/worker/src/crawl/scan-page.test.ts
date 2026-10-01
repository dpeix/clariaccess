import { and, eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Result } from "axe-core";
import {
  auditPages,
  audits,
  issues,
  organizations,
  pages,
  runMigrations,
  seedRules,
  sites,
} from "@accessibility/db";
import {
  createTestDatabase,
  type TestDatabase,
} from "@accessibility/db/test-helpers";
import {
  SCAN_PAGE_JOB,
  SEND_ALERT_JOB,
  scanPagePayloadSchema,
  type JobQueue,
} from "@accessibility/queue";
import { PLAN_LIMITS } from "@accessibility/contracts";
import { computeScore } from "@accessibility/rules";
import { adminDatabaseUrl } from "../test/integration.js";
import { UrlNotAllowedError } from "../security/ssrf.js";
import type { Scan, ScanResult } from "../audit/scanner.js";
import { scanPage, type ScanPageDeps } from "./scan-page.js";

const adminUrl = adminDatabaseUrl();
const ORIGIN = "https://acme.example";

function violation(id: string, targets: string[]): Result {
  return {
    id,
    impact: "serious",
    tags: [],
    description: id,
    help: `help ${id}`,
    helpUrl: `https://example.test/${id}`,
    nodes: targets.map((target) => ({
      html: `<x data-t="${target}">`,
      target: [target],
      failureSummary: "fix it",
    })),
  } as unknown as Result;
}

const result = (
  links: string[] = [],
  violations: Result[] = [],
): ScanResult => ({
  violations,
  axeVersion: "4.13.0",
  finalUrl: ORIGIN,
  blockedRequests: [],
  links,
});

// Records jobs like the real queue would store them.
function recordingQueue() {
  const jobs: { name: string; payload: { auditId: string; pageId: string } }[] =
    [];
  const alerts: { auditId: string }[] = [];
  const state = { fail: false, failAlert: false };
  const queue: JobQueue = {
    start: async () => undefined,
    enqueue: async (name, payload) => {
      if (name === SEND_ALERT_JOB) {
        if (state.failAlert) throw new Error("queue down");
        alerts.push(payload as { auditId: string });
        return `alert-${alerts.length}`;
      }
      if (state.fail) throw new Error("queue down");
      jobs.push({
        name,
        payload: scanPagePayloadSchema.parse(payload),
      });
      return `job-${jobs.length}`;
    },
    work: async () => undefined,
    stop: async () => undefined,
  };
  return { queue, jobs, alerts, state };
}

describe.skipIf(adminUrl === undefined)("scanPage", () => {
  let test: TestDatabase;

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

  // A verified-site audit with its home page waiting to be scanned.
  async function startAudit(baseUrl = ORIGIN, plan: string | null = null) {
    const orgId =
      plan === null
        ? undefined
        : (
            await test.db
              .insert(organizations)
              .values({ name: "Acme", plan })
              .returning({ id: organizations.id })
          )[0]!.id;
    const [site] = await test.db
      .insert(sites)
      .values({
        baseUrl,
        orgId,
        verificationToken: "t",
        verifiedAt: new Date(),
      })
      .returning();
    const [audit] = await test.db
      .insert(audits)
      .values({ siteId: site!.id, type: "manual", status: "queued" })
      .returning();
    const [page] = await test.db
      .insert(pages)
      .values({ siteId: site!.id, url: `${baseUrl}/` })
      .returning();
    await test.db
      .insert(auditPages)
      .values({ auditId: audit!.id, pageId: page!.id });
    return { site: site!, audit: audit!, page: page! };
  }

  // Serves a small site: url -> links and violations.
  function siteScan(
    map: Record<string, { links?: string[]; violations?: Result[] } | "error">,
  ): Scan {
    return vi.fn<Scan>(async (url) => {
      const entry = map[url.href];
      if (entry === undefined || entry === "error") {
        throw new Error(`cannot scan ${url.href}`);
      }
      return result(entry.links, entry.violations);
    });
  }

  function makeDeps(
    queue: JobQueue,
    overrides: Partial<ScanPageDeps> = {},
  ): ScanPageDeps {
    return {
      db: test.db,
      queue,
      scan: siteScan({}),
      checkRobots: async () => ({ allowed: true }),
      fetchText: async () => null,
      maxIssues: 100,
      maxPages: 25,
      maxDurationMs: 10 * 60 * 1000,
      log,
      ...overrides,
    };
  }

  // Runs queued jobs the way the worker would, until none are left.
  async function drain(
    rec: ReturnType<typeof recordingQueue>,
    deps: ScanPageDeps,
    concurrently = false,
  ) {
    while (rec.jobs.length > 0) {
      const batch = concurrently ? rec.jobs.splice(0) : rec.jobs.splice(0, 1);
      await Promise.all(batch.map((job) => scanPage(deps, job.payload)));
    }
  }

  const auditRow = async (id: string) =>
    (await test.db.select().from(audits).where(eq(audits.id, id)))[0]!;
  const auditPageRows = async (auditId: string) =>
    test.db
      .select({ url: pages.url, status: auditPages.status })
      .from(auditPages)
      .innerJoin(pages, eq(pages.id, auditPages.pageId))
      .where(eq(auditPages.auditId, auditId))
      .orderBy(pages.url);
  const issueCount = async (auditId: string) =>
    (await test.db.select().from(issues).where(eq(issues.auditId, auditId)))
      .length;

  it("scans the home page, stores its issues and queues the pages it links to", async () => {
    const { audit, page } = await startAudit();
    const rec = recordingQueue();
    const scan = siteScan({
      [`${ORIGIN}/`]: {
        links: [
          `${ORIGIN}/a`,
          `${ORIGIN}/b#frag`,
          `${ORIGIN}/a`,
          "https://other.example/x",
          `${ORIGIN}/brochure.pdf`,
          "mailto:x@acme.example",
        ],
        violations: [violation("image-alt", ["img.a"])],
      },
    });

    const outcome = await scanPage(makeDeps(rec.queue, { scan }), {
      auditId: audit.id,
      pageId: page.id,
    });

    expect(outcome).toBe("done");
    expect(await auditPageRows(audit.id)).toEqual([
      { url: `${ORIGIN}/`, status: "done" },
      { url: `${ORIGIN}/a`, status: "pending" },
      { url: `${ORIGIN}/b`, status: "pending" },
    ]);
    expect(rec.jobs.map((j) => j.name)).toEqual([SCAN_PAGE_JOB, SCAN_PAGE_JOB]);
    expect(await issueCount(audit.id)).toBe(1);
    // Pages are still pending: the audit is not over.
    const row = await auditRow(audit.id);
    expect(row.status).toBe("running");
    expect(row.startedAt).not.toBeNull();
    expect(row.finishedAt).toBeNull();
  });

  it("completes the audit once every page is scanned, over all pages", async () => {
    const { audit, page } = await startAudit();
    const rec = recordingQueue();
    const scan = siteScan({
      [`${ORIGIN}/`]: {
        links: [`${ORIGIN}/a`, `${ORIGIN}/b`],
        violations: [violation("image-alt", ["img.a"])],
      },
      [`${ORIGIN}/a`]: { violations: [violation("button-name", ["button"])] },
      [`${ORIGIN}/b`]: { violations: [] },
    });
    const deps = makeDeps(rec.queue, { scan });

    await scanPage(deps, { auditId: audit.id, pageId: page.id });
    await drain(rec, deps);

    const row = await auditRow(audit.id);
    expect(row.status).toBe("completed");
    expect(row.pagesScanned).toBe(3);
    expect(row.finishedAt).not.toBeNull();
    expect(row.score).toBe(
      computeScore([{ impact: "serious" }, { impact: "serious" }]),
    );
    expect(row.engineVersion).toMatch(/^axe-core@4\.13\.0\+rules@/);
    expect(await issueCount(audit.id)).toBe(2);
  });

  it("never exceeds the page cap", async () => {
    const { audit, page } = await startAudit();
    const rec = recordingQueue();
    const links = Array.from({ length: 10 }, (_, i) => `${ORIGIN}/p${i}`);
    const scan = vi.fn<Scan>(async (url) =>
      result(url.pathname === "/" ? links : []),
    );
    const deps = makeDeps(rec.queue, { scan, maxPages: 4 });

    await scanPage(deps, { auditId: audit.id, pageId: page.id });
    await drain(rec, deps);

    expect(await auditPageRows(audit.id)).toHaveLength(4);
    expect((await auditRow(audit.id)).status).toBe("completed");
    expect((await auditRow(audit.id)).pagesScanned).toBe(4);
  });

  describe("plan page cap", () => {
    const manyLinks = (n: number) =>
      Array.from({ length: n }, (_, i) => `https://plan.example/p${i}`);

    async function crawl(plan: string | null, maxPages: number) {
      const { audit, page } = await startAudit("https://plan.example", plan);
      const rec = recordingQueue();
      const scan = vi.fn<Scan>(async (url) =>
        result(url.pathname === "/" ? manyLinks(150) : []),
      );
      const deps = makeDeps(rec.queue, { scan, maxPages });
      await scanPage(deps, { auditId: audit.id, pageId: page.id });
      await drain(rec, deps);
      return (await auditPageRows(audit.id)).length;
    }

    it("stops a free organization at its plan's pages, below the deployment cap", async () => {
      expect(await crawl("free", 100)).toBe(PLAN_LIMITS.free.maxPagesPerAudit);
    });

    it("lets a pro organization go further", async () => {
      expect(await crawl("pro", 100)).toBe(
        Math.min(100, PLAN_LIMITS.pro.maxPagesPerAudit),
      );
    });

    it("never goes above the deployment cap, whatever the plan", async () => {
      expect(await crawl("pro", 12)).toBe(12);
    });

    it("treats a site without organization like a free one", async () => {
      expect(await crawl(null, 100)).toBe(PLAN_LIMITS.free.maxPagesPerAudit);
    });
  });

  describe("regression alert job", () => {
    async function crawlAs(type: "manual" | "scheduled", failAlert = false) {
      const { audit, page } = await startAudit();
      await test.db.update(audits).set({ type }).where(eq(audits.id, audit.id));
      const rec = recordingQueue();
      rec.state.failAlert = failAlert;
      const scan = siteScan({
        [`${ORIGIN}/`]: { links: [`${ORIGIN}/a`] },
        [`${ORIGIN}/a`]: {},
      });
      const deps = makeDeps(rec.queue, { scan });
      await scanPage(deps, { auditId: audit.id, pageId: page.id });
      await drain(rec, deps);
      return { audit, rec };
    }

    it("is queued once when a scheduled audit completes", async () => {
      const { audit, rec } = await crawlAs("scheduled");

      expect(rec.alerts).toEqual([{ auditId: audit.id }]);
    });

    it("is not queued for a manual audit: the customer is watching", async () => {
      const { rec } = await crawlAs("manual");

      expect(rec.alerts).toEqual([]);
    });

    it("is not queued when the scheduled audit failed", async () => {
      const { audit, page } = await startAudit();
      await test.db
        .update(audits)
        .set({ type: "scheduled" })
        .where(eq(audits.id, audit.id));
      const rec = recordingQueue();

      await scanPage(
        makeDeps(rec.queue, { scan: siteScan({ [`${ORIGIN}/`]: "error" }) }),
        {
          auditId: audit.id,
          pageId: page.id,
        },
      );

      expect(rec.alerts).toEqual([]);
    });

    it("never stops the audit from completing when it cannot be queued", async () => {
      const { audit } = await crawlAs("scheduled", true);

      expect((await auditRow(audit.id)).status).toBe("completed");
      expect(log.error).toHaveBeenCalled();
    });
  });

  it("discovers pages from the sitemap on the home page only", async () => {
    const { audit, page } = await startAudit();
    const rec = recordingQueue();
    const fetchText = vi.fn(async (url: URL) =>
      url.pathname === "/sitemap.xml"
        ? `<urlset><url><loc>${ORIGIN}/from-sitemap</loc></url><url><loc>https://other.example/x</loc></url></urlset>`
        : null,
    );
    const scan = siteScan({
      [`${ORIGIN}/`]: { links: [`${ORIGIN}/linked`] },
      [`${ORIGIN}/linked`]: {},
      [`${ORIGIN}/from-sitemap`]: {},
    });
    const deps = makeDeps(rec.queue, { scan, fetchText });

    await scanPage(deps, { auditId: audit.id, pageId: page.id });
    await drain(rec, deps);

    expect((await auditPageRows(audit.id)).map((r) => r.url)).toEqual([
      `${ORIGIN}/`,
      `${ORIGIN}/from-sitemap`,
      `${ORIGIN}/linked`,
    ]);
    // Asked once, for the home page, not for every page.
    expect(fetchText).toHaveBeenCalledTimes(1);
  });

  it("carries on when the sitemap cannot be read", async () => {
    const { audit, page } = await startAudit();
    const rec = recordingQueue();
    const fetchText = vi.fn(async () => {
      throw new Error("boom");
    });
    const scan = siteScan({
      [`${ORIGIN}/`]: { links: [`${ORIGIN}/a`] },
      [`${ORIGIN}/a`]: {},
    });
    const deps = makeDeps(rec.queue, { scan, fetchText });

    await scanPage(deps, { auditId: audit.id, pageId: page.id });
    await drain(rec, deps);

    expect((await auditRow(audit.id)).status).toBe("completed");
  });

  it("marks a page that robots.txt forbids as failed and still completes the audit", async () => {
    const { audit, page } = await startAudit();
    const rec = recordingQueue();
    const scan = siteScan({
      [`${ORIGIN}/`]: { links: [`${ORIGIN}/private`, `${ORIGIN}/public`] },
      [`${ORIGIN}/public`]: {},
    });
    const checkRobots = async (url: URL) =>
      url.pathname === "/private"
        ? { allowed: false as const, reason: "disallowed by robots.txt" }
        : { allowed: true as const };
    const deps = makeDeps(rec.queue, { scan, checkRobots });

    await scanPage(deps, { auditId: audit.id, pageId: page.id });
    await drain(rec, deps);

    expect(await auditPageRows(audit.id)).toEqual([
      { url: `${ORIGIN}/`, status: "done" },
      { url: `${ORIGIN}/private`, status: "failed" },
      { url: `${ORIGIN}/public`, status: "done" },
    ]);
    expect(scan).not.toHaveBeenCalledWith(new URL(`${ORIGIN}/private`));
    const row = await auditRow(audit.id);
    expect(row.status).toBe("completed");
    expect(row.pagesScanned).toBe(2);
  });

  it("does not fail the audit because one page cannot be scanned", async () => {
    const { audit, page } = await startAudit();
    const rec = recordingQueue();
    const scan = siteScan({
      [`${ORIGIN}/`]: { links: [`${ORIGIN}/broken`] },
      [`${ORIGIN}/broken`]: "error",
    });
    const deps = makeDeps(rec.queue, { scan });

    await scanPage(deps, { auditId: audit.id, pageId: page.id });
    await drain(rec, deps);

    const row = await auditRow(audit.id);
    expect(row.status).toBe("completed");
    expect(row.pagesScanned).toBe(1);
    expect(log.error).toHaveBeenCalled();
  });

  it("fails the audit when no page could be scanned", async () => {
    const { audit, page } = await startAudit();
    const rec = recordingQueue();
    const deps = makeDeps(rec.queue, {
      scan: siteScan({ [`${ORIGIN}/`]: "error" }),
    });

    const outcome = await scanPage(deps, {
      auditId: audit.id,
      pageId: page.id,
    });

    expect(outcome).toBe("failed");
    const row = await auditRow(audit.id);
    expect(row.status).toBe("failed");
    expect(row.failureReason).toBe("scan_failed");
    expect(row.score).toBeNull();
  });

  it("treats a refused address like any page that cannot be scanned", async () => {
    const { audit, page } = await startAudit();
    const rec = recordingQueue();
    const scan = vi.fn<Scan>(async (url) => {
      throw new UrlNotAllowedError(url.href, "targets a non-public address");
    });

    await scanPage(makeDeps(rec.queue, { scan }), {
      auditId: audit.id,
      pageId: page.id,
    });

    const row = await auditRow(audit.id);
    expect(row.status).toBe("failed");
    expect(row.failureReason).toBe("scan_failed");
  });

  it("marks pages whose job could not be queued as failed, and still finishes", async () => {
    const { audit, page } = await startAudit();
    const rec = recordingQueue();
    rec.state.fail = true;
    const scan = siteScan({ [`${ORIGIN}/`]: { links: [`${ORIGIN}/a`] } });

    await scanPage(makeDeps(rec.queue, { scan }), {
      auditId: audit.id,
      pageId: page.id,
    });

    expect(await auditPageRows(audit.id)).toEqual([
      { url: `${ORIGIN}/`, status: "done" },
      { url: `${ORIGIN}/a`, status: "failed" },
    ]);
    expect((await auditRow(audit.id)).status).toBe("completed");
  });

  it("stops scanning once the time budget is spent", async () => {
    const { audit, page } = await startAudit();
    const rec = recordingQueue();
    const scan = siteScan({
      [`${ORIGIN}/`]: { links: [`${ORIGIN}/a`] },
      [`${ORIGIN}/a`]: {},
    });
    const deps = makeDeps(rec.queue, { scan, maxDurationMs: 60_000 });
    await scanPage(deps, { auditId: audit.id, pageId: page.id });
    await test.db
      .update(audits)
      .set({ startedAt: new Date(Date.now() - 120_000) })
      .where(eq(audits.id, audit.id));

    await drain(rec, deps);

    expect(scan).toHaveBeenCalledTimes(1);
    expect(await auditPageRows(audit.id)).toEqual([
      { url: `${ORIGIN}/`, status: "done" },
      { url: `${ORIGIN}/a`, status: "failed" },
    ]);
    expect((await auditRow(audit.id)).status).toBe("completed");
  });

  it("finalizes exactly once when the last pages finish at the same time", async () => {
    const { audit, page } = await startAudit();
    const rec = recordingQueue();
    const scan = siteScan({
      [`${ORIGIN}/`]: { links: [`${ORIGIN}/a`, `${ORIGIN}/b`, `${ORIGIN}/c`] },
      [`${ORIGIN}/a`]: { violations: [violation("image-alt", ["img"])] },
      [`${ORIGIN}/b`]: { violations: [violation("image-alt", ["img"])] },
      [`${ORIGIN}/c`]: {},
    });
    const deps = makeDeps(rec.queue, { scan });
    await scanPage(deps, { auditId: audit.id, pageId: page.id });

    await drain(rec, deps, true);

    const row = await auditRow(audit.id);
    expect(row.status).toBe("completed");
    expect(row.pagesScanned).toBe(4);
    expect(row.score).toBe(
      computeScore([{ impact: "serious" }, { impact: "serious" }]),
    );
  });

  it("does nothing when a finished job is delivered again", async () => {
    const { audit, page } = await startAudit();
    const rec = recordingQueue();
    const scan = siteScan({
      [`${ORIGIN}/`]: { violations: [violation("image-alt", ["img"])] },
    });
    const deps = makeDeps(rec.queue, { scan });
    await scanPage(deps, { auditId: audit.id, pageId: page.id });

    const again = await scanPage(deps, { auditId: audit.id, pageId: page.id });

    expect(again).toBe("skipped");
    expect(scan).toHaveBeenCalledTimes(1);
    expect(await issueCount(audit.id)).toBe(1);
    expect((await auditRow(audit.id)).status).toBe("completed");
  });

  it.each(["completed", "failed"] as const)(
    "skips a page of an audit that is already %s",
    async (status) => {
      const { audit, page } = await startAudit();
      await test.db
        .update(audits)
        .set({ status })
        .where(eq(audits.id, audit.id));
      const scan = siteScan({ [`${ORIGIN}/`]: {} });

      const outcome = await scanPage(
        makeDeps(recordingQueue().queue, { scan }),
        {
          auditId: audit.id,
          pageId: page.id,
        },
      );

      expect(outcome).toBe("skipped");
      expect(scan).not.toHaveBeenCalled();
    },
  );

  it("skips a page that does not belong to the audit", async () => {
    const { audit } = await startAudit();
    const other = await startAudit("https://other.example");

    const outcome = await scanPage(makeDeps(recordingQueue().queue), {
      auditId: audit.id,
      pageId: other.page.id,
    });

    expect(outcome).toBe("skipped");
  });

  it("reuses the page rows of an earlier audit of the same site", async () => {
    const first = await startAudit("https://reuse.example");
    const rec = recordingQueue();
    const scan = siteScan({
      "https://reuse.example/": { links: ["https://reuse.example/a"] },
      "https://reuse.example/a": {},
    });
    const deps = makeDeps(rec.queue, { scan });
    await scanPage(deps, { auditId: first.audit.id, pageId: first.page.id });
    await drain(rec, deps);

    const [secondAudit] = await test.db
      .insert(audits)
      .values({ siteId: first.site.id, type: "manual", status: "queued" })
      .returning();
    await test.db
      .insert(auditPages)
      .values({ auditId: secondAudit!.id, pageId: first.page.id });
    await scanPage(deps, { auditId: secondAudit!.id, pageId: first.page.id });
    await drain(rec, deps);

    const siteIdPages = await test.db
      .select()
      .from(pages)
      .where(and(eq(pages.siteId, first.site.id)));
    expect(siteIdPages).toHaveLength(2);
  });
});
