import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { organizations, sites } from "@accessibility/db";
import { frequencyIntervalMs } from "@accessibility/contracts";
import { adminDatabaseUrl } from "../test/integration.js";
import { createHarness, signIn, type Harness } from "../test/harness.js";

const adminUrl = adminDatabaseUrl();

type Headers = { cookie: string; origin: string };

describe.skipIf(adminUrl === undefined)("PUT /sites/:id/schedule", () => {
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

  const put = (id: string, payload: unknown, headers?: Headers) =>
    h.app.inject({
      method: "PUT",
      url: `/sites/${id}/schedule`,
      headers,
      payload: payload as object,
    });

  async function newSite(
    options: { verified?: boolean; plan?: "free" | "pro" } = {},
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
    await h.db
      .update(organizations)
      .set({ plan: options.plan ?? "pro" })
      .where(eq(organizations.id, org.id));
    if (options.verified ?? true) {
      await h.db
        .update(sites)
        .set({ verifiedAt: new Date(), verificationMethod: "file" })
        .where(eq(sites.id, site.id));
    }
    return { orgId: org.id, siteId: site.id };
  }
  const row = async (id: string) =>
    (await h.db.select().from(sites).where(eq(sites.id, id)))[0]!;

  it("requires a session", async () => {
    const { siteId } = await newSite();

    expect((await put(siteId, { frequency: "daily" })).statusCode).toBe(401);
  });

  it("schedules a re-scan and says when the next one is due", async () => {
    const { siteId } = await newSite();
    const before = Date.now();

    const response = await put(siteId, { frequency: "daily" }, alice);

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ id: siteId, scanFrequency: "daily" });
    const next = new Date(body.nextScanAt).getTime();
    expect(next).toBeGreaterThanOrEqual(
      before + frequencyIntervalMs("daily") - 1000,
    );
    expect(next).toBeLessThanOrEqual(
      Date.now() + frequencyIntervalMs("daily") + 1000,
    );
    expect((await row(siteId)).scanFrequency).toBe("daily");
  });

  it("starts a weekly schedule a week from now", async () => {
    const { siteId } = await newSite();

    const body = (await put(siteId, { frequency: "weekly" }, alice)).json();

    const delta = new Date(body.nextScanAt).getTime() - Date.now();
    expect(delta).toBeGreaterThan(frequencyIntervalMs("weekly") - 5000);
  });

  it("keeps the due date when the same frequency is set again", async () => {
    const { siteId } = await newSite();
    const first = (await put(siteId, { frequency: "daily" }, alice)).json();

    const again = (await put(siteId, { frequency: "daily" }, alice)).json();

    expect(again.nextScanAt).toBe(first.nextScanAt);
  });

  it("switches re-scans off", async () => {
    const { siteId } = await newSite();
    await put(siteId, { frequency: "daily" }, alice);

    const response = await put(siteId, { frequency: null }, alice);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      scanFrequency: null,
      nextScanAt: null,
    });
    expect(await row(siteId)).toMatchObject({
      scanFrequency: null,
      nextScanAt: null,
    });
  });

  it("is refused on the free plan, with a reason, and changes nothing", async () => {
    const { siteId } = await newSite({ plan: "free" });

    const response = await put(siteId, { frequency: "daily" }, alice);

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: "plan_required" });
    expect((await row(siteId)).scanFrequency).toBeNull();
  });

  it("lets a free site switch off a schedule it kept from a former plan", async () => {
    const { siteId } = await newSite({ plan: "free" });
    await h.db
      .update(sites)
      .set({ scanFrequency: "daily", nextScanAt: new Date() })
      .where(eq(sites.id, siteId));

    const response = await put(siteId, { frequency: null }, alice);

    expect(response.statusCode).toBe(200);
    expect((await row(siteId)).scanFrequency).toBeNull();
  });

  it("requires a verified site", async () => {
    const { siteId } = await newSite({ verified: false });

    const response = await put(siteId, { frequency: "daily" }, alice);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: "site_not_verified" });
  });

  it.each([{ frequency: "hourly" }, {}, { frequency: 5 }, ["daily"]])(
    "rejects the body %j",
    async (payload) => {
      const { siteId } = await newSite();

      expect((await put(siteId, payload, alice)).statusCode).toBe(400);
    },
  );

  it("hides the site from other accounts and unknown ids", async () => {
    const { siteId } = await newSite();

    expect((await put(siteId, { frequency: "daily" }, bob)).statusCode).toBe(
      404,
    );
    expect((await row(siteId)).scanFrequency).toBeNull();
    expect(
      (
        await put(
          "00000000-0000-4000-8000-000000000000",
          { frequency: "daily" },
          alice,
        )
      ).statusCode,
    ).toBe(404);
    expect((await put("nope", { frequency: "daily" }, alice)).statusCode).toBe(
      404,
    );
  });

  it("shows the schedule when reading the site", async () => {
    const { siteId } = await newSite();
    await put(siteId, { frequency: "weekly" }, alice);

    const response = await h.app.inject({
      method: "GET",
      url: `/sites/${siteId}`,
      headers: alice,
    });

    expect(response.json()).toMatchObject({ scanFrequency: "weekly" });
    expect(response.json().nextScanAt).toEqual(expect.any(String));
  });
});
