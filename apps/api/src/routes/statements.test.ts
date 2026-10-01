import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  accessibilityStatements,
  auditPages,
  audits,
  findings,
  manualChecks,
  pages,
} from "@accessibility/db";
import { RGAA_CRITERIA } from "@accessibility/rules";
import { adminDatabaseUrl } from "../test/integration.js";
import { createHarness, signIn, type Harness } from "../test/harness.js";

const adminUrl = adminDatabaseUrl();

type Headers = { cookie: string; origin: string };

describe.skipIf(adminUrl === undefined)("statement drafts", () => {
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
    method: "GET" | "POST" | "PUT",
    url: string,
    headers?: Headers,
    payload?: object,
  ) => h.app.inject({ method, url, headers, payload });

  async function newSite(orgName = `Org ${n + 1}`) {
    n += 1;
    const org = (
      await h.app.inject({
        method: "POST",
        url: "/orgs",
        headers: alice,
        payload: { name: orgName },
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
    return { ...site, orgId: org.id };
  }
  const checkAll = async (
    siteId: string,
    status: "ok" | "ko" | "na" = "ok",
  ) => {
    await h.db
      .insert(manualChecks)
      .values(RGAA_CRITERIA.map((c) => ({ siteId, criterionId: c.id, status })))
      .onConflictDoNothing();
  };
  const create = (siteId: string, as: Headers | "anonymous" = alice) =>
    call(
      "POST",
      `/sites/${siteId}/statements`,
      as === "anonymous" ? undefined : as,
    );

  describe("POST /sites/:id/statements", () => {
    it("requires a session and membership", async () => {
      const site = await newSite();

      expect((await create(site.id, "anonymous")).statusCode).toBe(401);
      expect((await create(site.id, bob)).statusCode).toBe(404);
      expect(
        await h.db
          .select()
          .from(accessibilityStatements)
          .where(eq(accessibilityStatements.siteId, site.id)),
      ).toHaveLength(0);
    });

    it("creates version 1 as a draft, French, with the organization as publisher", async () => {
      const site = await newSite("Acme SAS");

      const response = await create(site.id);

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        siteId: site.id,
        version: 1,
        status: "draft",
        locale: "fr",
        referentialVersion: "4.1",
        entityName: "Acme SAS",
        declaredStatus: null,
        publicPath: null,
        pdfReady: false,
        publishedAt: null,
      });
    });

    it("says nothing is established while the audit is empty, and what is missing", async () => {
      const site = await newSite();

      const body = (await create(site.id)).json();

      expect(body.computedStatus).toBe("indetermine");
      expect(body.allowedStatuses).toEqual([]);
      expect(body.counts).toEqual({
        conforme: 0,
        nonConforme: 0,
        na: 0,
        aVerifier: 106,
      });
      expect(body.complianceRate).toBeNull();
      expect(body.missing).toEqual([
        "contact",
        "samplePages",
        "technologies",
        "testEnvironment",
        "tools",
      ]);
    });

    it("proposes the pages of the latest audit as the sample", async () => {
      const site = await newSite();
      const [audit] = await h.db
        .insert(audits)
        .values({ siteId: site.id, type: "manual", status: "completed" })
        .returning();
      for (const [path, status] of [
        ["/", "done"],
        ["/contact", "done"],
        ["/broken", "failed"],
      ] as const) {
        const [page] = await h.db
          .insert(pages)
          .values({ siteId: site.id, url: `${site.baseUrl}${path}` })
          .returning();
        await h.db
          .insert(auditPages)
          .values({ auditId: audit!.id, pageId: page!.id, status });
      }

      const body = (await create(site.id)).json();

      expect(body.samplePages).toEqual([
        `${site.baseUrl}/`,
        `${site.baseUrl}/contact`,
      ]);
      expect(body.missing).not.toContain("samplePages");
    });

    it("allows one draft at a time", async () => {
      const site = await newSite();
      await create(site.id);

      const again = await create(site.id);

      expect(again.statusCode).toBe(409);
      expect(again.json()).toMatchObject({ error: "draft_exists" });
    });

    it("lets only one of several simultaneous requests through", async () => {
      const site = await newSite();

      const responses = await Promise.all(
        Array.from({ length: 4 }, () => create(site.id)),
      );

      expect(responses.map((r) => r.statusCode).sort()).toEqual([
        201, 409, 409, 409,
      ]);
    });
  });

  describe("reading", () => {
    it("computes a draft from the live audit, not from when it was created", async () => {
      const site = await newSite();
      const draft = (await create(site.id)).json();
      expect(draft.computedStatus).toBe("indetermine");

      await checkAll(site.id, "ok");
      const live = (await call("GET", `/statements/${draft.id}`, alice)).json();

      expect(live).toMatchObject({
        computedStatus: "total",
        complianceRate: 100,
        allowedStatuses: ["total", "partiel", "non"],
      });
      expect(live.counts.conforme).toBe(106);
    });

    it("lists the criteria that fail, from a manual check or from the scan", async () => {
      const site = await newSite();
      await checkAll(site.id, "ok");
      await h.db
        .update(manualChecks)
        .set({ status: "ko", notes: "Logo sans alternative." })
        .where(eq(manualChecks.criterionId, "1.1"));
      const [audit] = await h.db
        .insert(audits)
        .values({ siteId: site.id, type: "manual", status: "completed" })
        .returning();
      const [page] = await h.db
        .insert(pages)
        .values({ siteId: site.id, url: `${site.baseUrl}/` })
        .returning();
      await h.db.insert(findings).values({
        siteId: site.id,
        pageId: page!.id,
        ruleId: "color-contrast",
        fingerprint: `cc-${site.id}`,
        impact: "serious",
        status: "open",
        selector: "p",
        htmlExcerpt: "<p>",
        message: "m",
        firstSeenAuditId: audit!.id,
        lastSeenAuditId: audit!.id,
        priorityScore: 6,
      });
      const draft = (await create(site.id)).json();

      const body = (await call("GET", `/statements/${draft.id}`, alice)).json();

      expect(body.computedStatus).toBe("partiel");
      expect(
        body.nonAccessibleContent.map(
          (c: { criterionId: string }) => c.criterionId,
        ),
      ).toEqual(["1.1", "3.2"]);
      expect(body.nonAccessibleContent[0]).toMatchObject({
        sources: ["manual"],
        notes: "Logo sans alternative.",
      });
      expect(body.nonAccessibleContent[1]).toMatchObject({ sources: ["auto"] });
      expect(body.nonAccessibleContent[0].title).toMatch(
        /alternative textuelle/,
      );
    });

    it("lists the versions of a site, newest first, to its members only", async () => {
      const site = await newSite();
      const first = (await create(site.id)).json();
      await h.db
        .update(accessibilityStatements)
        .set({
          status: "superseded",
          declaredStatus: "partiel",
          publicSlug: `slug${site.id.replaceAll("-", "").slice(0, 16)}`,
          publishedAt: new Date(),
          criteriaSnapshot: {},
        })
        .where(eq(accessibilityStatements.id, first.id));
      const second = (await create(site.id)).json();

      const list = await call("GET", `/sites/${site.id}/statements`, alice);

      expect(list.json().map((s: { id: string }) => s.id)).toEqual([
        second.id,
        first.id,
      ]);
      expect(list.json().map((s: { version: number }) => s.version)).toEqual([
        2, 1,
      ]);
      expect(
        (await call("GET", `/sites/${site.id}/statements`, bob)).statusCode,
      ).toBe(404);
      expect(
        (await call("GET", `/sites/${site.id}/statements`)).statusCode,
      ).toBe(401);
    });

    it("hides a statement from other accounts, unknown and malformed ids", async () => {
      const site = await newSite();
      const draft = (await create(site.id)).json();

      expect(
        (await call("GET", `/statements/${draft.id}`, bob)).statusCode,
      ).toBe(404);
      expect(
        (
          await call(
            "GET",
            `/statements/00000000-0000-4000-8000-000000000000`,
            alice,
          )
        ).statusCode,
      ).toBe(404);
      expect((await call("GET", "/statements/nope", alice)).statusCode).toBe(
        404,
      );
      expect((await call("GET", `/statements/${draft.id}`)).statusCode).toBe(
        401,
      );
    });
  });

  describe("PUT /statements/:id", () => {
    const complete = {
      entityName: "Acme SAS",
      contactEmail: "contact@acme.fr",
      samplePages: ["https://acme.fr/"],
      technologies: "HTML, CSS, JavaScript",
      testEnvironment: "Firefox avec NVDA",
      tools: "axe-core",
    };

    it("edits the fields and tells what is still missing", async () => {
      const site = await newSite();
      const draft = (await create(site.id)).json();

      const partial = await call("PUT", `/statements/${draft.id}`, alice, {
        contactEmail: "contact@acme.fr",
        technologies: "HTML",
      });
      expect(partial.statusCode).toBe(200);
      expect(partial.json()).toMatchObject({
        contactEmail: "contact@acme.fr",
        technologies: "HTML",
      });
      expect(partial.json().missing).toEqual([
        "samplePages",
        "testEnvironment",
        "tools",
      ]);

      const done = await call(
        "PUT",
        `/statements/${draft.id}`,
        alice,
        complete,
      );
      expect(done.json().missing).toEqual([]);
    });

    it("clears a field with null and keeps the ones not mentioned", async () => {
      const site = await newSite();
      const draft = (await create(site.id)).json();
      await call("PUT", `/statements/${draft.id}`, alice, complete);

      const response = await call("PUT", `/statements/${draft.id}`, alice, {
        tools: null,
      });

      expect(response.json()).toMatchObject({
        tools: null,
        technologies: "HTML, CSS, JavaScript",
      });
      expect(response.json().missing).toEqual(["tools"]);
    });

    it.each([
      [{}],
      [{ contactEmail: "nope" }],
      [{ contactUrl: "javascript:alert(1)" }],
      [{ samplePages: ["not a url"] }],
      [{ entityName: "x".repeat(201) }],
    ])("rejects the body %j", async (payload) => {
      const site = await newSite();
      const draft = (await create(site.id)).json();

      expect(
        (await call("PUT", `/statements/${draft.id}`, alice, payload))
          .statusCode,
      ).toBe(400);
    });

    it("refuses to edit a statement that is no longer a draft", async () => {
      const site = await newSite();
      const draft = (await create(site.id)).json();
      await h.db
        .update(accessibilityStatements)
        .set({
          status: "published",
          declaredStatus: "partiel",
          publicSlug: `pub${site.id.replaceAll("-", "").slice(0, 16)}`,
          publishedAt: new Date(),
          criteriaSnapshot: {},
        })
        .where(eq(accessibilityStatements.id, draft.id));

      const response = await call("PUT", `/statements/${draft.id}`, alice, {
        tools: "x",
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ error: "not_a_draft" });
    });

    it("is refused to other accounts and to anonymous visitors", async () => {
      const site = await newSite();
      const draft = (await create(site.id)).json();

      expect(
        (await call("PUT", `/statements/${draft.id}`, bob, { tools: "x" }))
          .statusCode,
      ).toBe(404);
      expect(
        (
          await call("PUT", `/statements/${draft.id}`, undefined, {
            tools: "x",
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (await call("GET", `/statements/${draft.id}`, alice)).json().tools,
      ).toBeNull();
    });
  });
});
