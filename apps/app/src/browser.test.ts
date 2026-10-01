import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { PLAN_LIMITS, type Task } from "@accessibility/contracts";
import type {
  ManualCheckList,
  Statement,
  Audit,
  AuditReport,
  Finding,
  Me,
  Site,
} from "@accessibility/contracts";
import {
  axeViolations,
  chromiumAvailable,
  eventually,
  mockApi,
  serveDist,
  type ApiCall,
  type ApiHandler,
  type StaticServer,
} from "./test/browser.js";
import { TEST_API_URL } from "./test/global-setup.js";

const distDir = inject("distDir");
const ORG_ID = "11111111-1111-4111-8111-111111111111";
const SITE_ID = "22222222-2222-4222-8222-222222222222";
const AUDIT_ID = "33333333-3333-4333-8333-333333333333";
const FINDING_ID = "44444444-4444-4444-8444-444444444444";

const ME: Me = {
  user: {
    id: "55555555-5555-4555-8555-555555555555",
    email: "alice@example.fr",
  },
  organizations: [
    {
      id: ORG_ID,
      name: "Acme",
      role: "owner",
      plan: "free",
      limits: PLAN_LIMITS.free,
    },
  ],
};
const site = (patch: Partial<Site> = {}): Site => ({
  id: SITE_ID,
  orgId: ORG_ID,
  baseUrl: "https://acme.example",
  verifiedAt: null,
  verificationMethod: null,
  scanFrequency: null,
  nextScanAt: null,
  verification: {
    dnsRecord: {
      type: "TXT",
      name: "_clariaccess.acme.example",
      value: "clariaccess-verify=abc",
    },
    file: {
      path: "/.well-known/clariaccess-abc.txt",
      content: "clariaccess-verify=abc",
    },
  },
  ...patch,
});
const VERIFIED = site({
  verifiedAt: "2026-10-01T10:00:00.000Z",
  verificationMethod: "file",
});
const audit = (patch: Partial<Audit> = {}): Audit => ({
  id: AUDIT_ID,
  url: "https://acme.example",
  type: "manual",
  status: "completed",
  startedAt: "2026-10-01T10:00:00.000Z",
  finishedAt: "2026-10-01T10:02:00.000Z",
  pagesScanned: 3,
  score: 64,
  failureReason: null,
  ...patch,
});
const TASK_ID = "88888888-8888-4888-8888-888888888888";
const MEMBER = {
  id: "55555555-5555-4555-8555-555555555555",
  email: "alice@example.fr",
};
const task = (patch: Partial<Task> = {}): Task => ({
  id: TASK_ID,
  siteId: SITE_ID,
  ruleId: "image-alt",
  status: "todo",
  priorityScore: 12,
  openFindings: 3,
  pagesAffected: 2,
  assignee: null,
  guide: {
    summary: "Une image n'a pas d'alternative textuelle.",
    steps: [
      "Ajoutez un attribut alt.",
      "Utilisez alt vide pour une image décorative.",
    ],
    generic: false,
  },
  wcagCriteria: ["1.1.1"],
  rgaaCriteria: ["1.1"],
  updatedAt: "2026-10-01T10:02:00.000Z",
  ...patch,
});
const proMe = (): Me => ({
  ...ME,
  organizations: [
    { ...ME.organizations[0]!, plan: "pro", limits: PLAN_LIMITS.pro },
  ],
});

const THEMES = [
  { number: 1, title: "Images" },
  { number: 2, title: "Cadres" },
];
const crit = (
  id: string,
  theme: number,
  patch: Partial<ManualCheckList["criteria"][number]> = {},
): ManualCheckList["criteria"][number] => ({
  id,
  theme,
  title: `Titre du critère ${id} ?`,
  autoTested: id === "1.1",
  axeRules: id === "1.1" ? ["image-alt"] : [],
  autoProblems: 0,
  check: null,
  ...patch,
});
const checked = (status: "ok" | "ko" | "na", notes = "") => ({
  status,
  notes,
  evidenceUrl: null,
  checkedBy: "alice@example.fr",
  checkedAt: "2026-10-02T10:00:00.000Z",
});
const manualList = (
  criteria: ManualCheckList["criteria"],
): ManualCheckList => ({
  referentialVersion: "4.1",
  themes: THEMES,
  criteria,
  progress: {
    checked: criteria.filter((c) => c.check !== null).length,
    total: criteria.length,
  },
});
const STATEMENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const statement = (patch: Partial<Statement> = {}): Statement => ({
  id: STATEMENT_ID,
  siteId: SITE_ID,
  version: 1,
  status: "draft",
  computedStatus: "partiel",
  declaredStatus: null,
  complianceRate: 97,
  allowedStatuses: ["partiel", "non"],
  counts: { conforme: 100, nonConforme: 3, na: 3, aVerifier: 0 },
  unattributed: 0,
  entityName: "Acme",
  contactEmail: null,
  contactUrl: null,
  derogations: null,
  samplePages: ["https://acme.example/"],
  technologies: null,
  testEnvironment: null,
  tools: null,
  nonAccessibleContent: [
    {
      criterionId: "1.1",
      title: "Titre du critère 1.1 ?",
      sources: ["manual"],
      notes: "",
    },
  ],
  locale: "fr",
  referentialVersion: "4.1",
  missing: ["contact", "technologies", "testEnvironment", "tools"],
  publicPath: null,
  pdfReady: false,
  publishedAt: null,
  createdAt: "2026-10-02T10:00:00.000Z",
  updatedAt: "2026-10-02T10:00:00.000Z",
  ...patch,
});
const finding = (patch: Partial<Finding> = {}): Finding => ({
  id: FINDING_ID,
  siteId: SITE_ID,
  pageUrl: "https://acme.example/",
  ruleId: "image-alt",
  impact: "serious",
  status: "open",
  selector: "img.hero",
  htmlExcerpt: "<img>",
  message: "Images must have alternate text",
  firstSeenAuditId: AUDIT_ID,
  lastSeenAuditId: AUDIT_ID,
  priorityScore: 6,
  updatedAt: "2026-10-01T10:02:00.000Z",
  ...patch,
});

