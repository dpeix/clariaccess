import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  audits,
  findings,
  manualChecks,
  pages,
  users,
} from "@accessibility/db";
import { RGAA_CRITERIA } from "@accessibility/rules";
import { adminDatabaseUrl } from "../test/integration.js";
import { createHarness, signIn, type Harness } from "../test/harness.js";

const adminUrl = adminDatabaseUrl();

type Headers = { cookie: string; origin: string };

describe.skipIf(adminUrl === undefined)("manual audit", () => {
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
    method: "GET" | "PUT" | "DELETE",
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
    return site;
  }
  async function addFinding(
    siteId: string,
    baseUrl: string,
    ruleId: string,
    status: "open" | "fixed" | "ignored" = "open",
    k = 1,
  ) {
    const [audit] = await h.db
      .insert(audits)
      .values({ siteId, type: "manual", status: "completed" })
      .returning();
    const [page] = await h.db
      .insert(pages)
      .values({ siteId, url: `${baseUrl}/${ruleId}-${k}-${status}` })
      .returning();
    await h.db.insert(findings).values({
      siteId,
      pageId: page!.id,
      ruleId,
      fingerprint: `${ruleId}-${k}-${status}-${siteId}`,
      impact: "serious",
      status,
      selector: "x",
      htmlExcerpt: "<x>",
      message: "m",
      firstSeenAuditId: audit!.id,
      lastSeenAuditId: audit!.id,
      priorityScore: 6,
    });
  }

  describe("GET /sites/:id/manual-checks", () => {
    it("requires a session and membership", async () => {
      const site = await newSite();

      expect(
        (await call("GET", `/sites/${site.id}/manual-checks`)).statusCode,
      ).toBe(401);
      expect(
        (await call("GET", `/sites/${site.id}/manual-checks`, bob)).statusCode,
      ).toBe(404);
      expect(
        (await call("GET", "/sites/nope/manual-checks", alice)).statusCode,
      ).toBe(404);
    });

    it("lists the 106 criteria in order, none checked yet, with the reference version", async () => {
      const site = await newSite();

      const body = (
        await call("GET", `/sites/${site.id}/manual-checks`, alice)
      ).json();

      expect(body.referentialVersion).toBe("4.1");
      expect(body.themes).toHaveLength(13);
      expect(body.criteria.map((c: { id: string }) => c.id)).toEqual(
        RGAA_CRITERIA.map((c) => c.id),
      );
      expect(
        body.criteria.every((c: { check: unknown }) => c.check === null),
      ).toBe(true);
      expect(body.progress).toEqual({ checked: 0, total: 106 });
    });

    it("says which criteria the scan looks at, never that it validates them", async () => {
      const site = await newSite();

      const body = (
        await call("GET", `/sites/${site.id}/manual-checks`, alice)
      ).json();

      const c11 = body.criteria.find((c: { id: string }) => c.id === "1.1");
      expect(c11).toMatchObject({ autoTested: true });
      expect(c11.axeRules).toContain("image-alt");
      expect(
        body.criteria.find((c: { id: string }) => c.id === "13.1")?.autoTested,
      ).toBe(false);
    });

    it("reports open scan problems on a criterion, and not fixed ones", async () => {
      const site = await newSite();
      await addFinding(site.id, site.baseUrl, "image-alt", "open");
      await addFinding(site.id, site.baseUrl, "image-alt", "ignored", 2);
      await addFinding(site.id, site.baseUrl, "color-contrast", "fixed");

      const body = (
        await call("GET", `/sites/${site.id}/manual-checks`, alice)
      ).json();

      const problems = (id: string) =>
        body.criteria.find((c: { id: string }) => c.id === id).autoProblems;
      expect(problems("1.1")).toBe(2);
      expect(problems("3.2")).toBe(0);
    });
  });

  describe("PUT /sites/:id/manual-checks/:criterionId", () => {
    const put = (
      siteId: string,
      criterion: string,
      payload: unknown,
      as: Headers | "anonymous" = alice,
    ) =>
      call(
        "PUT",
        `/sites/${siteId}/manual-checks/${criterion}`,
        as === "anonymous" ? undefined : as,
        payload as object,
      );
    const rows = (siteId: string) =>
      h.db.select().from(manualChecks).where(eq(manualChecks.siteId, siteId));

    it("records the check with who and when", async () => {
      const site = await newSite();

      const response = await put(site.id, "1.1", {
        status: "ko",
        notes: "Logo sans alternative.",
        evidenceUrl: "https://example.fr/capture.png",
      });

      expect(response.statusCode).toBe(204);
      const [row] = await rows(site.id);
      expect(row).toMatchObject({
        criterionId: "1.1",
        status: "ko",
        notes: "Logo sans alternative.",
        evidenceUrl: "https://example.fr/capture.png",
      });
      const [alice1] = await h.db
        .select()
        .from(users)
        .where(eq(users.email, "alice@example.fr"));
      expect(row?.checkedBy).toBe(alice1?.id);
      const body = (
        await call("GET", `/sites/${site.id}/manual-checks`, alice)
      ).json();
      expect(body.criteria[0].check).toMatchObject({
        status: "ko",
        notes: "Logo sans alternative.",
        checkedBy: "alice@example.fr",
      });
      expect(body.progress.checked).toBe(1);
    });

    it("replaces an earlier check of the same criterion", async () => {
      const site = await newSite();
      await put(site.id, "1.1", { status: "ko", notes: "avant" });

      await put(site.id, "1.1", { status: "ok" });

      const all = await rows(site.id);
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({
        status: "ok",
        notes: "",
        evidenceUrl: null,
      });
    });

    it("is idempotent", async () => {
      const site = await newSite();
      await put(site.id, "2.1", { status: "ok" });
      await put(site.id, "2.1", { status: "ok" });

      expect(await rows(site.id)).toHaveLength(1);
    });

    it("counts each criterion once in the progress, and not-applicable ones as checked", async () => {
      const site = await newSite();
      await put(site.id, "1.1", { status: "ok" });
      await put(site.id, "1.2", { status: "na" });
      await put(site.id, "1.1", { status: "ko" });

      const body = (
        await call("GET", `/sites/${site.id}/manual-checks`, alice)
      ).json();

      expect(body.progress).toEqual({ checked: 2, total: 106 });
    });

    it("refuses a criterion that is not in the reference, and a malformed one", async () => {
      const site = await newSite();

      expect((await put(site.id, "99.9", { status: "ok" })).statusCode).toBe(
        404,
      );
      expect((await put(site.id, "1.99", { status: "ok" })).statusCode).toBe(
        404,
      );
      for (const criterion of ["abc", "1", "1.1.1", "1.1;drop"]) {
        expect(
          (await put(site.id, criterion, { status: "ok" })).statusCode,
          criterion,
        ).toBe(404);
      }
      expect(await rows(site.id)).toHaveLength(0);
    });

    it.each([
      [{}],
      [{ status: "maybe" }],
      [{ status: "ok", evidenceUrl: "javascript:alert(1)" }],
      [{ status: "ok", notes: "x".repeat(5001) }],
    ])("rejects the body %j", async (payload) => {
      const site = await newSite();

      expect((await put(site.id, "1.1", payload)).statusCode).toBe(400);
      expect(await rows(site.id)).toHaveLength(0);
    });

    it("is refused to other accounts and to anonymous visitors", async () => {
      const site = await newSite();

      expect(
        (await put(site.id, "1.1", { status: "ok" }, bob)).statusCode,
      ).toBe(404);
      expect(
        (await put(site.id, "1.1", { status: "ok" }, "anonymous")).statusCode,
      ).toBe(401);
      expect(await rows(site.id)).toHaveLength(0);
    });

    it("does not let a check of one site show on another", async () => {
      const a = await newSite();
      const b = await newSite();
      await put(a.id, "1.1", { status: "ok" });

      const body = (
        await call("GET", `/sites/${b.id}/manual-checks`, alice)
      ).json();

      expect(body.progress.checked).toBe(0);
    });
  });

  describe("DELETE /sites/:id/manual-checks/:criterionId", () => {
    it("forgets a check, and is fine when there was none", async () => {
      const site = await newSite();
      await call("PUT", `/sites/${site.id}/manual-checks/1.1`, alice, {
        status: "ok",
      });

      const first = await call(
        "DELETE",
        `/sites/${site.id}/manual-checks/1.1`,
        alice,
      );
      const second = await call(
        "DELETE",
        `/sites/${site.id}/manual-checks/1.1`,
        alice,
      );

      expect(first.statusCode).toBe(204);
      expect(second.statusCode).toBe(204);
      expect(
        await h.db
          .select()
          .from(manualChecks)
          .where(eq(manualChecks.siteId, site.id)),
      ).toHaveLength(0);
    });

    it("is refused to other accounts, and keeps the check", async () => {
      const site = await newSite();
      await call("PUT", `/sites/${site.id}/manual-checks/1.1`, alice, {
        status: "ok",
      });

      const response = await call(
        "DELETE",
        `/sites/${site.id}/manual-checks/1.1`,
        bob,
      );

      expect(response.statusCode).toBe(404);
      expect(
        await h.db
          .select()
          .from(manualChecks)
          .where(eq(manualChecks.siteId, site.id)),
      ).toHaveLength(1);
    });

    it("answers 404 for an unknown criterion", async () => {
      const site = await newSite();

      expect(
        (await call("DELETE", `/sites/${site.id}/manual-checks/99.9`, alice))
          .statusCode,
      ).toBe(404);
    });
  });
});
