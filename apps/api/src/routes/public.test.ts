import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accessibilityStatements, manualChecks } from "@accessibility/db";
import { RENDER_STATEMENT_PDF_JOB } from "@accessibility/queue";
import { RGAA_CRITERIA } from "@accessibility/rules";
import { adminDatabaseUrl } from "../test/integration.js";
import { createHarness, signIn, type Harness } from "../test/harness.js";

const adminUrl = adminDatabaseUrl();

type Headers = { cookie: string; origin: string };

describe.skipIf(adminUrl === undefined)("public statement pages", () => {
  let h: Harness & { test: unknown };
  let alice: Headers;
  let n = 0;

  beforeAll(async () => {
    h = await createHarness(adminUrl as string);
    alice = (await signIn(h, "alice@example.fr")).headers;
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

  async function published(
    fields: Record<string, unknown> = {},
    level: "total" | "partiel" = "total",
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
    await h.db.insert(manualChecks).values(
      RGAA_CRITERIA.map((c) => ({
        siteId: site.id,
        criterionId: c.id,
        status:
          level === "partiel" && c.id === "3.2"
            ? ("ko" as const)
            : ("ok" as const),
        notes:
          level === "partiel" && c.id === "3.2" ? "Contraste trop faible." : "",
      })),
    );
    const draft = (
      await call("POST", `/sites/${site.id}/statements`, alice)
    ).json();
    await call("PUT", `/statements/${draft.id}`, alice, {
      contactEmail: "contact@acme.fr",
      technologies: "HTML, CSS",
      testEnvironment: "Firefox avec NVDA",
      tools: "axe-core",
      samplePages: ["https://acme.fr/"],
      ...fields,
    });
    const body = (
      await call("POST", `/statements/${draft.id}/publish`, alice, {
        declaredStatus: level,
      })
    ).json();
    return {
      siteId: site.id,
      id: draft.id as string,
      path: body.publicPath as string,
    };
  }

  describe("GET /d/:slug", () => {
    it("serves the statement as an HTML page, to anyone", async () => {
      const { path } = await published({ entityName: "Acme SAS" });

      const response = await call("GET", path);

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toBe("text/html; charset=utf-8");
      expect(response.body).toContain('<html lang="fr">');
      expect(response.body).toContain("Acme SAS");
      expect(response.body).toContain(
        "est totalement conforme avec le RGAA version 4.1",
      );
    });

    it("is cacheable, carries no cookie and runs no script", async () => {
      const { path } = await published();

      const response = await call("GET", path);

      expect(response.headers["cache-control"]).toMatch(/public, max-age=\d+/);
      expect(response.headers["set-cookie"]).toBeUndefined();
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(response.headers["content-security-policy"]).toContain(
        "default-src 'none'",
      );
      expect(response.headers["content-security-policy"]).not.toMatch(
        /script-src/,
      );
      expect(response.headers["x-robots-tag"]).toBeUndefined();
      expect(response.body).not.toMatch(/<script/i);
    });

    it("shows what was frozen at publication, with the failing criteria", async () => {
      const { path, siteId } = await published({}, "partiel");
      await h.db
        .update(manualChecks)
        .set({ status: "ok", notes: "" })
        .where(eq(manualChecks.siteId, siteId));

      const body = (await call("GET", path)).body;

      expect(body).toContain("est partiellement conforme");
      expect(body).toContain("3.2");
      expect(body).toContain("Contraste trop faible.");
    });

    it("escapes what the publisher typed", async () => {
      const { path } = await published({
        entityName: "<script>alert(1)</script>Acme",
        technologies: "<img src=x onerror=alert(1)>",
      });

      const body = (await call("GET", path)).body;

      expect(body).not.toContain("<script>");
      expect(body).not.toMatch(/<img\b/);
      expect(body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;Acme");
    });

    it("says a replaced version is out of date and points to the one in force", async () => {
      const first = await published();
      const second = (
        await call("POST", `/sites/${first.siteId}/statements`, alice)
      ).json();
      await call("PUT", `/statements/${second.id}`, alice, {
        contactEmail: "contact@acme.fr",
        technologies: "HTML",
        testEnvironment: "Firefox",
        tools: "axe",
        samplePages: ["https://acme.fr/"],
      });
      const current = (
        await call("POST", `/statements/${second.id}/publish`, alice, {
          declaredStatus: "total",
        })
      ).json();

      const old = await call("GET", first.path);

      expect(old.statusCode).toBe(200);
      expect(old.body).toMatch(/remplacée/);
      expect(old.body).toContain(`href="${current.publicPath}"`);
      expect((await call("GET", current.publicPath)).body).not.toMatch(
        /remplacée/,
      );
    });

    it("answers 404 for an unknown, malformed or draft slug, always the same way", async () => {
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
          payload: { baseUrl: `https://draft${n}.example` },
        })
      ).json() as { id: string };
      const draft = (
        await call("POST", `/sites/${site.id}/statements`, alice)
      ).json();
      expect(
        (
          await h.db
            .select()
            .from(accessibilityStatements)
            .where(eq(accessibilityStatements.id, draft.id))
        )[0]?.publicSlug,
      ).toBeNull();

      const responses = await Promise.all([
        call("GET", "/d/abcdefghijklmnopqrst"),
        call("GET", "/d/nope"),
        call("GET", "/d/..%2F..%2Fetc%2Fpasswd"),
        call("GET", "/d/x'%20OR%20'1'='1"),
        call("GET", "/d/" + "a".repeat(200)),
      ]);

      expect(responses.map((r) => r.statusCode)).toEqual([
        404, 404, 404, 404, 404,
      ]);
      expect(new Set(responses.map((r) => r.body)).size).toBe(1);
    });
  });

  describe("GET /d/:slug/pdf", () => {
    it("answers 404 while the PDF is not ready, asks the worker for it, and says to come back", async () => {
      const { id, path } = await published();
      const before = h.queue.jobs.length;

      const response = await call("GET", `${path}/pdf`);

      expect(response.statusCode).toBe(404);
      expect(response.headers["retry-after"]).toBeDefined();
      expect(response.json()).toMatchObject({ error: "pdf_pending" });
      expect(h.queue.jobs.slice(before)).toContainEqual({
        name: RENDER_STATEMENT_PDF_JOB,
        payload: { statementId: id },
      });
    });

    it("keeps working when the queue is down", async () => {
      const { path } = await published();
      h.queue.failEnqueue = true;
      try {
        expect((await call("GET", `${path}/pdf`)).statusCode).toBe(404);
      } finally {
        h.queue.failEnqueue = false;
      }
    });

    it("serves the PDF once it exists, as a cacheable document", async () => {
      const { id, path } = await published();
      const pdf = Buffer.from("%PDF-1.7\nfake");
      await h.db
        .update(accessibilityStatements)
        .set({ pdf, pdfGeneratedAt: new Date() })
        .where(eq(accessibilityStatements.id, id));

      const response = await call("GET", `${path}/pdf`);

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toBe("application/pdf");
      expect(response.headers["content-disposition"]).toMatch(
        /inline; filename="declaration-accessibilite.pdf"/,
      );
      expect(response.headers["cache-control"]).toMatch(/public/);
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(response.rawPayload.equals(pdf)).toBe(true);
    });

    it("links the PDF from the page only when it exists", async () => {
      const { id, path } = await published();
      expect((await call("GET", path)).body).not.toContain(`${path}/pdf`);

      await h.db
        .update(accessibilityStatements)
        .set({ pdf: Buffer.from("%PDF-1.7"), pdfGeneratedAt: new Date() })
        .where(eq(accessibilityStatements.id, id));

      expect((await call("GET", path)).body).toContain(`${path}/pdf`);
    });

    it("answers 404 for an unknown slug without queueing anything", async () => {
      const before = h.queue.jobs.length;

      expect(
        (await call("GET", "/d/abcdefghijklmnopqrst/pdf")).statusCode,
      ).toBe(404);
      expect(h.queue.jobs.length).toBe(before);
    });
  });
});
