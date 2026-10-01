import { AxeBuilder } from "@axe-core/playwright";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  renderStatementHtml,
  type PublicStatementView,
} from "@accessibility/contracts";
import { chromiumAvailable } from "../test/integration.js";

// The public statement is a page about accessibility: it must itself pass.
const base: PublicStatementView = {
  locale: "fr",
  siteUrl: "https://www.acme.fr",
  entityName: "Acme SAS",
  version: 2,
  publishedAt: "2026-10-02T09:30:00.000Z",
  declaredStatus: "partiel",
  rate: 97,
  referentialVersion: "4.1",
  counts: { conforme: 100, nonConforme: 3, na: 3, aVerifier: 0 },
  nonAccessible: [
    {
      criterionId: "1.1",
      title:
        "Chaque image porteuse d'information a-t-elle une alternative textuelle ?",
      sources: ["manual", "auto"],
      notes: "Le logo n'a pas d'alternative.\nLes cartes non plus.",
    },
    {
      criterionId: "3.2",
      title:
        "Le contraste entre la couleur du texte et la couleur de son arrière-plan est-il suffisamment élevé ?",
      sources: ["auto"],
      notes: "",
    },
  ],
  derogations: "Le lecteur vidéo d'un tiers.",
  technologies: "HTML5, CSS3, JavaScript",
  testEnvironment: "Firefox 130 avec NVDA 2024",
  tools: "axe-core, Colour Contrast Analyser",
  samplePages: ["https://www.acme.fr/", "https://www.acme.fr/contact"],
  contactEmail: "accessibilite@acme.fr",
  contactUrl: "https://www.acme.fr/contact",
  pdfPath: "/d/abcdefghijklmnopqrst/pdf",
  supersededBy: null,
};

const variants: [string, Partial<PublicStatementView>][] = [
  ["a partial statement with failures", {}],
  [
    "a total statement with nothing failing",
    {
      declaredStatus: "total",
      rate: 100,
      nonAccessible: [],
      derogations: null,
    },
  ],
  ["a non compliant statement", { declaredStatus: "non", rate: 0 }],
  ["a replaced version", { supersededBy: "/d/currentcurrentcurrent" }],
  [
    "a statement with only a contact page, no PDF",
    { contactEmail: null, pdfPath: null },
  ],
  [
    "hostile content",
    {
      entityName: `<script>alert(1)</script>Acme`,
      technologies: `<img src=x onerror=alert(1)>`,
      nonAccessible: [
        {
          criterionId: "1.1",
          title: "<b>t</b>",
          sources: ["manual"],
          notes: `"><script>1</script>`,
        },
      ],
    },
  ],
];

describe.skipIf(!chromiumAvailable())("the public statement page (axe)", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser.close();
  });

  it.each(variants)(
    "has no WCAG 2.1 A/AA violation: %s",
    async (_label, patch) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await page.setContent(renderStatementHtml({ ...base, ...patch }));
        const { violations } = await new AxeBuilder({ page })
          .withTags([
            "wcag2a",
            "wcag2aa",
            "wcag21a",
            "wcag21aa",
            "best-practice",
          ])
          .analyze();

        expect(
          violations.map(
            (v) =>
              `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
          ),
        ).toEqual([]);
      } finally {
        await context.close();
      }
    },
  );

  it("is readable at 320 px wide without horizontal scrolling", async () => {
    const context = await browser.newContext({
      viewport: { width: 320, height: 640 },
    });
    const page = await context.newPage();
    try {
      await page.setContent(
        renderStatementHtml({
          ...base,
          samplePages: ["https://www.acme.fr/" + "a".repeat(120)],
          nonAccessible: [
            {
              criterionId: "1.1",
              title: "t".repeat(200),
              sources: ["manual"],
              notes: "n".repeat(300),
            },
          ],
        }),
      );

      const overflow = await page.evaluate(
        "document.documentElement.scrollWidth - document.documentElement.clientWidth",
      );

      expect(overflow).toBeLessThanOrEqual(0);
    } finally {
      await context.close();
    }
  });

  it("never breaks a column heading or a criterion number in the middle of a word", async () => {
    const context = await browser.newContext({
      viewport: { width: 900, height: 900 },
    });
    const page = await context.newPage();
    try {
      await page.setContent(renderStatementHtml(base));

      const broken = await page.evaluate(`(() => {
        const out = [];
        for (const cell of document.querySelectorAll("th")) {
          const range = document.createRange();
          range.selectNodeContents(cell);
          const lines = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
          const words = cell.textContent.trim().split(/\\s+/);
          // A single word on several lines was cut inside the word.
          if (words.length === 1 && lines.size > 1) out.push(cell.textContent.trim());
        }
        return out;
      })()`);

      expect(broken).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
