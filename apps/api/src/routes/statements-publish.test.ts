import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  accessibilityStatements,
  manualChecks,
  memberships,
  users,
} from "@accessibility/db";
import { RENDER_STATEMENT_PDF_JOB } from "@accessibility/queue";
import { RGAA_CRITERIA } from "@accessibility/rules";
import { adminDatabaseUrl } from "../test/integration.js";
import { createHarness, signIn, type Harness } from "../test/harness.js";

const adminUrl = adminDatabaseUrl();

type Headers = { cookie: string; origin: string };

describe.skipIf(adminUrl === undefined)("publishing a statement", () => {
  let h: Harness & { test: unknown };
  let alice: Headers;
  let bob: Headers;
  let carol: Headers;
  let n = 0;

  beforeAll(async () => {
    h = await createHarness(adminUrl as string);
    alice = (await signIn(h, "alice@example.fr")).headers;
    bob = (await signIn(h, "bob@example.fr")).headers;
    carol = (await signIn(h, "carol@example.fr")).headers;
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

  const complete = {
    contactEmail: "contact@acme.fr",
    technologies: "HTML, CSS",
    testEnvironment: "Firefox avec NVDA",
    tools: "axe-core",
    samplePages: ["https://acme.fr/"],
  };

  // A site with a draft that is complete except for what the options leave out.
  async function setup(
    options: { checks?: "ok" | "partial" | "none"; fields?: boolean } = {},
  ) {
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
    ).json() as { id: string };
    const checks = options.checks ?? "ok";
    if (checks !== "none") {
      await h.db.insert(manualChecks).values(
        RGAA_CRITERIA.map((c) => ({
          siteId: site.id,
          criterionId: c.id,
          status:
            checks === "partial" && c.id === "1.1"
              ? ("ko" as const)
              : ("ok" as const),
        })),
      );
    }
    const draft = (
      await call("POST", `/sites/${site.id}/statements`, alice)
    ).json();
    if (options.fields !== false)
      await call("PUT", `/statements/${draft.id}`, alice, complete);
    return { orgId: org.id, siteId: site.id, draftId: draft.id as string };
  }
  const publish = (
    id: string,
    declaredStatus: string,
    headers: Headers | "anonymous" = alice,
  ) =>
    call(
      "POST",
      `/statements/${id}/publish`,
      headers === "anonymous" ? undefined : headers,
      { declaredStatus },
    );
  const rowOf = async (id: string) =>
    (
      await h.db
        .select()
        .from(accessibilityStatements)
        .where(eq(accessibilityStatements.id, id))
    )[0]!;

  it("publishes, freezes what the audit says, and queues the PDF", async () => {
    const { draftId } = await setup({ checks: "partial" });
    const before = h.queue.jobs.length;

    const response = await publish(draftId, "partiel");

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      id: draftId,
      status: "published",
      declaredStatus: "partiel",
      computedStatus: "partiel",
      complianceRate: 99,
      counts: { conforme: 105, nonConforme: 1, na: 0, aVerifier: 0 },
      pdfReady: false,
    });
    expect(body.publicPath).toMatch(/^\/d\/[a-z0-9]{20}$/);
    expect(new Date(body.publishedAt).getTime()).toBeGreaterThan(
      Date.now() - 60_000,
    );
    expect(
      body.nonAccessibleContent.map(
        (c: { criterionId: string }) => c.criterionId,
      ),
    ).toEqual(["1.1"]);
    expect(h.queue.jobs.slice(before)).toEqual([
      { name: RENDER_STATEMENT_PDF_JOB, payload: { statementId: draftId } },
    ]);
    const row = await rowOf(draftId);
    expect(row.publishedBy).not.toBeNull();
    expect(row.criteriaSnapshot).not.toBeNull();
  });

  it("does not change when the live audit does", async () => {
    const { draftId, siteId } = await setup();
    await publish(draftId, "total");

    await h.db
      .update(manualChecks)
      .set({ status: "ko" })
      .where(eq(manualChecks.siteId, siteId));
    const body = (await call("GET", `/statements/${draftId}`, alice)).json();

    expect(body).toMatchObject({
      computedStatus: "total",
      complianceRate: 100,
      counts: { conforme: 106 },
    });
    expect(body.nonAccessibleContent).toEqual([]);
  });

  it("lets a publisher declare a more cautious level than the audit supports", async () => {
    const { draftId } = await setup();

    const response = await publish(draftId, "non");

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      declaredStatus: "non",
      computedStatus: "total",
    });
  });

  it("refuses a level more favourable than the audit supports", async () => {
    const { draftId } = await setup({ checks: "partial" });

    const response = await publish(draftId, "total");

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "status_not_supported" });
    expect((await rowOf(draftId)).status).toBe("draft");
  });

  it("refuses to publish while the audit is incomplete, whatever the level", async () => {
    const { draftId } = await setup({ checks: "none" });

    for (const level of ["total", "partiel", "non"]) {
      const response = await publish(draftId, level);
      expect(response.statusCode, level).toBe(400);
      expect(response.json()).toMatchObject({ error: "audit_incomplete" });
    }
    expect((await rowOf(draftId)).status).toBe("draft");
  });

  it("refuses an incomplete statement and names what is missing", async () => {
    const { draftId } = await setup({ fields: false });

    const response = await publish(draftId, "total");

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "incomplete" });
    expect(response.json().message).toMatch(/contact/);
    expect(response.json().message).toMatch(/outils|tools/i);
    expect((await rowOf(draftId)).status).toBe("draft");
  });

  it("refuses an unknown level", async () => {
    const { draftId } = await setup();

    for (const level of ["indetermine", "great", ""]) {
      expect((await publish(draftId, level)).statusCode, level).toBe(400);
    }
  });

  it("is reserved to owners of the organization", async () => {
    const { draftId, orgId } = await setup();
    const [bobUser] = await h.db
      .select()
      .from(users)
      .where(eq(users.email, "bob@example.fr"));
    await h.db
      .insert(memberships)
      .values({ userId: bobUser!.id, orgId, role: "member" });

    const asMember = await publish(draftId, "total", bob);

    expect(asMember.statusCode).toBe(403);
    expect(asMember.json()).toMatchObject({ error: "owner_required" });
    expect((await rowOf(draftId)).status).toBe("draft");
  });

  it("is hidden from other accounts and anonymous visitors", async () => {
    const { draftId } = await setup();

    expect((await publish(draftId, "total", carol)).statusCode).toBe(404);
    expect((await publish(draftId, "total", "anonymous")).statusCode).toBe(401);
    expect(
      (await publish("00000000-0000-4000-8000-000000000000", "total"))
        .statusCode,
    ).toBe(404);
    expect((await rowOf(draftId)).status).toBe("draft");
  });

  it("cannot be published twice", async () => {
    const { draftId } = await setup();
    await publish(draftId, "total");

    const again = await publish(draftId, "total");

    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: "not_a_draft" });
  });

  it("lets only one of simultaneous publications through", async () => {
    const { draftId } = await setup();

    const responses = await Promise.all(
      Array.from({ length: 4 }, () => publish(draftId, "total")),
    );

    expect(responses.map((r) => r.statusCode).sort()).toEqual([
      200, 409, 409, 409,
    ]);
  });

  it("replaces the previous version, leaving a single one in force", async () => {
    const { draftId, siteId } = await setup();
    const first = (await publish(draftId, "total")).json();
    const second = (
      await call("POST", `/sites/${siteId}/statements`, alice)
    ).json();
    await call("PUT", `/statements/${second.id}`, alice, complete);

    const published = (await publish(second.id, "total")).json();

    expect(published).toMatchObject({ version: 2, status: "published" });
    const rows = await h.db
      .select()
      .from(accessibilityStatements)
      .where(eq(accessibilityStatements.siteId, siteId));
    expect(
      rows.filter((r) => r.status === "published").map((r) => r.id),
    ).toEqual([second.id]);
    expect(
      (await call("GET", `/statements/${first.id}`, alice)).json().status,
    ).toBe("superseded");
    expect(first.publicPath).not.toBe(published.publicPath);
  });

  it("starts the next version as a new draft once one is published", async () => {
    const { draftId, siteId } = await setup();
    await publish(draftId, "total");

    const next = await call("POST", `/sites/${siteId}/statements`, alice);

    expect(next.statusCode).toBe(201);
    expect(next.json()).toMatchObject({ version: 2, status: "draft" });
  });

  it("stands even when the PDF job cannot be queued", async () => {
    const { draftId } = await setup();
    h.queue.failEnqueue = true;
    try {
      const response = await publish(draftId, "total");
      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe("published");
    } finally {
      h.queue.failEnqueue = false;
    }
  });
});
