import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { organizations } from "@accessibility/db";
import { PLAN_LIMITS } from "@accessibility/contracts";
import { verificationInstructions } from "@accessibility/contracts";
import { VERIFY_SITE_JOB } from "@accessibility/queue";
import { adminDatabaseUrl } from "../test/integration.js";
import { createHarness, signIn, type Harness } from "../test/harness.js";

const adminUrl = adminDatabaseUrl();

type Headers = { cookie: string; origin: string };

describe.skipIf(adminUrl === undefined)("organizations and sites", () => {
  let h: Harness & { test: unknown };
  let alice: Headers;
  let bob: Headers;

  beforeAll(async () => {
    h = await createHarness(adminUrl as string);
    alice = (await signIn(h, "alice@example.fr")).headers;
    bob = (await signIn(h, "bob@example.fr")).headers;
  });
  afterAll(async () => {
    await h.close();
  });

  const call = (
    method: "GET" | "POST" | "PATCH",
    url: string,
    headers?: Headers,
    payload?: object,
  ) => h.app.inject({ method, url, headers, payload });
  const createOrg = async (headers: Headers, name = "Acme") =>
    (await call("POST", "/orgs", headers, { name })).json() as {
      id: string;
      name: string;
      role: string;
    };
  const goPro = (orgId: string) =>
    h.db
      .update(organizations)
      .set({ plan: "pro" })
      .where(eq(organizations.id, orgId));
  const createSite = async (
    headers: Headers,
    orgId: string,
    baseUrl = "https://acme.example",
  ) =>
    (
      await call("POST", `/orgs/${orgId}/sites`, headers, { baseUrl })
    ).json() as {
      id: string;
      baseUrl: string;
    };

  describe("organizations", () => {
    it("requires a session", async () => {
      expect(
        (await call("POST", "/orgs", undefined, { name: "x" })).statusCode,
      ).toBe(401);
      expect((await call("GET", "/orgs")).statusCode).toBe(401);
    });

    it("creates an organization owned by the caller", async () => {
      const response = await call("POST", "/orgs", alice, { name: "  Acme  " });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({ name: "Acme", role: "owner" });
      const me = await call("GET", "/me", alice);
      expect(
        me.json().organizations.map((o: { name: string }) => o.name),
      ).toContain("Acme");
    });

    it("rejects an empty name", async () => {
      expect(
        (await call("POST", "/orgs", alice, { name: "   " })).statusCode,
      ).toBe(400);
    });

    it("lists only the caller's organizations", async () => {
      const mine = await createOrg(alice, "Alice Corp");
      const theirs = await createOrg(bob, "Bob Corp");

      const aliceOrgs = (await call("GET", "/orgs", alice)).json() as {
        id: string;
      }[];
      const bobOrgs = (await call("GET", "/orgs", bob)).json() as {
        id: string;
      }[];

      expect(aliceOrgs.map((o) => o.id)).toContain(mine.id);
      expect(aliceOrgs.map((o) => o.id)).not.toContain(theirs.id);
      expect(bobOrgs.map((o) => o.id)).toContain(theirs.id);
      expect(bobOrgs.map((o) => o.id)).not.toContain(mine.id);
    });
  });

  describe("adding a site", () => {
    it("stores the site origin with instructions to prove ownership", async () => {
      const org = await createOrg(alice);

      const response = await call("POST", `/orgs/${org.id}/sites`, alice, {
        baseUrl: "https://Shop.Acme.example/some/page?x=1#top",
      });

      expect(response.statusCode).toBe(201);
      const site = response.json();
      expect(site).toMatchObject({
        orgId: org.id,
        baseUrl: "https://shop.acme.example",
        verifiedAt: null,
        verificationMethod: null,
      });
      const token = /clariaccess-verify=([A-Za-z0-9_-]{43})$/.exec(
        site.verification.dnsRecord.value,
      )?.[1];
      expect(token).toBeDefined();
      expect(site.verification).toEqual(
        verificationInstructions("https://shop.acme.example", token!),
      );
    });

    it("gives each site its own token", async () => {
      const org = await createOrg(alice);
      await goPro(org.id);
      const a = (
        await call("POST", `/orgs/${org.id}/sites`, alice, {
          baseUrl: "https://a.example",
        })
      ).json();
      const b = (
        await call("POST", `/orgs/${org.id}/sites`, alice, {
          baseUrl: "https://b.example",
        })
      ).json();

      expect(a.verification.dnsRecord.value).not.toBe(
        b.verification.dnsRecord.value,
      );
    });

    it.each([
      ["a non-url", "nope"],
      ["a non-http scheme", "ftp://acme.example"],
      ["embedded credentials", "https://user:pass@acme.example"],
    ])("rejects %s", async (_label, baseUrl) => {
      const org = await createOrg(alice);

      const response = await call("POST", `/orgs/${org.id}/sites`, alice, {
        baseUrl,
      });

      expect(response.statusCode).toBe(400);
    });

    it("refuses the same site twice in one organization", async () => {
      const org = await createOrg(alice);
      await goPro(org.id);
      await createSite(alice, org.id, "https://dup.example");

      const again = await call("POST", `/orgs/${org.id}/sites`, alice, {
        baseUrl: "https://dup.example/other-path",
      });

      expect(again.statusCode).toBe(409);
    });

    it("allows the same site in two organizations", async () => {
      const a = await createOrg(alice);
      const b = await createOrg(bob);
      await createSite(alice, a.id, "https://shared.example");

      const response = await call("POST", `/orgs/${b.id}/sites`, bob, {
        baseUrl: "https://shared.example",
      });

      expect(response.statusCode).toBe(201);
    });
  });

  describe("plans", () => {
    it("starts an organization on the free plan and says what it allows", async () => {
      const org = await createOrg(alice);

      expect(org).toMatchObject({ plan: "free", limits: PLAN_LIMITS.free });
      const listed = (await call("GET", "/orgs", alice)).json() as {
        id: string;
        plan: string;
      }[];
      expect(listed.find((o) => o.id === org.id)?.plan).toBe("free");
      const me = (await call("GET", "/me", alice)).json();
      expect(
        me.organizations.find((o: { id: string }) => o.id === org.id),
      ).toMatchObject({ plan: "free", limits: PLAN_LIMITS.free });
    });

    it("refuses a site beyond the plan, without creating it, and says why", async () => {
      const org = await createOrg(alice);
      await createSite(alice, org.id, "https://one.example");

      const response = await call("POST", `/orgs/${org.id}/sites`, alice, {
        baseUrl: "https://two.example",
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: "plan_limit" });
      const list = (await call("GET", `/orgs/${org.id}/sites`, alice)).json();
      expect(list).toHaveLength(1);
    });

    it("allows the sites of the pro plan, and no more", async () => {
      const org = await createOrg(alice);
      await goPro(org.id);

      for (let i = 0; i < PLAN_LIMITS.pro.maxSites; i += 1) {
        const ok = await call("POST", `/orgs/${org.id}/sites`, alice, {
          baseUrl: `https://pro${i}.example`,
        });
        expect(ok.statusCode).toBe(201);
      }
      const over = await call("POST", `/orgs/${org.id}/sites`, alice, {
        baseUrl: "https://over.example",
      });
      expect(over.statusCode).toBe(403);
    });

    it("applies the limit under concurrent requests", async () => {
      const org = await createOrg(alice);

      const responses = await Promise.all(
        Array.from({ length: 4 }, (_, i) =>
          call("POST", `/orgs/${org.id}/sites`, alice, {
            baseUrl: `https://race${i}.example`,
          }),
        ),
      );

      expect(responses.filter((r) => r.statusCode === 201)).toHaveLength(
        PLAN_LIMITS.free.maxSites,
      );
    });

    it("treats an unknown stored plan as free", async () => {
      const org = await createOrg(alice);
      // The CHECK forbids it in normal operation: lift it for this row only.
      await h.db.execute(
        sql`ALTER TABLE organizations DROP CONSTRAINT organizations_plan_known`,
      );
      await h.db
        .update(organizations)
        .set({ plan: "enterprise" })
        .where(eq(organizations.id, org.id));
      try {
        const listed = (await call("GET", "/orgs", alice)).json() as {
          id: string;
          plan: string;
        }[];
        expect(listed.find((o) => o.id === org.id)?.plan).toBe("free");
      } finally {
        await h.db
          .update(organizations)
          .set({ plan: "free" })
          .where(eq(organizations.id, org.id));
        await h.db.execute(
          sql`ALTER TABLE organizations ADD CONSTRAINT organizations_plan_known CHECK (plan IN ('free', 'pro'))`,
        );
      }
    });
  });

  describe("tenant isolation", () => {
    it("hides an organization from a non-member, for every site route", async () => {
      const org = await createOrg(alice);
      const site = await createSite(alice, org.id);

      const results = await Promise.all([
        call("GET", `/orgs/${org.id}/sites`, bob),
        call("POST", `/orgs/${org.id}/sites`, bob, {
          baseUrl: "https://evil.example",
        }),
        call("GET", `/sites/${site.id}`, bob),
        call("POST", `/sites/${site.id}/verify`, bob),
      ]);

      expect(results.map((r) => r.statusCode)).toEqual([404, 404, 404, 404]);
      expect(h.queue.jobs.some((j) => j.name === VERIFY_SITE_JOB)).toBe(false);
      // Alice still sees exactly her own site.
      const list = (await call("GET", `/orgs/${org.id}/sites`, alice)).json();
      expect(list).toHaveLength(1);
    });

    it("answers 404 for ids that do not exist or are malformed", async () => {
      const missing = "00000000-0000-4000-8000-000000000000";

      const results = await Promise.all([
        call("GET", `/orgs/${missing}/sites`, alice),
        call("GET", `/sites/${missing}`, alice),
        call("GET", "/sites/not-a-uuid", alice),
        call("GET", "/orgs/not-a-uuid/sites", alice),
      ]);

      expect(results.map((r) => r.statusCode)).toEqual([404, 404, 404, 404]);
    });

    it("requires a session on every site route", async () => {
      const results = await Promise.all([
        call("GET", "/orgs/00000000-0000-4000-8000-000000000000/sites"),
        call("GET", "/sites/00000000-0000-4000-8000-000000000000"),
        call("POST", "/sites/00000000-0000-4000-8000-000000000000/verify"),
      ]);

      expect(results.map((r) => r.statusCode)).toEqual([401, 401, 401]);
    });
  });

  describe("reading sites", () => {
    it("lists the sites of an organization and returns one by id", async () => {
      const org = await createOrg(alice);
      const site = await createSite(alice, org.id, "https://list.example");

      const list = (await call("GET", `/orgs/${org.id}/sites`, alice)).json();
      const one = await call("GET", `/sites/${site.id}`, alice);

      expect(list.map((s: { id: string }) => s.id)).toEqual([site.id]);
      expect(one.statusCode).toBe(200);
      expect(one.json().baseUrl).toBe("https://list.example");
    });
  });

  describe("POST /sites/:id/verify", () => {
    it("queues a verification job carrying only the site id", async () => {
      const org = await createOrg(alice);
      const site = await createSite(alice, org.id, "https://verify.example");
      const before = h.queue.jobs.length;

      const response = await call("POST", `/sites/${site.id}/verify`, alice);

      expect(response.statusCode).toBe(202);
      expect(response.json().id).toBe(site.id);
      expect(h.queue.jobs.slice(before)).toEqual([
        { name: VERIFY_SITE_JOB, payload: { siteId: site.id } },
      ]);
    });

    it("answers 503 when the queue is down", async () => {
      const org = await createOrg(alice);
      const site = await createSite(alice, org.id, "https://down.example");
      h.queue.failEnqueue = true;
      try {
        const response = await call("POST", `/sites/${site.id}/verify`, alice);
        expect(response.statusCode).toBe(503);
      } finally {
        h.queue.failEnqueue = false;
      }
    });
  });
});
