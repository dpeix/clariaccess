import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { chromium, type Browser, type BrowserContext } from "playwright";
import type { Audit, AuditReport } from "@accessibility/contracts";
import {
  axeViolations,
  chromiumAvailable,
  eventually,
  mockApi,
  serveDist,
  type ApiHandler,
  type StaticServer,
} from "./test/browser.js";
import { TEST_API_URL } from "./test/global-setup.js";
import { listPages } from "./test/dist.js";

const distDir = inject("distDir");
const AUDIT_ID = "6f1c1c1e-5d3b-4c9e-8a57-0b1f2a3c4d5e";

const audit = (patch: Partial<Audit> = {}): Audit => ({
  id: AUDIT_ID,
  url: "https://monsite.fr/",
  type: "free",
  status: "completed",
  startedAt: "2026-10-01T10:00:00.000Z",
  finishedAt: "2026-10-01T10:00:20.000Z",
  pagesScanned: 1,
  score: 42,
  failureReason: null,
  ...patch,
});

// Strings that would run script or inject markup if the page used innerHTML
// or put an unchecked URL in an href.
const XSS = `<img src=x onerror="window.__xss=true">`;
const hostileReport: AuditReport = {
  audit: audit(),
  totalIssues: 3,
  groups: [
    {
      ruleId: "image-alt",
      title: `Images sans alternative ${XSS}`,
      helpUrl: "javascript:window.__xss=true",
      impact: "critical",
      occurrences: 2,
      examples: [
        { selector: `img.${XSS}`, htmlExcerpt: `<img src="a.png">${XSS}` },
      ],
      wcagCriteria: ["1.1.1"],
      rgaaCriteria: ["1.1"],
    },
    {
      ruleId: "color-contrast",
      title: "Contraste insuffisant",
      helpUrl: "https://dequeuniversity.com/rules/axe/4.10/color-contrast",
      impact: "serious",
      occurrences: 1,
      examples: [],
      wcagCriteria: ["1.4.3"],
      rgaaCriteria: [],
    },
  ],
  automatedCoverageNotice:
    "Un audit automatisé ne couvre qu'une partie des critères.",
};

