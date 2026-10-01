import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Result } from "axe-core";
import {
  auditPages,
  audits,
  findings,
  pages,
  remediationTasks,
  runMigrations,
  seedRules,
  sites,
} from "@accessibility/db";
import {
  createTestDatabase,
  type TestDatabase,
} from "@accessibility/db/test-helpers";
import { priorityScore } from "@accessibility/rules";
import type { JobQueue } from "@accessibility/queue";
import type { Scan } from "../audit/scanner.js";
import { adminDatabaseUrl } from "../test/integration.js";
import { scanPage, type ScanPageDeps } from "./scan-page.js";

const adminUrl = adminDatabaseUrl();

function violation(
  id: string,
  target: string,
  impact: "minor" | "serious" = "serious",
  help = `help ${id}`,
): Result {
  return {
    id,
    impact,
    tags: [],
    description: id,
    help,
    helpUrl: `https://example.test/${id}`,
    nodes: [{ html: `<x>`, target: [target], failureSummary: help }],
  } as unknown as Result;
}

type SiteState = Record<
  string,
  { links?: string[]; violations?: Result[] } | "error"
>;

describe.skipIf(adminUrl === undefined)("findings follow audits", () => {
  let test: TestDatabase;
  let counter = 0;

  beforeAll(async () => {
    test = await createTestDatabase(adminUrl as string);
    await runMigrations(test.db);
    await seedRules(test.db);
  });
  afterAll(async () => {
    await test.close();
  });

  // A site that can be audited several times, its pages changing in between.
  async function newSite() {
    counter += 1;
    const origin = `https://s${counter}.example`;
    const [site] = await test.db
      .insert(sites)
      .values({
        baseUrl: origin,
        verificationToken: "t",
        verifiedAt: new Date(),
      })
      .returning();
    const jobs: { auditId: string; pageId: string }[] = [];
    const queue: JobQueue = {
      start: async () => undefined,
      enqueue: async (_name, payload) => {
        jobs.push(payload as { auditId: string; pageId: string });
        return "id";
      },
      work: async () => undefined,
      stop: async () => undefined,
    };

    async function audit(
      state: SiteState,
      options: { maxPages?: number; forbid?: string[] } = {},
    ) {
      const [row] = await test.db
        .insert(audits)
        .values({ siteId: site!.id, type: "manual", status: "queued" })
        .returning();
      const [home] = await test.db
        .insert(pages)
        .values({ siteId: site!.id, url: `${origin}/` })
        .onConflictDoUpdate({
          target: [pages.siteId, pages.url],
          set: { lastSeenAt: new Date() },
        })
        .returning();
      await test.db
        .insert(auditPages)
        .values({ auditId: row!.id, pageId: home!.id });
      const scan = vi.fn<Scan>(async (url) => {
        const entry = state[url.href];
        if (entry === undefined || entry === "error") throw new Error("boom");
        return {
          violations: entry.violations ?? [],
          axeVersion: "4.13.0",
          finalUrl: url.href,
          blockedRequests: [],
          links: entry.links ?? [],
        };
      });
      const deps: ScanPageDeps = {
        db: test.db,
        queue,
        scan,
        checkRobots: async (url) =>
          options.forbid?.includes(url.pathname)
            ? { allowed: false, reason: "robots" }
            : { allowed: true },
        fetchText: async () => null,
        maxIssues: 100,
        maxPages: options.maxPages ?? 25,
        maxDurationMs: 600_000,
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      };
      jobs.push({ auditId: row!.id, pageId: home!.id });
      while (jobs.length > 0) await scanPage(deps, jobs.shift()!);
      return row!.id;
    }

    const found = async () =>
      test.db
        .select({
          url: pages.url,
          ruleId: findings.ruleId,
          status: findings.status,
          priorityScore: findings.priorityScore,
          message: findings.message,
          first: findings.firstSeenAuditId,
          last: findings.lastSeenAuditId,
          regressedIn: findings.regressedAuditId,
          selector: findings.selector,
        })
        .from(findings)
        .innerJoin(pages, eq(pages.id, findings.pageId))
        .where(eq(findings.siteId, site!.id))
        .orderBy(pages.url, findings.ruleId, findings.selector);

    const tasks = async () =>
      test.db
        .select({
          ruleId: remediationTasks.ruleId,
          status: remediationTasks.status,
          priorityScore: remediationTasks.priorityScore,
        })
        .from(remediationTasks)
        .where(eq(remediationTasks.siteId, site!.id))
        .orderBy(remediationTasks.ruleId);

    return { origin, site: site!, audit, found, tasks };
  }

  it("opens a finding for every problem of the first audit", async () => {
    const s = await newSite();

    const first = await s.audit({
      [`${s.origin}/`]: {
        violations: [
          violation("image-alt", "img.hero"),
          violation("button-name", "button"),
        ],
      },
    });

    expect(await s.found()).toEqual([
      expect.objectContaining({
        ruleId: "button-name",
        status: "open",
        first,
        last: first,
      }),
      expect.objectContaining({
        ruleId: "image-alt",
        status: "open",
        first,
        last: first,
      }),
    ]);
  });

  it("ranks a problem found on several pages higher: fixing it once fixes many", async () => {
    const s = await newSite();
    const shared = violation("image-alt", "header img");

    await s.audit({
      [`${s.origin}/`]: { links: [`${s.origin}/a`], violations: [shared] },
      [`${s.origin}/a`]: {
        violations: [shared, violation("button-name", "button")],
      },
    });

    const rows = await s.found();
    const priorities = Object.fromEntries(
      rows.map((r) => [`${r.url}|${r.ruleId}`, r.priorityScore]),
    );
    expect(priorities[`${s.origin}/|image-alt`]).toBe(
      priorityScore("serious", 2),
    );
    expect(priorities[`${s.origin}/a|image-alt`]).toBe(
      priorityScore("serious", 2),
    );
    expect(priorities[`${s.origin}/a|button-name`]).toBe(
      priorityScore("serious", 1),
    );
  });

  it("marks a problem fixed when a later audit no longer sees it", async () => {
    const s = await newSite();
    await s.audit({
      [`${s.origin}/`]: { violations: [violation("image-alt", "img")] },
    });

    await s.audit({ [`${s.origin}/`]: {} });

    expect((await s.found()).map((r) => r.status)).toEqual(["fixed"]);
  });

  it("keeps a problem open while it persists, refreshing what was last seen", async () => {
    const s = await newSite();
    const first = await s.audit({
      [`${s.origin}/`]: {
        violations: [violation("image-alt", "img", "serious", "Old message")],
      },
    });

    const second = await s.audit({
      [`${s.origin}/`]: {
        violations: [violation("image-alt", "img", "serious", "New message")],
      },
    });

    const [row] = await s.found();
    expect(row).toMatchObject({ status: "open", first, last: second });
    expect(row?.message).toMatch(/New message/);
  });

  it("flags a regression when a fixed problem comes back, and remembers when it was first seen", async () => {
    const s = await newSite();
    const first = await s.audit({
      [`${s.origin}/`]: { violations: [violation("image-alt", "img")] },
    });
    await s.audit({ [`${s.origin}/`]: {} });

    const third = await s.audit({
      [`${s.origin}/`]: { violations: [violation("image-alt", "img")] },
    });

    expect(await s.found()).toEqual([
      expect.objectContaining({
        status: "regressed",
        first,
        last: third,
        regressedIn: third,
      }),
    ]);
  });

  it("remembers the audit that caused the regression, not the later ones that still see it", async () => {
    const s = await newSite();
    await s.audit({
      [`${s.origin}/`]: { violations: [violation("image-alt", "img")] },
    });
    await s.audit({ [`${s.origin}/`]: {} });
    const third = await s.audit({
      [`${s.origin}/`]: { violations: [violation("image-alt", "img")] },
    });

    const fourth = await s.audit({
      [`${s.origin}/`]: { violations: [violation("image-alt", "img")] },
    });

    const [row] = await s.found();
    expect(row).toMatchObject({
      status: "regressed",
      last: fourth,
      regressedIn: third,
    });
  });

  it("has no regression date for a problem that never regressed", async () => {
    const s = await newSite();
    await s.audit({
      [`${s.origin}/`]: { violations: [violation("image-alt", "img")] },
    });
    await s.audit({
      [`${s.origin}/`]: { violations: [violation("image-alt", "img")] },
    });

    expect((await s.found())[0]?.regressedIn).toBeNull();
  });

  it("leaves an ignored problem ignored, seen or not", async () => {
    const s = await newSite();
    await s.audit({
      [`${s.origin}/`]: { violations: [violation("image-alt", "img")] },
    });
    await test.db
      .update(findings)
      .set({ status: "ignored" })
      .where(eq(findings.siteId, s.site.id));

    await s.audit({
      [`${s.origin}/`]: { violations: [violation("image-alt", "img")] },
    });
    expect((await s.found()).map((r) => r.status)).toEqual(["ignored"]);
    await s.audit({ [`${s.origin}/`]: {} });
    expect((await s.found()).map((r) => r.status)).toEqual(["ignored"]);
  });

  it("does not call a problem fixed on a page the audit did not scan", async () => {
    const s = await newSite();
    const state: SiteState = {
      [`${s.origin}/`]: { links: [`${s.origin}/a`] },
      [`${s.origin}/a`]: { violations: [violation("image-alt", "img")] },
    };
    await s.audit(state);

    // The cap stops the second audit at the home page.
    await s.audit(state, { maxPages: 1 });

    expect((await s.found()).map((r) => r.status)).toEqual(["open"]);
  });

  it("does not call a problem fixed on a page that failed to scan", async () => {
    const s = await newSite();
    const state: SiteState = {
      [`${s.origin}/`]: { links: [`${s.origin}/a`] },
      [`${s.origin}/a`]: { violations: [violation("image-alt", "img")] },
    };
    await s.audit(state);

    await s.audit(state, { forbid: ["/a"] });

    expect((await s.found()).map((r) => r.status)).toEqual(["open"]);
  });

  it("changes nothing when the audit fails altogether", async () => {
    const s = await newSite();
    await s.audit({
      [`${s.origin}/`]: { violations: [violation("image-alt", "img")] },
    });

    await s.audit({ [`${s.origin}/`]: "error" });

    expect((await s.found()).map((r) => r.status)).toEqual(["open"]);
  });

  it("keeps the findings of each site apart", async () => {
    const a = await newSite();
    const b = await newSite();
    await a.audit({
      [`${a.origin}/`]: { violations: [violation("image-alt", "img")] },
    });

    await b.audit({ [`${b.origin}/`]: {} });

    expect((await a.found()).map((r) => r.status)).toEqual(["open"]);
    expect(await b.found()).toEqual([]);
  });

  it("stores each finding once per page even when the audit repeats a node", async () => {
    const s = await newSite();
    const twice = violation("image-alt", "img");

    await s.audit({ [`${s.origin}/`]: { violations: [twice, twice] } });

    expect(await s.found()).toHaveLength(1);
    expect(
      await test.db
        .select()
        .from(findings)
        .where(and(eq(findings.siteId, s.site.id))),
    ).toHaveLength(1);
  });

  describe("remediation tasks follow the findings", () => {
    it("creates one task per rule, ranked by the findings' total priority", async () => {
      const s = await newSite();

      await s.audit({
        [`${s.origin}/`]: {
          links: [`${s.origin}/a`],
          violations: [
            violation("image-alt", "img.a"),
            violation("image-alt", "img.b"),
            violation("button-name", "button"),
          ],
        },
        [`${s.origin}/a`]: { violations: [violation("image-alt", "img.a")] },
      });

      const tasks = await s.tasks();
      expect(tasks.map((t) => [t.ruleId, t.status])).toEqual([
        ["button-name", "todo"],
        ["image-alt", "todo"],
      ]);
      const byRule = Object.fromEntries(
        tasks.map((t) => [t.ruleId, t.priorityScore]),
      );
      // image-alt: img.a on two pages (2 pages x 6 each), img.b on one (6).
      expect(byRule["image-alt"]).toBeGreaterThan(byRule["button-name"]!);
    });

    it("counts only open and regressed findings in the priority", async () => {
      const s = await newSite();
      await s.audit({
        [`${s.origin}/`]: {
          violations: [
            violation("image-alt", "img.a"),
            violation("image-alt", "img.b"),
          ],
        },
      });
      const [first] = await s.found();
      await test.db
        .update(findings)
        .set({ status: "ignored" })
        .where(eq(findings.siteId, s.site.id));
      await test.db
        .update(findings)
        .set({ status: "open" })
        .where(
          and(
            eq(findings.siteId, s.site.id),
            eq(findings.selector, first!.selector),
          ),
        );

      await s.audit({
        [`${s.origin}/`]: {
          violations: [
            violation("image-alt", "img.a"),
            violation("image-alt", "img.b"),
          ],
        },
      });

      const [task] = await s.tasks();
      expect(task?.priorityScore).toBe(6);
    });

    it("marks a task done when its problems are fixed, and reopens it on regression", async () => {
      const s = await newSite();
      await s.audit({
        [`${s.origin}/`]: { violations: [violation("image-alt", "img")] },
      });

      await s.audit({ [`${s.origin}/`]: {} });
      expect(await s.tasks()).toEqual([
        { ruleId: "image-alt", status: "done", priorityScore: 0 },
      ]);

      await s.audit({
        [`${s.origin}/`]: { violations: [violation("image-alt", "img")] },
      });
      expect(await s.tasks()).toEqual([
        { ruleId: "image-alt", status: "todo", priorityScore: 6 },
      ]);
    });

    it("keeps the status a person gave while the problem is still there", async () => {
      const s = await newSite();
      await s.audit({
        [`${s.origin}/`]: { violations: [violation("image-alt", "img")] },
      });
      await test.db
        .update(remediationTasks)
        .set({ status: "doing" })
        .where(eq(remediationTasks.siteId, s.site.id));

      await s.audit({
        [`${s.origin}/`]: { violations: [violation("image-alt", "img")] },
      });

      expect((await s.tasks())[0]?.status).toBe("doing");
    });

    it("marks a task done when every remaining finding of the rule is ignored", async () => {
      const s = await newSite();
      await s.audit({
        [`${s.origin}/`]: { violations: [violation("image-alt", "img")] },
      });
      await test.db
        .update(findings)
        .set({ status: "ignored" })
        .where(eq(findings.siteId, s.site.id));

      await s.audit({
        [`${s.origin}/`]: { violations: [violation("image-alt", "img")] },
      });

      expect((await s.tasks())[0]).toMatchObject({
        status: "done",
        priorityScore: 0,
      });
    });

    it("leaves a task alone when its page was not scanned", async () => {
      const s = await newSite();
      const state: SiteState = {
        [`${s.origin}/`]: { links: [`${s.origin}/a`] },
        [`${s.origin}/a`]: { violations: [violation("image-alt", "img")] },
      };
      await s.audit(state);

      await s.audit(state, { maxPages: 1 });

      expect((await s.tasks())[0]?.status).toBe("todo");
    });

    it("keeps the tasks of each site apart", async () => {
      const a = await newSite();
      const b = await newSite();
      await a.audit({
        [`${a.origin}/`]: { violations: [violation("image-alt", "img")] },
      });

      await b.audit({ [`${b.origin}/`]: {} });

      expect(await a.tasks()).toHaveLength(1);
      expect(await b.tasks()).toEqual([]);
    });
  });
});