// Markup that would run script if rendered as HTML, or a link that would if
// put in an href unchecked.
const XSS = `<img src=x onerror="window.__xss=true">`;
const REPORT: AuditReport = {
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

const json = (status: number, body?: unknown) => ({ status, body });
const err = (status: number, error: string, message: string) =>
  json(status, { error, message });

// A small in-memory backend. `overrides` replace the answer of one endpoint.
function backend(
  overrides: Record<string, (call: ApiCall) => ReturnType<ApiHandler>> = {},
  state: { signedIn: boolean; site: Site } = { signedIn: true, site: VERIFIED },
): ApiHandler {
  const table: Record<string, (call: ApiCall) => ReturnType<ApiHandler>> = {
    "GET /me": () =>
      state.signedIn
        ? json(200, ME)
        : err(401, "unauthorized", "Connexion requise."),
    "POST /auth/logout": () => {
      state.signedIn = false;
      return json(204);
    },
    "GET /orgs/{org}/sites": () => json(200, [state.site]),
    [`GET /sites/${SITE_ID}`]: () => json(200, state.site),
    [`GET /sites/${SITE_ID}/audits`]: () => json(200, [audit()]),
    [`GET /audits/${AUDIT_ID}`]: () => json(200, audit()),
    [`GET /audits/${AUDIT_ID}/pages`]: () =>
      json(200, [
        { url: "https://acme.example/", status: "done" },
        { url: "https://acme.example/contact", status: "failed" },
      ]),
    [`GET /audits/${AUDIT_ID}/report`]: () => json(200, REPORT),
    [`GET /sites/${SITE_ID}/findings`]: () =>
      json(200, { items: [finding()], total: 1 }),
    [`GET /sites/${SITE_ID}/tasks`]: () =>
      json(200, { items: [task()], total: 1 }),
    "GET /orgs/{org}/members": () => json(200, [MEMBER]),
    [`GET /sites/${SITE_ID}/manual-checks`]: () =>
      json(
        200,
        manualList([
          crit("1.1", 1),
          crit("1.2", 1),
          crit("2.1", 2, { check: checked("ok") }),
        ]),
      ),
    [`GET /sites/${SITE_ID}/statements`]: () => json(200, [statement()]),
    [`PUT /sites/${SITE_ID}/manual-checks/1.1`]: () => json(204),
    ...overrides,
  };
  return (call) => {
    const generic = call.path.replace(ORG_ID, "{org}");
    const handler =
      table[`${call.method} ${call.path}`] ??
      table[`${call.method} ${generic}`];
    return handler ? handler(call) : err(404, "not_found", "Introuvable.");
  };
}

describe.skipIf(!chromiumAvailable())("customer app in a browser", () => {
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

  const open = async (path: string, handler: ApiHandler = backend()) => {
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

  describe("every screen is accessible (axe, WCAG 2.1 A and AA) and has one h1", () => {
    const screens: [
      string,
      string,
      Record<string, (c: ApiCall) => ReturnType<ApiHandler>>?,
    ][] = [
      ["login", "/login"],
      ["login link without token", "/auth/callback"],
      ["new organization", "/orgs/new"],
      ["organization sites", `/orgs/${ORG_ID}`],
      [
        "unverified site",
        `/sites/${SITE_ID}`,
        { [`GET /sites/${SITE_ID}`]: () => json(200, site()) },
      ],
      ["verified site with history", `/sites/${SITE_ID}`],
      ["audit with report", `/audits/${AUDIT_ID}`],
      ["findings", `/sites/${SITE_ID}/findings`],
      ["correction plan", `/sites/${SITE_ID}/tasks`],
      ["manual audit", `/sites/${SITE_ID}/audit-manuel`],
      [
        "manual audit with a criterion contradicted by the scan",
        `/sites/${SITE_ID}/audit-manuel`,
        {
          [`GET /sites/${SITE_ID}/manual-checks`]: () =>
            json(
              200,
              manualList([
                crit("1.1", 1, { autoProblems: 2, check: checked("ok") }),
                crit("1.2", 1),
              ]),
            ),
        },
      ],
      ["statement draft", `/sites/${SITE_ID}/declaration`],
      [
        "statement with no draft",
        `/sites/${SITE_ID}/declaration`,
        { [`GET /sites/${SITE_ID}/statements`]: () => json(200, []) },
      ],
      [
        "published statement and history",
        `/sites/${SITE_ID}/declaration`,
        {
          [`GET /sites/${SITE_ID}/statements`]: () =>
            json(200, [
              statement({
                status: "published",
                declaredStatus: "partiel",
                publicPath: "/d/abcdefghijklmnopqrst",
                pdfReady: true,
                publishedAt: "2026-10-02T10:00:00.000Z",
                missing: [],
                allowedStatuses: [],
              }),
              statement({
                id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                version: 0 + 1,
                status: "superseded",
                declaredStatus: "non",
                publicPath: "/d/zzzzzzzzzzzzzzzzzzzz",
                publishedAt: "2026-09-01T10:00:00.000Z",
              }),
            ]),
        },
      ],
      [
        "verified pro site with a schedule",
        `/sites/${SITE_ID}`,
        {
          "GET /me": () => json(200, proMe()),
          [`GET /sites/${SITE_ID}`]: () =>
            json(
              200,
              site({
                ...VERIFIED,
                scanFrequency: "daily",
                nextScanAt: "2026-10-02T10:00:00.000Z",
              }),
            ),
        },
      ],
    ];

    it.each(screens)("%s", async (_name, path, overrides) => {
      const { page } = await open(path, backend(overrides));
      await page.waitForSelector("h1");
      // Wait for the data the screen shows, not just the heading.
      await page.waitForLoadState("networkidle");

      expect(await page.locator("h1").count()).toBe(1);
      expect(await axeViolations(page)).toEqual([]);
      await close();
    });
  });

  describe("signing in", () => {
    it("sends the link request and answers the same whatever the address", async () => {
      const { page, calls } = await open(
        "/login",
        backend({ "POST /auth/login": () => json(202) }),
      );
      await page.fill("#login-email", "  alice@example.fr ");
      await page.click("button[type=submit]");

      await eventually(() =>
        page.locator("[role=status]").textContent(),
      ).toContain("un lien vient de vous être envoyé");
      expect(calls.find((c) => c.path === "/auth/login")?.body).toEqual({
        email: "alice@example.fr",
      });
      expect(await axeViolations(page)).toEqual([]);
      await close();
    });

    it("shows the API's message and links it to the field when the request is refused", async () => {
      const { page } = await open(
        "/login",
        backend({
          "POST /auth/login": () =>
            err(429, "rate_limited", "Trop de requêtes. Réessayez plus tard."),
        }),
      );
      await page.fill("#login-email", "alice@example.fr");
      await page.click("button[type=submit]");

      await eventually(() =>
        page.locator("#login-error").textContent(),
      ).toContain("Trop de requêtes");
      expect(await page.getAttribute("#login-email", "aria-invalid")).toBe(
        "true",
      );
      expect(await page.getAttribute("#login-email", "aria-describedby")).toBe(
        "login-error",
      );
      await close();
    });

    it("signs in from the emailed link, once, then lands on the organization", async () => {
      const state = { signedIn: false, site: VERIFIED };
      const { page, calls } = await open(
        "/auth/callback?token=abc123",
        backend(
          {
            "POST /auth/verify": () => ((state.signedIn = true), json(200, ME)),
          },
          state,
        ),
      );

      await page.waitForURL(new RegExp(`/orgs/${ORG_ID}$`));
      await eventually(() => page.locator("h1").textContent()).toContain(
        "Acme",
      );
      expect(calls.filter((c) => c.path === "/auth/verify")).toHaveLength(1);
      expect(calls.find((c) => c.path === "/auth/verify")?.body).toEqual({
        token: "abc123",
      });
      await close();
    });

    it("explains an expired link and offers a new one", async () => {
      const { page } = await open(
        "/auth/callback?token=old",
        backend({
          "POST /auth/verify": () =>
            err(
              400,
              "invalid_token",
              "Ce lien est invalide ou a expiré. Demandez-en un nouveau.",
            ),
        }),
      );

      await eventually(() =>
        page.locator("[role=alert]").textContent(),
      ).toContain("a expiré");
      expect(
        await page
          .locator("a", { hasText: "nouveau lien" })
          .getAttribute("href"),
      ).toBe("/login");
      await close();
    });

    it("does not call the API when the link has no token", async () => {
      const { page, calls } = await open("/auth/callback");

      await eventually(() =>
        page.locator("[role=alert]").textContent(),
      ).toContain("incomplet");
      expect(calls.some((c) => c.path === "/auth/verify")).toBe(false);
      await close();
    });

    it("sends a signed-out visitor to the login page", async () => {
      const { page } = await open(
        `/sites/${SITE_ID}`,
        backend({}, { signedIn: false, site: VERIFIED }),
      );

      await page.waitForURL(/\/login$/);
      expect(await page.locator("h1").textContent()).toBe("Connexion");
      await close();
    });

    it("signs out", async () => {
      const { page, calls } = await open(`/orgs/${ORG_ID}`);
      await page.click("text=Se déconnecter");

      await page.waitForURL(/\/login$/);
      expect(
        calls.some((c) => c.method === "POST" && c.path === "/auth/logout"),
      ).toBe(true);
      await close();
    });
  });

  describe("organizations and sites", () => {
    it("sends a new user to create an organization, then to its page", async () => {
      const state = { orgs: [] as Me["organizations"] };
      const { page, calls } = await open("/", (call) => {
        if (call.path === "/me")
          return json(200, { ...ME, organizations: state.orgs });
        if (call.method === "POST" && call.path === "/orgs") {
          state.orgs = [ME.organizations[0]!];
          return json(201, state.orgs[0]);
        }
        return backend()(call);
      });

      await page.waitForURL(/\/orgs\/new$/);
      await page.fill("#org-name", "Acme");
      await page.click("button[type=submit]");

      await page.waitForURL(new RegExp(`/orgs/${ORG_ID}$`));
      expect(
        calls.find((c) => c.path === "/orgs" && c.method === "POST")?.body,
      ).toEqual({ name: "Acme" });
      await close();
    });

    it("lists the sites with their verification state and adds one", async () => {
      const added: Site[] = [];
      const { page, calls } = await open(
        `/orgs/${ORG_ID}`,
        backend({
          "GET /orgs/{org}/sites": () => json(200, [VERIFIED, ...added]),
          "POST /orgs/{org}/sites": (call) => {
            const created = site({
              id: "66666666-6666-4666-8666-666666666666",
              baseUrl: (call.body as { baseUrl: string }).baseUrl,
            });
            added.push(created);
            return json(201, created);
          },
        }),
      );
      await eventually(() => page.locator("ul.cards").textContent()).toContain(
        "Propriété vérifiée",
      );

      await page.fill("#site-url", "https://shop.example");
      await page.click("button[type=submit]");

      await eventually(() => page.locator("ul.cards").textContent()).toContain(
        "https://shop.example",
      );
      expect(calls.find((c) => c.method === "POST")?.body).toEqual({
        baseUrl: "https://shop.example",
      });
      expect(await page.inputValue("#site-url")).toBe("");
      await close();
    });

    it("shows why a site cannot be added, tied to the field", async () => {
      const { page } = await open(
        `/orgs/${ORG_ID}`,
        backend({
          "POST /orgs/{org}/sites": () =>
            err(
              409,
              "already_exists",
              "Ce site est déjà dans votre organisation.",
            ),
        }),
      );
      await page.fill("#site-url", "https://acme.example");
      await page.click("button[type=submit]");

      await eventually(() =>
        page.locator("#site-url-error").textContent(),
      ).toContain("déjà");
      expect(
        await page.getAttribute("#site-url", "aria-describedby"),
      ).toContain("site-url-error");
      expect(await axeViolations(page)).toEqual([]);
      await close();
    });
  });

  describe("proving ownership", () => {
    it("shows both ways to prove it and picks up the verification", async () => {
      const state = { site: site(), verifyCalled: false };
      const { page, calls } = await open(
        `/sites/${SITE_ID}`,
        backend({
          [`GET /sites/${SITE_ID}`]: () => json(200, state.site),
          [`POST /sites/${SITE_ID}/verify`]: () => {
            state.verifyCalled = true;
            // The worker finds the proof a moment later.
            setTimeout(() => (state.site = VERIFIED), 1500);
            return json(202, state.site);
          },
        }),
      );
      await eventually(() => page.locator("main").textContent()).toContain(
        "_clariaccess.acme.example",
      );
      const text = await page.locator("main").textContent();
      expect(text).toContain("/.well-known/clariaccess-abc.txt");
      expect(text).toContain("clariaccess-verify=abc");
      expect(
        await page
          .locator("button", { hasText: "Lancer un audit" })
          .isDisabled(),
      ).toBe(true);

      await page.click("text=Vérifier maintenant");

      await eventually(
        () => page.locator("main").textContent(),
        15_000,
      ).toContain("Propriété vérifiée le");
      expect(
        calls.some((c) => c.method === "POST" && c.path.endsWith("/verify")),
      ).toBe(true);
      await eventually(() =>
        page.locator("button", { hasText: "Lancer un audit" }).isEnabled(),
      ).toBe(true);
      await close();
    });

    it("tells the user when the proof was not found, after a while", async () => {
      context = await browser.newContext({ locale: "fr-FR" });
      const page = await context.newPage();
      await page.clock.install();
      await mockApi(
        page,
        TEST_API_URL,
        backend({
          [`GET /sites/${SITE_ID}`]: () => json(200, site()),
          [`POST /sites/${SITE_ID}/verify`]: () => json(202, site()),
        }),
      );
      await page.goto(`${server.origin}/sites/${SITE_ID}`);
      await page.click("text=Vérifier maintenant");
      await eventually(() =>
        page.locator("[role=status]").allTextContents(),
      ).toContain("Recherche de la preuve sur votre site…");

      await page.clock.fastForward(35_000);

      await eventually(() =>
        page.locator("[role=alert]").textContent(),
      ).toContain("La preuve n'a pas été trouvée");
      await eventually(() =>
        page.locator("button", { hasText: "Vérifier maintenant" }).isEnabled(),
      ).toBe(true);
      await close();
    });
  });

  describe("audits", () => {
    it("launches an audit and shows it in the history", async () => {
      const audits: Audit[] = [];
      const { page, calls } = await open(
        `/sites/${SITE_ID}`,
        backend({
          [`GET /sites/${SITE_ID}/audits`]: () => json(200, audits),
          [`POST /sites/${SITE_ID}/audits`]: () => {
            audits.unshift(
              audit({
                status: "queued",
                startedAt: null,
                finishedAt: null,
                score: null,
                pagesScanned: 0,
              }),
            );
            return json(202, audits[0]);
          },
        }),
      );
      await eventually(() => page.locator("main").textContent()).toContain(
        "Aucun audit pour l'instant",
      );

      await page.click("text=Lancer un audit");

      await eventually(() => page.locator("table").textContent()).toContain(
        "En attente",
      );
      expect(
        calls.some((c) => c.method === "POST" && c.path.endsWith("/audits")),
      ).toBe(true);
      // One audit at a time: the button waits for it.
      await eventually(() =>
        page.locator("button", { hasText: "Lancer un audit" }).isDisabled(),
      ).toBe(true);
      await close();
    });

    it("shows the reason when an audit cannot be started", async () => {
      const { page } = await open(
        `/sites/${SITE_ID}`,
        backend({
          [`POST /sites/${SITE_ID}/audits`]: () =>
            err(
              429,
              "rate_limited",
              "Limite quotidienne d'audits atteinte pour ce site. Réessayez demain.",
            ),
        }),
      );
      await page.click("text=Lancer un audit");

      await eventually(() =>
        page.locator("[role=alert]").textContent(),
      ).toContain("Limite quotidienne");
      await close();
    });

    it("shows the audit, its pages and a report whose content is never interpreted", async () => {
      const { page, dialogs } = await open(`/audits/${AUDIT_ID}`);

      await eventually(() => page.locator("#report-title").textContent()).toBe(
        "Score automatisé : 64/100",
      );
      expect(await page.locator("main").textContent()).toContain(
        "une partie des critères",
      );
      expect(await page.locator("table tbody tr").allTextContents()).toEqual([
        "https://acme.example/Analysée",
        "https://acme.example/contactNon analysée",
      ]);
      expect(await page.locator("h4").first().textContent()).toContain(
        "Images sans alternative",
      );
      expect(await page.locator("main img").count()).toBe(0);
      expect(
        await page.evaluate(() => (window as { __xss?: boolean }).__xss),
      ).toBeUndefined();
      expect(dialogs).toEqual([]);
      const links = await page
        .locator("main .issues a")
        .evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
      expect(links).toEqual([
        "https://dequeuniversity.com/rules/axe/4.10/color-contrast",
      ]);
      await close();
    });

    it("explains a failed audit and shows no report", async () => {
      const { page } = await open(
        `/audits/${AUDIT_ID}`,
        backend({
          [`GET /audits/${AUDIT_ID}`]: () =>
            json(
              200,
              audit({
                status: "failed",
                failureReason: "robots_disallowed",
                score: null,
              }),
            ),
        }),
      );

      await eventually(() =>
        page.locator("[role=alert]").textContent(),
      ).toContain("robots.txt");
      expect(await page.locator("#report-title").count()).toBe(0);
      await close();
    });

    it("says so when the audit does not exist", async () => {
      const { page } = await open(
        "/audits/99999999-9999-4999-8999-999999999999",
        (call) =>
          call.path.startsWith("/audits/")
            ? err(404, "not_found", "Audit introuvable.")
            : backend()(call),
      );

      await eventually(() =>
        page.locator("[role=alert]").textContent(),
      ).toContain("introuvable");
      await close();
    });
  });

  describe("findings", () => {
    it("lists findings with their state in words, and filters on the server", async () => {
      const { page, calls } = await open(
        `/sites/${SITE_ID}/findings`,
        backend({
          [`GET /sites/${SITE_ID}/findings`]: (call) =>
            call.query.get("status") === "regressed"
              ? json(200, {
                  items: [finding({ status: "regressed" })],
                  total: 1,
                })
              : json(200, {
                  items: [
                    finding(),
                    finding({
                      id: "77777777-7777-4777-8777-777777777777",
                      status: "fixed",
                    }),
                  ],
                  total: 2,
                }),
        }),
      );
      await eventually(() => page.locator("main").textContent()).toContain(
        "2 problèmes",
      );
      expect(
        await page.locator("ol.issues li").first().textContent(),
      ).toContain("Ouvert");

      await page.selectOption("#status-filter", "regressed");

      await eventually(() => page.locator("main").textContent()).toContain(
        "1 problème",
      );
      expect(
        await page.locator("ol.issues li").first().textContent(),
      ).toContain("Régression");
      expect(calls.some((c) => c.query.get("status") === "regressed")).toBe(
        true,
      );
      await close();
    });

    it("ignores a finding, announces it and keeps focus on the list", async () => {
      const state = { status: "open" as Finding["status"] };
      const { page, calls } = await open(
        `/sites/${SITE_ID}/findings`,
        backend({
          [`GET /sites/${SITE_ID}/findings`]: () =>
            json(200, { items: [finding({ status: state.status })], total: 1 }),
          [`PATCH /findings/${FINDING_ID}`]: (call) => {
            state.status = (call.body as { status: Finding["status"] }).status;
            return json(200, finding({ status: state.status }));
          },
        }),
      );
      await page.click("button:has-text('Ignorer')");

      await eventually(() =>
        page.locator("[role=status].sr-only").textContent(),
      ).toBe("Constat ignoré.");
      await eventually(() =>
        page.locator("ol.issues li").first().textContent(),
      ).toContain("Ignoré");
      expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({
        status: "ignored",
      });
      expect(
        await page.evaluate(() => document.activeElement?.tagName),
      ).not.toBe("BODY");
      await eventually(() =>
        page.locator("button:has-text('Rouvrir')").count(),
      ).toBe(1);
      expect(await axeViolations(page)).toEqual([]);
      await close();
    });

    it("shows the reason when a change is refused", async () => {
      const { page } = await open(
        `/sites/${SITE_ID}/findings`,
        backend({
          [`PATCH /findings/${FINDING_ID}`]: () =>
            err(
              409,
              "invalid_transition",
              "Ce constat ne peut pas passer à ce statut.",
            ),
        }),
      );
      await page.click("button:has-text('Ignorer')");

      await eventually(() =>
        page.locator("[role=alert]").textContent(),
      ).toContain("ne peut pas passer");
      await close();
    });

    it("loads the rest of a long list on request", async () => {
      const many = (from: number, n: number) =>
        Array.from({ length: n }, (_, i) =>
          finding({
            id: `00000000-0000-4000-8000-${String(from + i).padStart(12, "0")}`,
            selector: `img.n${from + i}`,
          }),
        );
      const { page, calls } = await open(
        `/sites/${SITE_ID}/findings`,
        backend({
          [`GET /sites/${SITE_ID}/findings`]: (call) =>
            call.query.get("offset") === "50"
              ? json(200, { items: many(50, 10), total: 60 })
              : json(200, { items: many(0, 50), total: 60 }),
        }),
      );
      await eventually(() => page.locator("ol.issues li").count()).toBe(50);

      await page.click("button:has-text('Afficher plus')");

      await eventually(() => page.locator("ol.issues li").count()).toBe(60);
      expect(
        await page.locator("button:has-text('Afficher plus')").count(),
      ).toBe(0);
      expect(calls.some((c) => c.query.get("offset") === "50")).toBe(true);
      await close();
    });
  });

  describe("plan and schedule", () => {
    it("shows the plan, what it allows, and that Pro is not for sale yet", async () => {
      const { page } = await open(`/orgs/${ORG_ID}`);

      await eventually(() => page.locator("#plan-title").textContent()).toBe(
        "Formule : Gratuit",
      );
      const text = await page.locator("main").textContent();
      expect(text).toContain("1 site");
      expect(text).toContain("Aucun re-scan programmé");
      expect(text).toContain("bientôt disponible");
      expect(
        await page
          .locator("button, a", { hasText: /acheter|payer|souscrire/i })
          .count(),
      ).toBe(0);
      await close();
    });

    it("shows a pro organization without the upsell", async () => {
      const { page } = await open(
        `/orgs/${ORG_ID}`,
        backend({ "GET /me": () => json(200, proMe()) }),
      );

      await eventually(() => page.locator("#plan-title").textContent()).toBe(
        "Formule : Pro",
      );
      expect(await page.locator("main").textContent()).not.toContain(
        "bientôt disponible",
      );
      await close();
    });

    it("explains that re-scans need the Pro plan instead of hiding them", async () => {
      const { page } = await open(`/sites/${SITE_ID}`);

      await eventually(() =>
        page.locator("#schedule-frequency option").allTextContents(),
      ).toEqual([
        "Aucun re-scan",
        "Chaque semaine (Disponible avec la formule Pro.)",
        "Chaque jour (Disponible avec la formule Pro.)",
      ]);
      expect(
        await page
          .locator("#schedule-frequency option[value=daily]")
          .isDisabled(),
      ).toBe(true);
      expect(
        await page
          .locator("button", { hasText: "Enregistrer la fréquence" })
          .isDisabled(),
      ).toBe(true);
      await close();
    });

    it("lets a pro organization schedule re-scans and shows the next one", async () => {
      const state = { site: VERIFIED };
      const { page, calls } = await open(
        `/sites/${SITE_ID}`,
        backend({
          "GET /me": () => json(200, proMe()),
          [`GET /sites/${SITE_ID}`]: () => json(200, state.site),
          [`PUT /sites/${SITE_ID}/schedule`]: (call) => {
            state.site = site({
              ...VERIFIED,
              scanFrequency: (call.body as { frequency: "daily" }).frequency,
              nextScanAt: "2026-10-02T10:00:00.000Z",
            });
            return json(200, state.site);
          },
        }),
      );
      await eventually(() =>
        page.locator("#schedule-frequency").isEnabled(),
      ).toBe(true);

      await page.selectOption("#schedule-frequency", "daily");
      await page.click("text=Enregistrer la fréquence");

      await eventually(() =>
        page.locator("#schedule-hint").textContent(),
      ).toContain("Chaque jour · prochain audit vers le 2 octobre 2026");
      expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
        frequency: "daily",
      });
      await eventually(() =>
        page
          .locator("[role=status]", { hasText: "Fréquence enregistrée." })
          .count(),
      ).toBe(1);
      await close();
    });

    it("switches re-scans off with null", async () => {
      const { page, calls } = await open(
        `/sites/${SITE_ID}`,
        backend({
          "GET /me": () => json(200, proMe()),
          [`GET /sites/${SITE_ID}`]: () =>
            json(
              200,
              site({
                ...VERIFIED,
                scanFrequency: "weekly",
                nextScanAt: "2026-10-08T10:00:00.000Z",
              }),
            ),
          [`PUT /sites/${SITE_ID}/schedule`]: () => json(200, VERIFIED),
        }),
      );
      await eventually(() =>
        page.locator("#schedule-frequency").inputValue(),
      ).toBe("weekly");

      await page.selectOption("#schedule-frequency", "");
      await page.click("text=Enregistrer la fréquence");

      await eventually(
        async () => calls.filter((c) => c.method === "PUT").length,
      ).toBe(1);
      expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
        frequency: null,
      });
      await close();
    });

    it("says a kept schedule is suspended when the plan no longer includes it", async () => {
      const { page } = await open(
        `/sites/${SITE_ID}`,
        backend({
          [`GET /sites/${SITE_ID}`]: () =>
            json(
              200,
              site({
                ...VERIFIED,
                scanFrequency: "daily",
                nextScanAt: "2026-10-02T10:00:00.000Z",
              }),
            ),
        }),
      );

      await eventually(() => page.locator("main").textContent()).toContain(
        "programmation est suspendue",
      );
      await close();
    });

    it("shows the reason when the plan refuses the schedule", async () => {
      const { page } = await open(
        `/sites/${SITE_ID}`,
        backend({
          "GET /me": () => json(200, proMe()),
          [`PUT /sites/${SITE_ID}/schedule`]: () =>
            err(
              403,
              "plan_required",
              "Les audits programmés ne sont pas inclus dans votre formule.",
            ),
        }),
      );
      await eventually(() =>
        page.locator("#schedule-frequency").isEnabled(),
      ).toBe(true);
      await page.selectOption("#schedule-frequency", "weekly");
      await page.click("text=Enregistrer la fréquence");

      await eventually(() =>
        page.locator("#schedule-error").textContent(),
      ).toContain("pas inclus");
      expect(await axeViolations(page)).toEqual([]);
      await close();
    });

    it("shows the reason when the plan allows no more sites", async () => {
      const { page } = await open(
        `/orgs/${ORG_ID}`,
        backend({
          "POST /orgs/{org}/sites": () =>
            err(
              403,
              "plan_limit",
              "Votre formule ne permet pas d'ajouter d'autre site.",
            ),
        }),
      );
      await page.fill("#site-url", "https://more.example");
      await page.click("button[type=submit]");

      await eventually(() =>
        page.locator("#site-url-error").textContent(),
      ).toContain("formule");
      await close();
    });
  });

  describe("correction plan", () => {
    it("lists the tasks with their priority, advice and criteria", async () => {
      const { page } = await open(`/sites/${SITE_ID}/tasks`);

      await eventually(() => page.locator("ol.issues > li").count()).toBe(1);
      const text = await page.locator("ol.issues > li").first().textContent();
      expect(text).toContain("image-alt");
      expect(text).toContain("À faire");
      expect(text).toContain("3 problèmes sur 2 pages");
      expect(text).toContain("WCAG 1.1.1");
      expect(text).toContain("RGAA 1.1");
      expect(text).toContain("Ajoutez un attribut alt.");
      expect(await page.locator("details summary").textContent()).toBe(
        "Comment corriger",
      );
      await close();
    });

    it("moves a task along and announces it", async () => {
      const state = { status: "todo" as Task["status"] };
      const { page, calls } = await open(
        `/sites/${SITE_ID}/tasks`,
        backend({
          [`GET /sites/${SITE_ID}/tasks`]: () =>
            json(200, { items: [task({ status: state.status })], total: 1 }),
          [`PATCH /tasks/${TASK_ID}`]: (call) => {
            state.status = (call.body as { status: Task["status"] }).status;
            return json(200, task({ status: state.status }));
          },
        }),
      );
      await eventually(() =>
        page.locator(`#status-${TASK_ID}`).isEnabled(),
      ).toBe(true);

      await page.selectOption(`#status-${TASK_ID}`, "doing");

      await eventually(() =>
        page.locator("[role=status].sr-only").textContent(),
      ).toContain("image-alt");
      expect(calls.find((c) => c.method === "PATCH")?.body).toMatchObject({
        status: "doing",
      });
      await eventually(() =>
        page.locator(`#status-${TASK_ID}`).inputValue(),
      ).toBe("doing");
      await close();
    });

    it("assigns a task to a member, and unassigns it", async () => {
      const state: { assignee: Task["assignee"] } = { assignee: null };
      const { page, calls } = await open(
        `/sites/${SITE_ID}/tasks`,
        backend({
          [`GET /sites/${SITE_ID}/tasks`]: () =>
            json(200, {
              items: [task({ assignee: state.assignee })],
              total: 1,
            }),
          [`PATCH /tasks/${TASK_ID}`]: (call) => {
            const id = (call.body as { assigneeUserId: string | null })
              .assigneeUserId;
            state.assignee = id === null ? null : MEMBER;
            return json(200, task({ assignee: state.assignee }));
          },
        }),
      );
      await eventually(() =>
        page.locator(`#assignee-${TASK_ID} option`).count(),
      ).toBe(2);

      await page.selectOption(`#assignee-${TASK_ID}`, MEMBER.id);
      await eventually(() =>
        page.locator(`#assignee-${TASK_ID}`).inputValue(),
      ).toBe(MEMBER.id);
      await page.selectOption(`#assignee-${TASK_ID}`, "");

      await eventually(() =>
        page.locator(`#assignee-${TASK_ID}`).inputValue(),
      ).toBe("");
      expect(
        calls.filter((c) => c.method === "PATCH").map((c) => c.body),
      ).toEqual([{ assigneeUserId: MEMBER.id }, { assigneeUserId: null }]);
      await close();
    });

    it("filters by status on the server", async () => {
      const { page, calls } = await open(
        `/sites/${SITE_ID}/tasks`,
        backend({
          [`GET /sites/${SITE_ID}/tasks`]: (call) =>
            call.query.get("status") === "done"
              ? json(200, {
                  items: [task({ status: "done", priorityScore: 0 })],
                  total: 1,
                })
              : json(200, {
                  items: [
                    task(),
                    task({
                      id: "99999999-9999-4999-8999-999999999999",
                      ruleId: "label",
                    }),
                  ],
                  total: 2,
                }),
        }),
      );
      await eventually(() => page.locator("main").textContent()).toContain(
        "2 tâches",
      );

      await page.selectOption("#task-filter", "done");

      await eventually(() => page.locator("main").textContent()).toContain(
        "1 tâche",
      );
      expect(calls.some((c) => c.query.get("status") === "done")).toBe(true);
      await close();
    });

    it("shows the reason when a change is refused", async () => {
      const { page } = await open(
        `/sites/${SITE_ID}/tasks`,
        backend({
          [`PATCH /tasks/${TASK_ID}`]: () =>
            err(
              400,
              "invalid_assignee",
              "Cette personne ne fait pas partie de l'organisation.",
            ),
        }),
      );
      await eventually(() =>
        page.locator(`#status-${TASK_ID}`).isEnabled(),
      ).toBe(true);
      await page.selectOption(`#status-${TASK_ID}`, "done");

      await eventually(() =>
        page.locator("[role=alert]").textContent(),
      ).toContain("ne fait pas partie");
      await close();
    });

    it("says so when there is nothing to do yet", async () => {
      const { page } = await open(
        `/sites/${SITE_ID}/tasks`,
        backend({
          [`GET /sites/${SITE_ID}/tasks`]: () =>
            json(200, { items: [], total: 0 }),
        }),
      );

      await eventually(() => page.locator("main").textContent()).toContain(
        "Aucune tâche",
      );
      await close();
    });
  });

  describe("manual audit", () => {
    it("shows the reference, the progress and what the scan does and does not do", async () => {
      const { page } = await open(`/sites/${SITE_ID}/audit-manuel`);

      await eventually(() => page.locator("h1").textContent()).toBe(
        "Audit manuel RGAA 4.1",
      );
      const main = (await page.locator("main").textContent()) ?? "";
      expect(main).toContain("1 critère vérifié sur 3");
      expect(main).toContain("ne valide aucun critère");
      expect(main).toContain(
        "Le scan automatique examine ce critère (règles axe : image-alt)",
      );
      expect(main).toContain(
        "Ce critère ne peut être vérifié que manuellement.",
      );
      await eventually(() =>
        page.locator("select#theme-select option").allTextContents(),
      ).toEqual(["1. Images (0/2)", "2. Cadres (1/1)"]);
      await close();
    });

    it("records a check with notes and evidence, and announces it", async () => {
      const { page, calls } = await open(`/sites/${SITE_ID}/audit-manuel`);
      await eventually(() => page.locator("#legend-1-1").isVisible()).toBe(
        true,
      );

      await page.check('[id="1-1-ko"]');
      await page.fill("#notes-1-1", "Le logo n'a pas d'alternative.");
      await page.fill("#evidence-1-1", "https://example.fr/capture.png");
      await page.click("form[aria-labelledby=legend-1-1] button[type=submit]");

      await eventually(() =>
        page.locator("[role=status].sr-only").textContent(),
      ).toBe("Critère 1.1 enregistré.");
      expect(calls.find((c) => c.method === "PUT")).toMatchObject({
        path: `/sites/${SITE_ID}/manual-checks/1.1`,
        body: {
          status: "ko",
          notes: "Le logo n'a pas d'alternative.",
          evidenceUrl: "https://example.fr/capture.png",
        },
      });
      await close();
    });

    it("cannot save a criterion without a result", async () => {
      const { page } = await open(`/sites/${SITE_ID}/audit-manuel`);
      await eventually(() => page.locator("#legend-1-2").isVisible()).toBe(
        true,
      );

      expect(
        await page
          .locator("form[aria-labelledby=legend-1-2] button[type=submit]")
          .isDisabled(),
      ).toBe(true);
      await close();
    });

    it("warns that the scan contradicts a criterion marked compliant", async () => {
      const { page } = await open(
        `/sites/${SITE_ID}/audit-manuel`,
        backend({
          [`GET /sites/${SITE_ID}/manual-checks`]: () =>
            json(
              200,
              manualList([
                crit("1.1", 1, { autoProblems: 2, check: checked("ok") }),
                crit("1.2", 1),
              ]),
            ),
        }),
      );

      await eventually(() =>
        page.locator("form[aria-labelledby=legend-1-1]").textContent(),
      ).toContain(
        "Le scan signale 2 problèmes ouverts sur ce critère : il sera compté non conforme dans la déclaration, malgré votre vérification",
      );
      await close();
    });

    it("clears a check", async () => {
      const { page, calls } = await open(
        `/sites/${SITE_ID}/audit-manuel`,
        backend({
          [`GET /sites/${SITE_ID}/manual-checks`]: () =>
            json(
              200,
              manualList([crit("1.1", 1, { check: checked("ko", "n") })]),
            ),
          [`DELETE /sites/${SITE_ID}/manual-checks/1.1`]: () => json(204),
        }),
      );
      await eventually(() => page.locator("#legend-1-1").isVisible()).toBe(
        true,
      );

      await page.click("text=Effacer");

      await eventually(() =>
        page.locator("[role=status].sr-only").textContent(),
      ).toBe("Vérification du critère 1.1 effacée.");
      expect(calls.some((c) => c.method === "DELETE")).toBe(true);
      await close();
    });

    it("switches theme and filters to what is left to check", async () => {
      const { page } = await open(`/sites/${SITE_ID}/audit-manuel`);
      await eventually(() => page.locator("#legend-1-1").isVisible()).toBe(
        true,
      );

      await page.selectOption("#theme-select", "2");
      await eventually(() => page.locator("#legend-2-1").isVisible()).toBe(
        true,
      );
      expect(await page.locator("#legend-1-1").count()).toBe(0);

      await page.selectOption("#criteria-filter", "todo");
      await eventually(() => page.locator("main").textContent()).toContain(
        "Aucun critère à afficher",
      );
      await close();
    });

    it("shows the reason when a check is refused", async () => {
      const { page } = await open(
        `/sites/${SITE_ID}/audit-manuel`,
        backend({
          [`PUT /sites/${SITE_ID}/manual-checks/1.1`]: () =>
            err(400, "invalid_request", "Lien de preuve invalide."),
        }),
      );
      await eventually(() => page.locator("#legend-1-1").isVisible()).toBe(
        true,
      );
      await page.check('[id="1-1-ok"]');
      await page.click("form[aria-labelledby=legend-1-1] button[type=submit]");

      await eventually(() =>
        page.locator("[role=alert]").textContent(),
      ).toContain("Lien de preuve invalide.");
      await close();
    });
  });

  describe("accessibility statement", () => {
    it("explains what the audit supports, and what is missing before publishing", async () => {
      const { page } = await open(`/sites/${SITE_ID}/declaration`);

      await eventually(() => page.locator("#level-title").textContent()).toBe(
        "Brouillon, version 1",
      );
      const text = (await page.locator("main").textContent()) ?? "";
      expect(text).toContain("Partiellement conforme");
      expect(text).toContain("97 % des critères applicables conformes");
      expect(text).toContain("3 critères non conformes sur 103 applicables");
      expect(text).toContain("Contact (courriel ou page de contact)");
      expect(text).toContain("Outils d'évaluation");
      expect(text).toContain("engage son éditeur");
      await close();
    });

    it("only offers levels the audit supports, and no publication while it is incomplete", async () => {
      const { page } = await open(`/sites/${SITE_ID}/declaration`);
      await eventually(() =>
        page.locator("#declared option").allTextContents(),
      ).toEqual(["Choisir…", "Partiellement conforme", "Non conforme"]);
      await close();

      const incomplete = await open(
        `/sites/${SITE_ID}/declaration`,
        backend({
          [`GET /sites/${SITE_ID}/statements`]: () =>
            json(200, [
              statement({
                computedStatus: "indetermine",
                complianceRate: null,
                allowedStatuses: [],
                counts: { conforme: 0, nonConforme: 0, na: 0, aVerifier: 106 },
              }),
            ]),
        }),
      );
      await eventually(() =>
        incomplete.page.locator("main").textContent(),
      ).toContain("tant que l'audit n'est pas complet");
      expect(await incomplete.page.locator("#declared").count()).toBe(0);
      expect(await incomplete.page.locator("main").textContent()).toContain(
        "106 critères restent à vérifier",
      );
      await close();
    });

    it("saves the fields, one sample address per line", async () => {
      const { page, calls } = await open(
        `/sites/${SITE_ID}/declaration`,
        backend({
          [`PUT /statements/${STATEMENT_ID}`]: () => json(200, statement()),
        }),
      );
      await eventually(() => page.locator("#email").isVisible()).toBe(true);

      await page.fill("#email", "contact@acme.fr");
      await page.fill(
        "#sample",
        "https://acme.example/\n\nhttps://acme.example/contact",
      );
      await page.fill("#tools", "axe-core");
      await page.click("text=Enregistrer le brouillon");

      await eventually(() =>
        page
          .locator("[role=status]", { hasText: "Brouillon enregistré." })
          .count(),
      ).toBe(1);
      expect(calls.find((c) => c.method === "PUT")?.body).toMatchObject({
        contactEmail: "contact@acme.fr",
        samplePages: ["https://acme.example/", "https://acme.example/contact"],
        tools: "axe-core",
        technologies: null,
      });
      await close();
    });

    it("keeps Publish disabled until a level is chosen, the statement is complete and the commitment is confirmed", async () => {
      const complete = statement({
        missing: [],
        contactEmail: "a@b.fr",
        technologies: "HTML",
        testEnvironment: "Firefox",
        tools: "axe",
      });
      const { page, calls } = await open(
        `/sites/${SITE_ID}/declaration`,
        backend({
          [`GET /sites/${SITE_ID}/statements`]: () => json(200, [complete]),
          [`POST /statements/${STATEMENT_ID}/publish`]: () =>
            json(200, {
              ...complete,
              status: "published",
              declaredStatus: "partiel",
              publicPath: "/d/abcdefghijklmnopqrst",
              publishedAt: "2026-10-02T10:00:00.000Z",
            }),
        }),
      );
      const publish = page.locator("button", {
        hasText: "Publier la déclaration",
      });
      await eventually(() => publish.isVisible()).toBe(true);
      expect(await publish.isDisabled()).toBe(true);

      await page.selectOption("#declared", "partiel");
      expect(await publish.isDisabled()).toBe(true);
      await page.check("#confirm");
      expect(await publish.isDisabled()).toBe(false);
      await publish.click();

      await eventually(
        async () =>
          calls.filter(
            (c) => c.method === "POST" && c.path.endsWith("/publish"),
          ).length,
      ).toBe(1);
      expect(calls.find((c) => c.path.endsWith("/publish"))?.body).toEqual({
        declaredStatus: "partiel",
      });
      await close();
    });

    it("does not allow publishing while fields are missing, even with a level and the confirmation", async () => {
      const { page } = await open(`/sites/${SITE_ID}/declaration`);
      await eventually(() => page.locator("#declared").isVisible()).toBe(true);

      await page.selectOption("#declared", "partiel");
      await page.check("#confirm");

      expect(
        await page
          .locator("button", { hasText: "Publier la déclaration" })
          .isDisabled(),
      ).toBe(true);
      await close();
    });

    it("shows the reason when publishing is refused", async () => {
      const complete = statement({ missing: [] });
      const { page } = await open(
        `/sites/${SITE_ID}/declaration`,
        backend({
          [`GET /sites/${SITE_ID}/statements`]: () => json(200, [complete]),
          [`POST /statements/${STATEMENT_ID}/publish`]: () =>
            err(
              403,
              "owner_required",
              "Seul un propriétaire de l'organisation peut publier une déclaration.",
            ),
        }),
      );
      await eventually(() => page.locator("#declared").isVisible()).toBe(true);
      await page.selectOption("#declared", "partiel");
      await page.check("#confirm");
      await page.click("text=Publier la déclaration");

      await eventually(() =>
        page.locator("[role=alert]").textContent(),
      ).toContain("Seul un propriétaire");
      await close();
    });

    it("shows the statement in force with its public address and PDF, and the version history", async () => {
      const { page } = await open(
        `/sites/${SITE_ID}/declaration`,
        backend({
          [`GET /sites/${SITE_ID}/statements`]: () =>
            json(200, [
              statement({
                status: "published",
                declaredStatus: "partiel",
                publicPath: "/d/abcdefghijklmnopqrst",
                pdfReady: true,
                publishedAt: "2026-10-02T10:00:00.000Z",
                missing: [],
                allowedStatuses: [],
              }),
            ]),
        }),
      );

      await eventually(() => page.locator("#current-title").textContent()).toBe(
        "Déclaration en vigueur : version 1",
      );
      const links = await page
        .locator("main a")
        .evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
      expect(links).toContain("http://api.test/d/abcdefghijklmnopqrst");
      expect(links).toContain("http://api.test/d/abcdefghijklmnopqrst/pdf");
      expect(await page.locator("#history-title").textContent()).toBe(
        "Versions",
      );
      expect(await page.locator("table tbody tr").count()).toBe(1);
      await close();
    });

    it("creates a draft when there is none", async () => {
      const state = { statements: [] as Statement[] };
      const { page, calls } = await open(
        `/sites/${SITE_ID}/declaration`,
        backend({
          [`GET /sites/${SITE_ID}/statements`]: () =>
            json(200, state.statements),
          [`POST /sites/${SITE_ID}/statements`]: () => {
            state.statements = [statement()];
            return json(201, state.statements[0]);
          },
        }),
      );
      await eventually(() => page.locator("#new-title").textContent()).toBe(
        "Préparer la déclaration",
      );

      await page.click("text=Créer un brouillon");

      await eventually(() => page.locator("#level-title").textContent()).toBe(
        "Brouillon, version 1",
      );
      expect(calls.some((c) => c.method === "POST")).toBe(true);
      await close();
    });
  });
});
