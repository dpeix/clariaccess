import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { audits, findings, pages, sites } from "@accessibility/db";
import { adminDatabaseUrl } from "../test/integration.js";
import { createHarness, signIn, type Harness } from "../test/harness.js";

const adminUrl = adminDatabaseUrl();

type Headers = { cookie: string; origin: string };
type Status = "open" | "fixed" | "ignored" | "regressed";

describe.skipIf(adminUrl === undefined)("findings", () => {
  let h: Harness & { test: unknown };
  let alice: Headers;
  let bob: Headers;
  let n = 0;

  beforeAll(async () => {
    h = await createHarness(adminUrl as string);
    alice = (await signIn(h, "alice@example.fr")).headers;
    bob = (await signIn(h, "bob@example.fr")).headers;
  });
  afterAll(async () => {
    await h.close();
  });

  const call = (
    method: "GET" | "PATCH",
    url: string,
    headers?: Headers,
    payload?: object,
  ) => h.app.inject({ method, url, headers, payload });

  async function newSite() {
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
    const [audit] = await h.db
      .insert(audits)
      .values({ siteId: site.id, type: "manual", status: "completed" })
      .returning();
    const [page] = await h.db
      .insert(pages)
      .values({ siteId: site.id, url: `${site.baseUrl}/` })
      .returning();
    let k = 0;
    const addFinding = async (
      status: Status = "open",
      priorityScore = 6,
      impact: "minor" | "serious" | "critical" = "serious",
    ) => {
      k += 1;
      const [row] = await h.db
        .insert(findings)
        .values({
          siteId: site.id,
          pageId: page!.id,
          ruleId: "image-alt",
          fingerprint: `fp-${k}`,
          impact,
          status,
          selector: `img.n${k}`,
          htmlExcerpt: "<img>",
          message: "Images must have alternate text",
          firstSeenAuditId: audit!.id,
          lastSeenAuditId: audit!.id,
          priorityScore,
        })
        .returning();
      return row!;
    };
    return { site, page: page!, audit: audit!, addFinding };
  }

  describe("GET /sites/:id/findings", () => {
    it("requires a session and membership", async () => {
      const { site } = await newSite();

      expect((await call("GET", `/sites/${site.id}/findings`)).statusCode).toBe(
        401,
      );
      expect(
        (await call("GET", `/sites/${site.id}/findings`, bob)).statusCode,
      ).toBe(404);
    });

    it("lists findings with their page, most urgent first, and the total", async () => {
      const { site, audit, addFinding } = await newSite();
      const low = await addFinding("open", 1, "minor");
      const high = await addFinding("regressed", 20, "critical");
      const mid = await addFinding("open", 6);

      const response = await call("GET", `/sites/${site.id}/findings`, alice);

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.total).toBe(3);
      expect(body.items.map((f: { id: string }) => f.id)).toEqual([
        high.id,
        mid.id,
        low.id,
      ]);
      expect(body.items[0]).toEqual({
        id: high.id,
        siteId: site.id,
        pageUrl: `${site.baseUrl}/`,
        ruleId: "image-alt",
        impact: "critical",
        status: "regressed",
        selector: high.selector,
        htmlExcerpt: "<img>",
        message: "Images must have alternate text",
        firstSeenAuditId: audit.id,
        lastSeenAuditId: audit.id,
        priorityScore: 20,
        updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      });
    });

    it("filters by status", async () => {
      const { site, addFinding } = await newSite();
      await addFinding("open");
      const fixed = await addFinding("fixed");

      const response = await call(
        "GET",
        `/sites/${site.id}/findings?status=fixed`,
        alice,
      );

      expect(response.json().items.map((f: { id: string }) => f.id)).toEqual([
        fixed.id,
      ]);
      expect(response.json().total).toBe(1);
    });

    it("pages through the results", async () => {
      const { site, addFinding } = await newSite();
      for (let i = 0; i < 5; i += 1) await addFinding("open", 10 - i);

      const first = (
        await call("GET", `/sites/${site.id}/findings?limit=2`, alice)
      ).json();
      const last = (
        await call("GET", `/sites/${site.id}/findings?limit=2&offset=4`, alice)
      ).json();

      expect(first.items).toHaveLength(2);
      expect(first.total).toBe(5);
      expect(last.items).toHaveLength(1);
      const all = (
        await call("GET", `/sites/${site.id}/findings`, alice)
      ).json();
      expect(all.items).toHaveLength(5);
    });

    it.each(["status=gone", "limit=0", "limit=101", "limit=abc", "offset=-1"])(
      "rejects the query %s",
      async (query) => {
        const { site } = await newSite();

        const response = await call(
          "GET",
          `/sites/${site.id}/findings?${query}`,
          alice,
        );

        expect(response.statusCode).toBe(400);
      },
    );

    it("does not mix the findings of two sites", async () => {
      const a = await newSite();
      const b = await newSite();
      await a.addFinding();

      expect(
        (await call("GET", `/sites/${b.site.id}/findings`, alice)).json().items,
      ).toEqual([]);
    });
  });

  describe("PATCH /findings/:id", () => {
    const statusOf = async (id: string) =>
      (await h.db.select().from(findings).where(eq(findings.id, id)))[0]!
        .status;

    it("ignores an open or regressed finding", async () => {
      const { addFinding } = await newSite();
      for (const start of ["open", "regressed"] as const) {
        const finding = await addFinding(start);

        const response = await call("PATCH", `/findings/${finding.id}`, alice, {
          status: "ignored",
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
          id: finding.id,
          status: "ignored",
        });
        expect(await statusOf(finding.id)).toBe("ignored");
      }
    });

    it("reopens an ignored finding", async () => {
      const { addFinding } = await newSite();
      const finding = await addFinding("ignored");

      const response = await call("PATCH", `/findings/${finding.id}`, alice, {
        status: "open",
      });

      expect(response.statusCode).toBe(200);
      expect(await statusOf(finding.id)).toBe("open");
    });

    it("leaves a fixed finding alone: audits decide that", async () => {
      const { addFinding } = await newSite();
      const finding = await addFinding("fixed");

      for (const status of ["ignored", "open"]) {
        const response = await call("PATCH", `/findings/${finding.id}`, alice, {
          status,
        });
        expect(response.statusCode).toBe(409);
      }
      expect(await statusOf(finding.id)).toBe("fixed");
    });

    it("rejects a status users may not set", async () => {
      const { addFinding } = await newSite();
      const finding = await addFinding("open");

      for (const status of ["fixed", "regressed", "whatever"]) {
        const response = await call("PATCH", `/findings/${finding.id}`, alice, {
          status,
        });
        expect(response.statusCode).toBe(400);
      }
      expect(
        (await call("PATCH", `/findings/${finding.id}`, alice, {})).statusCode,
      ).toBe(400);
    });

    it("is refused to other accounts, which cannot tell it exists", async () => {
      const { addFinding } = await newSite();
      const finding = await addFinding("open");

      const response = await call("PATCH", `/findings/${finding.id}`, bob, {
        status: "ignored",
      });

      expect(response.statusCode).toBe(404);
      expect(await statusOf(finding.id)).toBe("open");
    });

    it("answers 404 for unknown or malformed ids, and 401 without a session", async () => {
      const missing = "00000000-0000-4000-8000-000000000000";

      expect(
        (
          await call("PATCH", `/findings/${missing}`, alice, {
            status: "ignored",
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (await call("PATCH", "/findings/nope", alice, { status: "ignored" }))
          .statusCode,
      ).toBe(404);
      expect(
        (
          await call("PATCH", `/findings/${missing}`, undefined, {
            status: "ignored",
          })
        ).statusCode,
      ).toBe(401);
    });

    it("bumps the update date", async () => {
      const { addFinding } = await newSite();
      const finding = await addFinding("open");
      await h.db
        .update(findings)
        .set({ updatedAt: new Date("2020-01-01T00:00:00Z") })
        .where(eq(findings.id, finding.id));

      const response = await call("PATCH", `/findings/${finding.id}`, alice, {
        status: "ignored",
      });

      expect(new Date(response.json().updatedAt).getFullYear()).toBeGreaterThan(
        2020,
      );
    });
  });

  it("keeps site rows untouched by finding changes", async () => {
    const { site, addFinding } = await newSite();
    const finding = await addFinding("open");
    await call("PATCH", `/findings/${finding.id}`, alice, {
      status: "ignored",
    });

    const [row] = await h.db.select().from(sites).where(eq(sites.id, site.id));
    expect(row?.baseUrl).toBe(site.baseUrl);
  });
});
