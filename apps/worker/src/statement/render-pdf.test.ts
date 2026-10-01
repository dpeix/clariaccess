import { eq } from "drizzle-orm";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  accessibilityStatements,
  organizations,
  runMigrations,
  seedRules,
  sites,
} from "@accessibility/db";
import {
  createTestDatabase,
  type TestDatabase,
} from "@accessibility/db/test-helpers";
import { adminDatabaseUrl, chromiumAvailable } from "../test/integration.js";
import {
  startFixtureServer,
  type FixtureServer,
} from "../test/fixture-server.js";
import { htmlToPdf, renderStatementPdf } from "./render-pdf.js";

const adminUrl = adminDatabaseUrl();
const ready = adminUrl !== undefined && chromiumAvailable();

const pageCount = (pdf: Buffer) =>
  (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length;

describe.skipIf(!ready)("statement PDF", () => {
  let test: TestDatabase;
  let browser: Browser;
  let server: FixtureServer;
  let n = 0;

  beforeAll(async () => {
    test = await createTestDatabase(adminUrl as string);
    await runMigrations(test.db);
    await seedRules(test.db);
    browser = await chromium.launch();
    server = await startFixtureServer();
  });
  afterAll(async () => {
    await browser.close();
    await server.close();
    await test.close();
  });

  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  async function statement(
    status: "draft" | "published" | "superseded" = "published",
    patch: Partial<typeof accessibilityStatements.$inferInsert> = {},
  ) {
    n += 1;
    const [org] = await test.db
      .insert(organizations)
      .values({ name: "Acme" })
      .returning();
    const [site] = await test.db
      .insert(sites)
      .values({
        orgId: org!.id,
        baseUrl: `https://site${n}.example`,
        verificationToken: "t",
      })
      .returning();
    const [row] = await test.db
      .insert(accessibilityStatements)
      .values({
        siteId: site!.id,
        version: 1,
        status,
        computedStatus: "partiel",
        referentialVersion: "4.1",
        entityName: "Acme SAS",
        technologies: "HTML",
        testEnvironment: "Firefox",
        tools: "axe",
        samplePages: [`https://site${n}.example/`],
        contactEmail: "a@acme.fr",
        ...(status === "draft"
          ? {}
          : {
              declaredStatus: "partiel" as const,
              publishedAt: new Date(),
              publicSlug: `slug${String(n).padStart(3, "0")}abcdefghijkl`,
              complianceRate: 90,
              criteriaSnapshot: {
                counts: { conforme: 90, nonConforme: 10, na: 6, aVerifier: 0 },
              },
              nonAccessibleContent: [
                {
                  criterionId: "1.1",
                  title: "Titre",
                  sources: ["manual"],
                  notes: "n",
                },
              ],
            }),
        ...patch,
      })
      .returning();
    return row!;
  }
  const pdfOf = async (id: string) =>
    (
      await test.db
        .select()
        .from(accessibilityStatements)
        .where(eq(accessibilityStatements.id, id))
    )[0]!;

  describe("htmlToPdf", () => {
    it("prints an HTML page as an A4 PDF", async () => {
      const pdf = await htmlToPdf(
        browser,
        "<!doctype html><html lang='fr'><body><h1>Titre</h1><p>Texte</p></body></html>",
      );

      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      expect(pdf.length).toBeGreaterThan(1000);
      expect(pageCount(pdf)).toBe(1);
      // A4 in points: 595 x 842.
      expect(pdf.toString("latin1")).toMatch(
        /MediaBox\s*\[\s*0\s+0\s+595\.\d+\s+84[23]\.\d+\s*\]/,
      );
    });

    it("spreads a long document over several pages", async () => {
      const rows = Array.from(
        { length: 150 },
        (_, i) => `<p>Ligne ${i}</p>`,
      ).join("");

      expect(
        pageCount(
          await htmlToPdf(browser, `<!doctype html><body>${rows}</body>`),
        ),
      ).toBeGreaterThan(1);
    });

    it("runs no script and makes no request, whatever the page asks for", async () => {
      server.hits.length = 0;
      const html = `<!doctype html><body>
        <script>fetch("${server.origin}/from-script")</script>
        <script src="${server.origin}/external.js"></script>
        <img src="${server.origin}/pixel.png">
        <link rel="stylesheet" href="${server.origin}/style.css">
        <iframe src="${server.origin}/frame.html"></iframe>
        <p>texte</p></body>`;

      const pdf = await htmlToPdf(browser, html);

      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      expect(server.hits).toEqual([]);
    });

    it("releases its browser context, even when printing fails", async () => {
      const before = browser.contexts().length;

      await htmlToPdf(browser, "<p>ok</p>");
      await expect(
        htmlToPdf(
          {
            newContext: async () => {
              throw new Error("boom");
            },
          } as unknown as Browser,
          "<p>x</p>",
        ),
      ).rejects.toThrow("boom");

      expect(browser.contexts().length).toBe(before);
    });
  });

  describe("renderStatementPdf", () => {
    const deps = () => ({ db: test.db, browser, log });

    it("stores the PDF of a published statement and marks when", async () => {
      const row = await statement();

      const outcome = await renderStatementPdf(deps(), row.id);

      expect(outcome).toBe("rendered");
      const after = await pdfOf(row.id);
      expect(after.pdf?.subarray(0, 5).toString()).toBe("%PDF-");
      expect(after.pdfGeneratedAt).toBeInstanceOf(Date);
    });

    it("also renders a replaced version, which stays public", async () => {
      const row = await statement("superseded");

      expect(await renderStatementPdf(deps(), row.id)).toBe("rendered");
    });

    it("does not render twice: a redelivered job leaves the PDF as it is", async () => {
      const row = await statement();
      await renderStatementPdf(deps(), row.id);
      const first = (await pdfOf(row.id)).pdf!;

      const again = await renderStatementPdf(deps(), row.id);

      expect(again).toBe("skipped");
      expect((await pdfOf(row.id)).pdf!.equals(first)).toBe(true);
    });

    it("keeps a single PDF when two jobs run at the same time", async () => {
      const row = await statement();

      const outcomes = await Promise.all([
        renderStatementPdf(deps(), row.id),
        renderStatementPdf(deps(), row.id),
      ]);

      expect(
        outcomes.filter((o) => o === "rendered").length,
      ).toBeGreaterThanOrEqual(1);
      expect((await pdfOf(row.id)).pdf).not.toBeNull();
    });

    it("skips a draft and an unknown statement: nothing public to print", async () => {
      const draft = await statement("draft");

      expect(await renderStatementPdf(deps(), draft.id)).toBe("skipped");
      expect(
        await renderStatementPdf(
          deps(),
          "00000000-0000-4000-8000-000000000000",
        ),
      ).toBe("skipped");
      expect((await pdfOf(draft.id)).pdf).toBeNull();
    });

    it("prints hostile content as text and still makes no request", async () => {
      server.hits.length = 0;
      const row = await statement("published", {
        entityName: `<img src="${server.origin}/x.png"><script>fetch("${server.origin}/y")</script>`,
        technologies: `<iframe src="${server.origin}/z"></iframe>`,
      });

      expect(await renderStatementPdf(deps(), row.id)).toBe("rendered");
      expect(server.hits).toEqual([]);
    });

    it("throws when the browser fails, for the queue to retry, and stores nothing", async () => {
      const row = await statement();
      const broken = {
        newContext: async () => {
          throw new Error("browser down");
        },
      } as unknown as Browser;

      await expect(
        renderStatementPdf({ db: test.db, browser: broken, log }, row.id),
      ).rejects.toThrow("browser down");
      expect((await pdfOf(row.id)).pdf).toBeNull();
    });
  });
});
