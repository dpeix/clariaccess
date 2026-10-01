import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditPages,
  audits,
  issues,
  organizations,
  pages,
  sites,
} from "@accessibility/db";
import { PLAN_LIMITS } from "@accessibility/contracts";
import { SCAN_PAGE_JOB } from "@accessibility/queue";
import { adminDatabaseUrl } from "../test/integration.js";
import { createHarness, signIn, type Harness } from "../test/harness.js";

const adminUrl = adminDatabaseUrl();

type Headers = { cookie: string; origin: string };

describe.skipIf(adminUrl === undefined)("multi-page audits", () => {
  let h: Harness & { test: unknown };
  let alice: Headers;
  let bob: Headers;
  let n = 0;

  beforeAll(async () => {
    h = await createHarness(adminUrl as string, { siteDailyAuditLimit: 3 });
    alice = (await signIn(h, "alice@example.fr")).headers;
    bob = (await signIn(h, "bob@example.fr")).headers;
  });
  afterAll(async () => {
    await h.close();
  });

  const call = (method: "GET" | "POST", url: string, headers?: Headers) =>
    h.app.inject({ method, url, headers });

  // A site of Alice's, verified unless said otherwise.
  async function newSite(verified = true, plan: "free" | "pro" = "pro") {
    n += 1;
    const org = (
      await h.app.inject({
        method: "POST",
        url: "/orgs",
        headers: alice,
        payload: { name: `Org ${n}` },
      })
    ).json() as { id: string };
    const site = (
      await h.app.inject({
        method: "POST",
        url: `/orgs/${org.id}/sites`,
        headers: alice,
        payload: { baseUrl: `https://site${n}.example` },
      })
    ).json() as { id: string; baseUrl: string };
    // Pro by default: the free plan's own limits are tested apart.
    await h.db
      .update(organizations)
      .set({ plan })
      .where(eq(organizations.id, org.id));
    if (verified) {
      await h.db
        .update(sites)
        .set({ verifiedAt: new Date(), verificationMethod: "file" })
        .where(eq(sites.id, site.id));
    }
    return site;
  }
  const finish = (
    auditId: string,
    status: "completed" | "failed" = "completed",
  ) => h.db.update(audits).set({ status }).where(eq(audits.id, auditId));

  describe("POST /sites/:id/audits", () => {
    it("requires a session", async () => {
      const site = await newSite();

      expect((await call("POST", `/sites/${site.id}/audits`)).statusCode).toBe(
        401,
      );
    });

    it("refuses a site whose ownership is not proven", async () => {
      const site = await newSite(false);

      const response = await call("POST", `/sites/${site.id}/audits`, alice);

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ error: "site_not_verified" });
      expect(
        await h.db.select().from(audits).where(eq(audits.siteId, site.id)),
      ).toHaveLength(0);
    });

    it("queues an audit with its home page as the first page to scan", async () => {
      const site = await newSite();
      const before = h.queue.jobs.length;

      const response = await call("POST", `/sites/${site.id}/audits`, alice);

      expect(response.statusCode).toBe(202);
      const audit = response.json();
      expect(audit).toMatchObject({
        type: "manual",
        status: "queued",
        url: site.baseUrl,
        score: null,
      });
      const [seed] = await h.db
        .select({
          pageId: auditPages.pageId,
          status: auditPages.status,
          url: pages.url,
        })
        .from(auditPages)
        .innerJoin(pages, eq(pages.id, auditPages.pageId))
        .where(eq(auditPages.auditId, audit.id));
      expect(seed).toMatchObject({
        status: "pending",
        url: `${site.baseUrl}/`,
      });
      expect(h.queue.jobs.slice(before)).toEqual([
        {
          name: SCAN_PAGE_JOB,
          payload: { auditId: audit.id, pageId: seed!.pageId },
        },
      ]);
    });

    it("refuses a second audit while one is active", async () => {
      const site = await newSite();
      await call("POST", `/sites/${site.id}/audits`, alice);

      const second = await call("POST", `/sites/${site.id}/audits`, alice);

      expect(second.statusCode).toBe(409);
      expect(second.json()).toMatchObject({ error: "audit_in_progress" });
    });

    it("lets only one of several simultaneous requests through", async () => {
      const site = await newSite();

      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          call("POST", `/sites/${site.id}/audits`, alice),
        ),
      );

      expect(responses.map((r) => r.statusCode).sort()).toEqual([
        202, 409, 409, 409, 409,
      ]);
    });

    it("allows a new audit once the previous one is over", async () => {
      const site = await newSite();
      const first = (
        await call("POST", `/sites/${site.id}/audits`, alice)
      ).json();
      await finish(first.id);

      expect(
        (await call("POST", `/sites/${site.id}/audits`, alice)).statusCode,
      ).toBe(202);
    });

    it("abandons an audit stuck for too long so the site is not blocked forever", async () => {
      const site = await newSite();
      const stuck = (
        await call("POST", `/sites/${site.id}/audits`, alice)
      ).json();
      await h.db
        .update(audits)
        .set({ createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) })
        .where(eq(audits.id, stuck.id));

      const response = await call("POST", `/sites/${site.id}/audits`, alice);

      expect(response.statusCode).toBe(202);
      const [old] = await h.db
        .select()
        .from(audits)
        .where(eq(audits.id, stuck.id));
      expect(old).toMatchObject({
        status: "failed",
        failureReason: "scan_failed",
      });
    });

    it("caps the audits per site per day", async () => {
      const site = await newSite();
      for (let i = 0; i < 3; i += 1) {
        const started = await call("POST", `/sites/${site.id}/audits`, alice);
        expect(started.statusCode).toBe(202);
        await finish(started.json().id);
      }

      const fourth = await call("POST", `/sites/${site.id}/audits`, alice);

      expect(fourth.statusCode).toBe(429);
      expect(fourth.json()).toMatchObject({ error: "rate_limited" });
    });

    it("caps a free site at what its plan allows, below the technical cap", async () => {
      const site = await newSite(true, "free");
      const quota = PLAN_LIMITS.free.manualAuditsPerDayPerSite;
      expect(quota).toBeLessThan(3);
      for (let i = 0; i < quota; i += 1) {
        const started = await call("POST", `/sites/${site.id}/audits`, alice);
        expect(started.statusCode).toBe(202);
        await finish(started.json().id);
      }

      const over = await call("POST", `/sites/${site.id}/audits`, alice);

      expect(over.statusCode).toBe(429);
    });

    it("does not count scheduled re-scans against the manual quota", async () => {
      const site = await newSite(true, "free");
      for (let i = 0; i < 5; i += 1) {
        await h.db.insert(audits).values({
          siteId: site.id,
          type: "scheduled",
          status: "completed",
        });
      }

      expect(
        (await call("POST", `/sites/${site.id}/audits`, alice)).statusCode,
      ).toBe(202);
    });

    it("leaves no orphan audit when the queue is down, and can be retried", async () => {
      const site = await newSite();
      h.queue.failEnqueue = true;
      try {
        const response = await call("POST", `/sites/${site.id}/audits`, alice);
        expect(response.statusCode).toBe(503);
      } finally {
        h.queue.failEnqueue = false;
      }
      expect(
        await h.db.select().from(audits).where(eq(audits.siteId, site.id)),
      ).toHaveLength(0);
      expect(
        (await call("POST", `/sites/${site.id}/audits`, alice)).statusCode,
      ).toBe(202);
    });

    it("hides the site from another user", async () => {
      const site = await newSite();
      const before = h.queue.jobs.length;

      const response = await call("POST", `/sites/${site.id}/audits`, bob);

      expect(response.statusCode).toBe(404);
      expect(h.queue.jobs.length).toBe(before);
    });
  });

  describe("GET /sites/:id/audits", () => {
    it("lists the site's audits, newest first, and nothing else", async () => {
      const site = await newSite();
      const other = await newSite();
      const first = (
        await call("POST", `/sites/${site.id}/audits`, alice)
      ).json();
      await finish(first.id);
      const second = (
        await call("POST", `/sites/${site.id}/audits`, alice)
      ).json();
      await call("POST", `/sites/${other.id}/audits`, alice);

      const response = await call("GET", `/sites/${site.id}/audits`, alice);

      expect(response.statusCode).toBe(200);
      expect(response.json().map((a: { id: string }) => a.id)).toEqual([
        second.id,
        first.id,
      ]);
    });

    it("requires a session and membership", async () => {
      const site = await newSite();

      expect((await call("GET", `/sites/${site.id}/audits`)).statusCode).toBe(
        401,
      );
      expect(
        (await call("GET", `/sites/${site.id}/audits`, bob)).statusCode,
      ).toBe(404);
    });
  });

  describe("reading an organization audit", () => {
    async function auditWithIssue() {
      const site = await newSite();
      const audit = (
        await call("POST", `/sites/${site.id}/audits`, alice)
      ).json();
      const [page] = await h.db
        .select()
        .from(pages)
        .where(eq(pages.siteId, site.id));
      await h.db.insert(issues).values({
        auditId: audit.id,
        pageId: page!.id,
        ruleId: "image-alt",
        impact: "serious",
        selector: "img",
        htmlExcerpt: "<img>",
        message: "m",
        fingerprint: "f",
        raw: {},
      });
      await h.db
        .update(audits)
        .set({ status: "completed", score: 80, pagesScanned: 1 })
        .where(eq(audits.id, audit.id));
      return audit as { id: string };
    }

    it("is possible for a member", async () => {
      const audit = await auditWithIssue();

      const status = await call("GET", `/audits/${audit.id}`, alice);
      const report = await call("GET", `/audits/${audit.id}/report`, alice);
      const pageList = await call("GET", `/audits/${audit.id}/pages`, alice);

      expect(status.statusCode).toBe(200);
      expect(report.statusCode).toBe(200);
      expect(report.json().groups[0]).toMatchObject({ ruleId: "image-alt" });
      expect(pageList.json()).toEqual([
        { url: expect.stringMatching(/\/$/), status: "pending" },
      ]);
    });

    it("is hidden from anonymous visitors and other accounts, as if it did not exist", async () => {
      const audit = await auditWithIssue();

      const results = await Promise.all([
        call("GET", `/audits/${audit.id}`),
        call("GET", `/audits/${audit.id}`, bob),
        call("GET", `/audits/${audit.id}/report`),
        call("GET", `/audits/${audit.id}/report`, bob),
        // Authenticated-only: without a session it is 401 for any id, with
        // another account it is the same 404 as an unknown id.
        call("GET", `/audits/${audit.id}/pages`, bob),
      ]);

      expect(results.map((r) => r.statusCode)).toEqual([
        404, 404, 404, 404, 404,
      ]);
      expect((await call("GET", `/audits/${audit.id}/pages`)).statusCode).toBe(
        401,
      );
    });

    it("is hidden when the request comes from another origin, even with the session", async () => {
      const audit = await auditWithIssue();

      const response = await h.app.inject({
        method: "GET",
        url: `/audits/${audit.id}`,
        headers: { cookie: alice.cookie, origin: "https://www.example.fr" },
      });

      expect(response.statusCode).toBe(404);
    });

    it("keeps free audits readable by their link, and out of the pages endpoint", async () => {
      const created = await h.app.inject({
        method: "POST",
        url: "/audits/free",
        payload: { url: "https://public.example/page" },
      });
      const id = created.json().id as string;

      expect((await call("GET", `/audits/${id}`)).statusCode).toBe(200);
      expect((await call("GET", `/audits/${id}/pages`, alice)).statusCode).toBe(
        404,
      );
    });
  });
});
