import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditReportSchema,
  auditSchema,
  errorSchema,
} from "@accessibility/contracts";
import { audits, issues, pages, sites } from "@accessibility/db";
import { RUN_AUDIT_JOB } from "@accessibility/queue";
import { AUTOMATED_COVERAGE_NOTICE } from "../report/build-report.js";
import { adminDatabaseUrl } from "../test/integration.js";
import { createHarness, type Harness } from "../test/harness.js";

const adminUrl = adminDatabaseUrl();

const startAudit = (h: Harness, url: unknown, remoteAddress = "10.0.0.1") =>
  h.app.inject({
    method: "POST",
    url: "/audits/free",
    payload: { url },
    remoteAddress,
  });

describe.skipIf(adminUrl === undefined)("audit routes", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness(adminUrl as string);
  });
  afterAll(async () => {
    await h.close();
  });

  describe("POST /audits/free", () => {
    it("queues an audit and enqueues the job", async () => {
      const response = await startAudit(h, "https://Shop.Example.fr/page#top");

      expect(response.statusCode).toBe(202);
      const audit = auditSchema.parse(response.json());
      expect(audit).toMatchObject({
        type: "free",
        status: "queued",
        url: "https://shop.example.fr/page",
        score: null,
        failureReason: null,
      });
      const [row] = await h.db
        .select()
        .from(audits)
        .where(eq(audits.id, audit.id));
      expect(row?.status).toBe("queued");
      expect(h.queue.jobs).toContainEqual({
        name: RUN_AUDIT_JOB,
        payload: { auditId: audit.id },
      });
    });

    it.each([
      ["not a url"],
      ["ftp://example.fr/"],
      ["javascript:alert(1)"],
      ["https://user:secret@example.fr/"],
      [""],
      [42],
    ])("rejects %j with a 400 in the error format", async (url) => {
      const before = h.queue.jobs.length;
      const response = await startAudit(h, url);
      expect(response.statusCode).toBe(400);
      expect(errorSchema.parse(response.json()).error).toBe("invalid_request");
      expect(h.queue.jobs).toHaveLength(before);
    });

    it("rejects a missing or malformed body", async () => {
      const missing = await h.app.inject({
        method: "POST",
        url: "/audits/free",
      });
      expect(missing.statusCode).toBe(400);
      const malformed = await h.app.inject({
        method: "POST",
        url: "/audits/free",
        headers: { "content-type": "application/json" },
        payload: "{nope",
      });
      expect(malformed.statusCode).toBe(400);
      expect(errorSchema.safeParse(malformed.json()).success).toBe(true);
    });

    it("reuses the anonymous site of a URL audited again", async () => {
      await startAudit(h, "https://reuse.example.fr/");
      await startAudit(h, "https://reuse.example.fr/");
      const rows = await h.db
        .select()
        .from(sites)
        .where(eq(sites.baseUrl, "https://reuse.example.fr/"));
      expect(rows).toHaveLength(1);
    });

    it("removes the audit and answers 503 when the job cannot be queued", async () => {
      h.queue.failEnqueue = true;
      try {
        const response = await startAudit(h, "https://outage.example.fr/");
        expect(response.statusCode).toBe(503);
        expect(errorSchema.parse(response.json()).error).toBe(
          "queue_unavailable",
        );
      } finally {
        h.queue.failEnqueue = false;
      }
      const stuck = await h.db
        .select({ id: audits.id })
        .from(audits)
        .innerJoin(sites, eq(sites.id, audits.siteId))
        .where(eq(sites.baseUrl, "https://outage.example.fr/"));
      expect(stuck).toEqual([]);
    });
  });

  describe("GET /audits/:id", () => {
    it("returns the audit, marked as not to be indexed or cached", async () => {
      const created = auditSchema.parse(
        (await startAudit(h, "https://get.example.fr/")).json(),
      );
      const response = await h.app.inject({
        method: "GET",
        url: `/audits/${created.id}`,
      });
      expect(response.statusCode).toBe(200);
      expect(auditSchema.parse(response.json()).id).toBe(created.id);
      expect(response.headers["x-robots-tag"]).toContain("noindex");
      expect(response.headers["cache-control"]).toBe("no-store");
    });

    it("answers 404 for an unknown id and for something that is not an id", async () => {
      for (const id of ["6f1c1c1e-8d5e-4a37-9d57-3c1a4f0f2a10", "nope"]) {
        const response = await h.app.inject({
          method: "GET",
          url: `/audits/${id}`,
        });
        expect(response.statusCode).toBe(404);
        expect(errorSchema.parse(response.json()).error).toBe("not_found");
      }
    });
  });

  describe("GET /audits/:id/report", () => {
    const report = (id: string) =>
      h.app.inject({ method: "GET", url: `/audits/${id}/report` });

    async function newAudit(url: string) {
      return auditSchema.parse((await startAudit(h, url)).json());
    }

    it("answers 409 while the audit is not completed", async () => {
      const audit = await newAudit("https://pending.example.fr/");
      const response = await report(audit.id);
      expect(response.statusCode).toBe(409);
      expect(errorSchema.parse(response.json()).error).toBe(
        "audit_not_completed",
      );
    });

    it("answers 409 with the reason when the audit failed", async () => {
      const audit = await newAudit("https://failed.example.fr/");
      await h.db
        .update(audits)
        .set({ status: "failed", failureReason: "robots_disallowed" })
        .where(eq(audits.id, audit.id));
      const response = await report(audit.id);
      expect(response.statusCode).toBe(409);
      const body = errorSchema.parse(response.json());
      expect(body.error).toBe("audit_failed");
      expect(body.message).toMatch(/robots\.txt/);
    });

    it("answers 404 for an unknown audit", async () => {
      const response = await report("6f1c1c1e-8d5e-4a37-9d57-3c1a4f0f2a10");
      expect(response.statusCode).toBe(404);
    });

    it("returns the grouped report of a completed audit", async () => {
      const audit = await newAudit("https://done.example.fr/");
      const [site] = await h.db
        .select()
        .from(sites)
        .where(eq(sites.baseUrl, "https://done.example.fr/"));
      const [page] = await h.db
        .insert(pages)
        .values({ siteId: site!.id, url: "https://done.example.fr/" })
        .returning();
      const issue = (
        ruleId: string,
        impact: "serious" | "critical",
        n: number,
      ) => ({
        auditId: audit.id,
        pageId: page!.id,
        ruleId,
        impact,
        selector: `.el-${n}`,
        htmlExcerpt: "<x>",
        message: "m",
        fingerprint: `fp-${ruleId}-${n}`,
        raw: {
          help: `help ${ruleId}`,
          helpUrl: `https://example.test/${ruleId}`,
        },
      });
      await h.db
        .insert(issues)
        .values([
          issue("button-name", "serious", 1),
          issue("image-alt", "critical", 1),
          issue("image-alt", "critical", 2),
        ]);
      await h.db
        .update(audits)
        .set({ status: "completed", score: 71, pagesScanned: 1 })
        .where(eq(audits.id, audit.id));

      const response = await report(audit.id);

      expect(response.statusCode).toBe(200);
      const body = auditReportSchema.parse(response.json());
      expect(body.audit.score).toBe(71);
      expect(body.totalIssues).toBe(3);
      expect(body.automatedCoverageNotice).toBe(AUTOMATED_COVERAGE_NOTICE);
      expect(body.groups.map((g) => [g.ruleId, g.occurrences])).toEqual([
        ["image-alt", 2],
        ["button-name", 1],
      ]);
      expect(body.groups[0]).toMatchObject({
        title: "help image-alt",
        helpUrl: "https://example.test/image-alt",
        wcagCriteria: ["1.1.1"],
      });
      expect(response.headers["x-robots-tag"]).toContain("noindex");
    });
  });
});