describe.skipIf(!chromiumAvailable())("site in a browser", () => {
  let server: StaticServer;
  let browser: Browser;
  let context: BrowserContext;

  beforeAll(async () => {
    server = await serveDist(distDir);
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  // A fresh context per test keeps routes, storage and dialogs isolated.
  const open = async (
    path: string,
    handler: ApiHandler = () => ({ status: 500 }),
  ) => {
    context = await browser.newContext({ locale: "fr-FR" });
    const page = await context.newPage();
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    const calls = await mockApi(page, TEST_API_URL, handler);
    await page.goto(`${server.origin}${path}`);
    return { page, calls, dialogs };
  };

  const close = async () => context.close();

  describe("accessibility (axe, WCAG 2.1 A and AA)", () => {
    const routes = listPages(distDir).map((p) => p.route);

    it.each(routes)("has no violation on %s", async (route) => {
      const { page } = await open(route);
      expect(await axeViolations(page)).toEqual([]);
      await close();
    });
  });

  describe("free audit form", () => {
    it("rejects an invalid address with an announced, focused error", async () => {
      const { page, calls } = await open("/");
      await page.fill("#audit-url", "pas une url://");
      await page.click("button[type=submit]");

      await eventually(() => page.locator("#audit-url-error").isVisible()).toBe(
        true,
      );
      expect(await page.getAttribute("#audit-url", "aria-invalid")).toBe(
        "true",
      );
      expect(await page.evaluate(() => document.activeElement?.id)).toBe(
        "audit-url",
      );
      expect(calls).toEqual([]);
      expect(await axeViolations(page)).toEqual([]);
      await close();
    });

    it("sends a bare domain as https and opens the result page, keeping utm", async () => {
      const { page, calls } = await open("/?utm_source=linkedin&x=1", () => ({
        status: 202,
        body: audit({
          status: "queued",
          startedAt: null,
          finishedAt: null,
          score: null,
        }),
      }));
      await page.fill("#audit-url", "monsite.fr");
      await page.click("button[type=submit]");
      await page.waitForURL(/\/audit\/\?/);

      expect(calls[0]).toMatchObject({
        method: "POST",
        path: "/audits/free",
        body: { url: "https://monsite.fr/" },
      });
      const url = new URL(page.url());
      expect(url.searchParams.get("id")).toBe(AUDIT_ID);
      expect(url.searchParams.get("utm_source")).toBe("linkedin");
      expect(url.searchParams.has("x")).toBe(false);
      await close();
    });

    it("explains a rate limit and lets the visitor retry", async () => {
      const { page } = await open("/", () => ({
        status: 429,
        body: { error: "rate_limited", message: "x" },
      }));
      await page.fill("#audit-url", "https://monsite.fr");
      await page.click("button[type=submit]");

      await eventually(() =>
        page.locator("#audit-url-error").textContent(),
      ).toContain("Trop de demandes");
      await eventually(() =>
        page.locator("#audit-form button").isEnabled(),
      ).toBe(true);
      await close();
    });

    it("explains a network failure", async () => {
      const { page } = await open("/");
      await page.route(`${TEST_API_URL}/**`, (route) => route.abort());
      await page.fill("#audit-url", "https://monsite.fr");
      await page.click("button[type=submit]");

      await eventually(() =>
        page.locator("#audit-url-error").textContent(),
      ).toContain("connexion");
      await close();
    });
  });

  describe("result page", () => {
    const happyPath =
      (reports: { statuses: Audit["status"][] }): ApiHandler =>
      (call) => {
        if (call.path === `/audits/${AUDIT_ID}/report`) {
          return { status: 200, body: hostileReport };
        }
        if (call.path === `/audits/${AUDIT_ID}`) {
          const status = reports.statuses.shift() ?? "completed";
          return { status: 200, body: audit({ status }) };
        }
        if (call.path === "/leads") return { status: 201 };
        return { status: 404 };
      };

    it("waits for the audit, then shows the report without running audited content", async () => {
      const { page, dialogs } = await open(
        `/audit/?id=${AUDIT_ID}`,
        happyPath({ statuses: ["running"] }),
      );

      await eventually(
        () => page.locator("#report h2").first().textContent(),
        10_000,
      ).toBe("Score automatisé : 42/100");
      await eventually(() =>
        page.locator("#report .notice").textContent(),
      ).toContain("une partie des critères");
      await eventually(() =>
        page.locator("#report h3").first().textContent(),
      ).toContain("Images sans alternative");
      // The hostile markup is shown as text, never interpreted.
      expect(await page.locator("#report img").count()).toBe(0);
      expect(
        await page.evaluate(() => (window as { __xss?: boolean }).__xss),
      ).toBeUndefined();
      expect(dialogs).toEqual([]);
      // Only the http(s) link survives.
      const links = await page
        .locator("#report a")
        .evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
      expect(links).toEqual([
        "https://dequeuniversity.com/rules/axe/4.10/color-contrast",
      ]);
      expect(await axeViolations(page)).toEqual([]);
      await close();
    });

    it("shows why an audit failed and offers no report", async () => {
      const { page } = await open(`/audit/?id=${AUDIT_ID}`, (call) =>
        call.path === `/audits/${AUDIT_ID}`
          ? {
              status: 200,
              body: audit({
                status: "failed",
                failureReason: "robots_disallowed",
                score: null,
              }),
            }
          : { status: 404 },
      );

      await eventually(() =>
        page.locator("#audit-status").textContent(),
      ).toContain("robots.txt");
      await eventually(() => page.locator("#lead").isVisible()).toBe(false);
      await close();
    });

    it("rejects a missing or malformed id without calling the API", async () => {
      for (const path of ["/audit/", "/audit/?id=../../etc/passwd"]) {
        const { page, calls } = await open(path);
        await eventually(() =>
          page.locator("#audit-status").textContent(),
        ).toContain("Lien invalide");
        expect(calls).toEqual([]);
        await close();
      }
    });

    it("says so when the audit does not exist", async () => {
      const { page } = await open(`/audit/?id=${AUDIT_ID}`, () => ({
        status: 404,
        body: { error: "not_found", message: "x" },
      }));
      await eventually(() =>
        page.locator("#audit-status").textContent(),
      ).toContain("introuvable");
      await close();
    });

    describe("lead form", () => {
      const openCompleted = (query = "") =>
        open(`/audit/?id=${AUDIT_ID}${query}`, happyPath({ statuses: [] }));

      it("refuses to submit without consent", async () => {
        const { page, calls } = await openCompleted();
        await page.waitForSelector("#lead:not([hidden])");
        await page.fill("#lead-email", "visiteur@example.fr");
        await page.click("#lead-form button");

        await eventually(() =>
          page.locator("#lead-error").textContent(),
        ).toContain("consentement");
        expect(calls.some((c) => c.path === "/leads")).toBe(false);
        await close();
      });

      it("refuses an invalid email", async () => {
        const { page, calls } = await openCompleted();
        await page.waitForSelector("#lead:not([hidden])");
        await page.fill("#lead-email", "pas-un-email");
        await page.check("#lead-consent");
        await page.click("#lead-form button");

        await eventually(() =>
          page.locator("#lead-error").textContent(),
        ).toContain("email valide");
        expect(calls.some((c) => c.path === "/leads")).toBe(false);
        await close();
      });

      it("posts the lead with consent and campaign, then confirms", async () => {
        const { page, calls } = await openCompleted("&utm_source=linkedin&x=1");
        await page.waitForSelector("#lead:not([hidden])");
        await page.fill("#lead-email", "visiteur@example.fr");
        await page.check("#lead-consent");
        await page.click("#lead-form button");

        await eventually(() => page.locator("#lead-done").isVisible()).toBe(
          true,
        );
        expect(calls.find((c) => c.path === "/leads")?.body).toEqual({
          email: "visiteur@example.fr",
          auditId: AUDIT_ID,
          consent: true,
          source: "audit-page",
          utm: { utm_source: "linkedin" },
        });
        expect(await axeViolations(page)).toEqual([]);
        await close();
      });

      it("keeps the form and explains when the service is unavailable", async () => {
        const { page } = await open(`/audit/?id=${AUDIT_ID}`, (call) =>
          call.path === "/leads"
            ? {
                status: 503,
                body: { error: "queue_unavailable", message: "x" },
              }
            : happyPath({ statuses: [] })(call),
        );
        await page.waitForSelector("#lead:not([hidden])");
        await page.fill("#lead-email", "visiteur@example.fr");
        await page.check("#lead-consent");
        await page.click("#lead-form button");

        await eventually(() =>
          page.locator("#lead-error").textContent(),
        ).toContain("Réessayez");
        await eventually(() => page.locator("#lead-form").isVisible()).toBe(
          true,
        );
        await close();
      });
    });
  });

  describe("EAA questionnaire", () => {
    it("asks for every answer", async () => {
      const { page } = await open("/suis-je-concerne/");
      await page.click("#eaa-form button");

      await eventually(() => page.locator("#eaa-error").isVisible()).toBe(true);
      await close();
    });

    it("gives a verdict with its caveat and moves focus to it", async () => {
      const { page } = await open("/suis-je-concerne/");
      await page.check("#audience-0");
      await page.check("#offer-0");
      await page.check("#size-1");
      await page.click("#eaa-form button");

      await eventually(() => page.locator("#eaa-result h2").textContent()).toBe(
        "Probablement concerné",
      );
      await eventually(() =>
        page.locator("#eaa-result .notice").textContent(),
      ).toContain("pas un avis juridique");
      expect(await page.evaluate(() => document.activeElement?.id)).toBe(
        "eaa-result",
      );
      expect(await axeViolations(page)).toEqual([]);
      await close();
    });

    it("recognises the microenterprise exemption", async () => {
      const { page } = await open("/suis-je-concerne/");
      await page.check("#audience-0");
      await page.check("#offer-0");
      await page.check("#size-0");
      await page.click("#eaa-form button");

      await eventually(() =>
        page.locator("#eaa-result h2").textContent(),
      ).toContain("exempté");
      await close();
    });
  });
});
