import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  audits,
  findings,
  memberships,
  pages,
  remediationTasks,
  users,
} from "@accessibility/db";
import { adminDatabaseUrl } from "../test/integration.js";
import { createHarness, signIn, type Harness } from "../test/harness.js";

const adminUrl = adminDatabaseUrl();

type Headers = { cookie: string; origin: string };
type Status = "todo" | "doing" | "done";

describe.skipIf(adminUrl === undefined)("correction plan", () => {
  let h: Harness & { test: unknown };
  let alice: Headers;
  let bob: Headers;
  let carolId: string;
  let n = 0;

  beforeAll(async () => {
    h = await createHarness(adminUrl as string);
    alice = (await signIn(h, "alice@example.fr")).headers;
    bob = (await signIn(h, "bob@example.fr")).headers;
    await signIn(h, "carol@example.fr");
    carolId = (
      await h.db.select().from(users).where(eq(users.email, "carol@example.fr"))
    )[0]!.id;
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
    const pageIds: string[] = [];
    for (const path of ["/", "/a", "/b"]) {
      const [page] = await h.db
        .insert(pages)
        .values({ siteId: site.id, url: `${site.baseUrl}${path}` })
        .returning();
      pageIds.push(page!.id);
    }
    let k = 0;
    // A rule with its findings on given pages (open unless said otherwise).
    const addRule = async (
      ruleId: string,
      options: {
        pages?: number[];
        status?: Status;
        priority?: number;
        findingStatus?: "open" | "fixed" | "ignored";
      } = {},
    ) => {
      const onPages = options.pages ?? [0];
      for (const index of onPages) {
        k += 1;
        await h.db.insert(findings).values({
          siteId: site.id,
          pageId: pageIds[index]!,
          ruleId,
          fingerprint: `fp-${n}-${k}`,
          impact: "serious",
          status: options.findingStatus ?? "open",
          selector: `x.n${k}`,
          htmlExcerpt: "<x>",
          message: "m",
          firstSeenAuditId: audit!.id,
          lastSeenAuditId: audit!.id,
          priorityScore: 6,
        });
      }
      const [task] = await h.db
        .insert(remediationTasks)
        .values({
          siteId: site.id,
          ruleId,
          status: options.status ?? "todo",
          priorityScore: options.priority ?? 6 * onPages.length,
        })
        .returning();
      return task!;
    };
    return { orgId: org.id, site, addRule };
  }

  describe("GET /sites/:id/tasks", () => {
    it("requires a session and membership", async () => {
      const { site } = await newSite();

      expect((await call("GET", `/sites/${site.id}/tasks`)).statusCode).toBe(
        401,
      );
      expect(
        (await call("GET", `/sites/${site.id}/tasks`, bob)).statusCode,
      ).toBe(404);
    });

    it("lists tasks most urgent first, finished ones last, with counts and criteria", async () => {
      const { site, addRule } = await newSite();
      const low = await addRule("button-name", { priority: 6 });
      const high = await addRule("image-alt", { pages: [0, 1], priority: 12 });
      const done = await addRule("label", {
        status: "done",
        priority: 0,
        findingStatus: "fixed",
      });

      const response = await call("GET", `/sites/${site.id}/tasks`, alice);

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.total).toBe(3);
      expect(body.items.map((t: { id: string }) => t.id)).toEqual([
        high.id,
        low.id,
        done.id,
      ]);
      expect(body.items[0]).toMatchObject({
        id: high.id,
        siteId: site.id,
        ruleId: "image-alt",
        status: "todo",
        priorityScore: 12,
        openFindings: 2,
        pagesAffected: 2,
        assignee: null,
      });
      expect(body.items[0].wcagCriteria.length).toBeGreaterThan(0);
      expect(body.items[0].guide).toMatchObject({ generic: false });
      expect(body.items[0].guide.steps.length).toBeGreaterThan(0);
      expect(body.items[2]).toMatchObject({
        openFindings: 0,
        pagesAffected: 0,
      });
    });

    it("counts a page once however many findings it has, and ignores non-open ones", async () => {
      const { site, addRule } = await newSite();
      const task = await addRule("image-alt", { pages: [0, 0, 1] });
      await h.db
        .update(findings)
        .set({ status: "ignored" })
        .where(eq(findings.siteId, site.id));
      await h.db
        .update(findings)
        .set({ status: "open" })
        .where(
          eq(
            findings.pageId,
            (
              await h.db.select().from(pages).where(eq(pages.siteId, site.id))
            )[0]!.id,
          ),
        );

      const body = (await call("GET", `/sites/${site.id}/tasks`, alice)).json();

      const found = body.items.find((t: { id: string }) => t.id === task.id);
      expect(found.pagesAffected).toBe(1);
      expect(found.openFindings).toBe(2);
    });

    it("falls back on a generic guide for a rule without written advice", async () => {
      const { site, addRule } = await newSite();
      await addRule("tabindex");

      const body = (await call("GET", `/sites/${site.id}/tasks`, alice)).json();

      expect(body.items[0].guide.generic).toBe(true);
    });

    it("filters by status and pages through the results", async () => {
      const { site, addRule } = await newSite();
      await addRule("image-alt", { priority: 5 });
      const doing = await addRule("button-name", {
        status: "doing",
        priority: 4,
      });
      await addRule("label", { priority: 3 });

      const filtered = (
        await call("GET", `/sites/${site.id}/tasks?status=doing`, alice)
      ).json();
      const first = (
        await call("GET", `/sites/${site.id}/tasks?limit=2`, alice)
      ).json();
      const last = (
        await call("GET", `/sites/${site.id}/tasks?limit=2&offset=2`, alice)
      ).json();

      expect(filtered.items.map((t: { id: string }) => t.id)).toEqual([
        doing.id,
      ]);
      expect(filtered.total).toBe(1);
      expect(first.items).toHaveLength(2);
      expect(first.total).toBe(3);
      expect(last.items).toHaveLength(1);
    });

    it.each(["status=gone", "limit=0", "limit=101", "offset=-1"])(
      "rejects the query %s",
      async (query) => {
        const { site } = await newSite();

        expect(
          (await call("GET", `/sites/${site.id}/tasks?${query}`, alice))
            .statusCode,
        ).toBe(400);
      },
    );

    it("shows who a task is assigned to", async () => {
      const { site, orgId, addRule } = await newSite();
      const task = await addRule("image-alt");
      await h.db
        .insert(memberships)
        .values({ userId: carolId, orgId, role: "member" });
      await h.db
        .update(remediationTasks)
        .set({ assigneeUserId: carolId })
        .where(eq(remediationTasks.id, task.id));

      const body = (await call("GET", `/sites/${site.id}/tasks`, alice)).json();

      expect(body.items[0].assignee).toEqual({
        id: carolId,
        email: "carol@example.fr",
      });
    });
  });

  describe("PATCH /tasks/:id", () => {
    const row = async (id: string) =>
      (
        await h.db
          .select()
          .from(remediationTasks)
          .where(eq(remediationTasks.id, id))
      )[0]!;

    it("moves a task to another status", async () => {
      const { addRule } = await newSite();
      const task = await addRule("image-alt");

      const response = await call("PATCH", `/tasks/${task.id}`, alice, {
        status: "doing",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ id: task.id, status: "doing" });
      expect((await row(task.id)).status).toBe("doing");
    });

    it("assigns a member of the organization, and unassigns", async () => {
      const { orgId, addRule } = await newSite();
      await h.db
        .insert(memberships)
        .values({ userId: carolId, orgId, role: "member" });
      const task = await addRule("image-alt");

      const assigned = await call("PATCH", `/tasks/${task.id}`, alice, {
        assigneeUserId: carolId,
      });
      expect(assigned.json().assignee).toEqual({
        id: carolId,
        email: "carol@example.fr",
      });

      const cleared = await call("PATCH", `/tasks/${task.id}`, alice, {
        assigneeUserId: null,
      });
      expect(cleared.json().assignee).toBeNull();
      expect((await row(task.id)).assigneeUserId).toBeNull();
    });

    it("keeps the assignee when only the status changes", async () => {
      const { orgId, addRule } = await newSite();
      await h.db
        .insert(memberships)
        .values({ userId: carolId, orgId, role: "member" });
      const task = await addRule("image-alt");
      await call("PATCH", `/tasks/${task.id}`, alice, {
        assigneeUserId: carolId,
      });

      await call("PATCH", `/tasks/${task.id}`, alice, { status: "doing" });

      expect((await row(task.id)).assigneeUserId).toBe(carolId);
    });

    it("refuses to assign someone who is not in the organization", async () => {
      const { addRule } = await newSite();
      const task = await addRule("image-alt");

      const response = await call("PATCH", `/tasks/${task.id}`, alice, {
        assigneeUserId: carolId,
      });

      expect(response.statusCode).toBe(400);
      expect((await row(task.id)).assigneeUserId).toBeNull();
    });

    it("rejects an empty body and an invalid status", async () => {
      const { addRule } = await newSite();
      const task = await addRule("image-alt");

      for (const payload of [
        {},
        { status: "stuck" },
        { assigneeUserId: "nope" },
      ]) {
        expect(
          (await call("PATCH", `/tasks/${task.id}`, alice, payload)).statusCode,
        ).toBe(400);
      }
      expect((await row(task.id)).status).toBe("todo");
    });

    it("is refused to other accounts, which cannot tell it exists", async () => {
      const { addRule } = await newSite();
      const task = await addRule("image-alt");

      const response = await call("PATCH", `/tasks/${task.id}`, bob, {
        status: "done",
      });

      expect(response.statusCode).toBe(404);
      expect((await row(task.id)).status).toBe("todo");
    });

    it("answers 404 for unknown or malformed ids, and 401 without a session", async () => {
      const missing = "00000000-0000-4000-8000-000000000000";

      expect(
        (await call("PATCH", `/tasks/${missing}`, alice, { status: "done" }))
          .statusCode,
      ).toBe(404);
      expect(
        (await call("PATCH", "/tasks/nope", alice, { status: "done" }))
          .statusCode,
      ).toBe(404);
      expect(
        (
          await call("PATCH", `/tasks/${missing}`, undefined, {
            status: "done",
          })
        ).statusCode,
      ).toBe(401);
    });

    it("bumps the update date", async () => {
      const { addRule } = await newSite();
      const task = await addRule("image-alt");
      await h.db
        .update(remediationTasks)
        .set({ updatedAt: new Date("2020-01-01T00:00:00Z") })
        .where(eq(remediationTasks.id, task.id));

      const response = await call("PATCH", `/tasks/${task.id}`, alice, {
        status: "doing",
      });

      expect(new Date(response.json().updatedAt).getFullYear()).toBeGreaterThan(
        2020,
      );
    });
  });

  describe("GET /orgs/:orgId/members", () => {
    it("lists the people of an organization to its members only", async () => {
      const { orgId } = await newSite();
      await h.db
        .insert(memberships)
        .values({ userId: carolId, orgId, role: "member" });

      const mine = await call("GET", `/orgs/${orgId}/members`, alice);
      const theirs = await call("GET", `/orgs/${orgId}/members`, bob);
      const anonymous = await call("GET", `/orgs/${orgId}/members`);

      expect(mine.statusCode).toBe(200);
      expect(mine.json().map((m: { email: string }) => m.email)).toEqual([
        "alice@example.fr",
        "carol@example.fr",
      ]);
      expect(theirs.statusCode).toBe(404);
      expect(anonymous.statusCode).toBe(401);
    });
  });
});