describe.skipIf(adminUrl === undefined)("rate limits", () => {
  it("limits free audits per IP and answers 429 in the error format", async () => {
    const h = await createHarness(adminUrl as string, {
      ipRateLimit: { max: 2, windowSeconds: 3600 },
    });
    try {
      expect(
        (await startAudit(h, "https://a.example.fr/", "10.1.1.1")).statusCode,
      ).toBe(202);
      expect(
        (await startAudit(h, "https://b.example.fr/", "10.1.1.1")).statusCode,
      ).toBe(202);
      const limited = await startAudit(h, "https://c.example.fr/", "10.1.1.1");
      expect(limited.statusCode).toBe(429);
      expect(errorSchema.parse(limited.json()).error).toBe("rate_limited");
      // Another visitor is not affected.
      expect(
        (await startAudit(h, "https://c.example.fr/", "10.2.2.2")).statusCode,
      ).toBe(202);
    } finally {
      await h.close();
    }
  });

  it("caps the audits of one domain per day, whoever asks", async () => {
    const h = await createHarness(adminUrl as string, {
      domainDailyAuditLimit: 2,
    });
    try {
      expect(
        (await startAudit(h, "https://cap.example.fr/a", "10.1.1.1"))
          .statusCode,
      ).toBe(202);
      expect(
        (await startAudit(h, "https://cap.example.fr/b", "10.2.2.2"))
          .statusCode,
      ).toBe(202);
      const before = h.queue.jobs.length;
      const limited = await startAudit(
        h,
        "https://CAP.example.fr/c",
        "10.3.3.3",
      );
      expect(limited.statusCode).toBe(429);
      expect(errorSchema.parse(limited.json()).error).toBe("rate_limited");
      expect(h.queue.jobs).toHaveLength(before);
      // Same name on another host is a different domain.
      expect(
        (await startAudit(h, "https://other.example.fr/", "10.3.3.3"))
          .statusCode,
      ).toBe(202);
    } finally {
      await h.close();
    }
  });

  it("does not trust X-Forwarded-For unless TRUST_PROXY is set", async () => {
    const h = await createHarness(adminUrl as string, {
      ipRateLimit: { max: 1, windowSeconds: 3600 },
    });
    try {
      const send = (forwarded: string, url: string) =>
        h.app.inject({
          method: "POST",
          url: "/audits/free",
          payload: { url },
          remoteAddress: "10.9.9.9",
          headers: { "x-forwarded-for": forwarded },
        });
      expect((await send("1.1.1.1", "https://x1.example.fr/")).statusCode).toBe(
        202,
      );
      expect((await send("2.2.2.2", "https://x2.example.fr/")).statusCode).toBe(
        429,
      );
    } finally {
      await h.close();
    }
  });
});
