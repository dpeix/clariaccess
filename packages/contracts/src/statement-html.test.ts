import { describe, expect, it } from "vitest";
import { MESSAGES_FR } from "./i18n.js";
import {
  renderStatementHtml,
  type PublicStatementView,
} from "./statement-html.js";

const view = (
  patch: Partial<PublicStatementView> = {},
): PublicStatementView => ({
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
  ],
  derogations: null,
  technologies: "HTML5, CSS3, JavaScript",
  testEnvironment: "Firefox 130 avec NVDA 2024",
  tools: "axe-core, Colour Contrast Analyser",
  samplePages: ["https://www.acme.fr/", "https://www.acme.fr/contact"],
  contactEmail: "accessibilite@acme.fr",
  contactUrl: "https://www.acme.fr/contact",
  pdfPath: "/d/abcdefghijklmnop/pdf",
  supersededBy: null,
  ...patch,
});

const html = (patch: Partial<PublicStatementView> = {}) =>
  renderStatementHtml(view(patch));

describe("document structure", () => {
  it("is a complete French page with a title naming the publisher", () => {
    const out = html();

    expect(out.startsWith("<!doctype html>")).toBe(true);
    expect(out).toContain('<html lang="fr">');
    expect(out).toContain('<meta charset="utf-8">');
    expect(out).toContain('<meta name="viewport"');
    expect(out).toContain(
      "<title>Déclaration d&#39;accessibilité – Acme SAS</title>",
    );
  });

  it("has a single h1, landmarks, and the sections of a statement as h2", () => {
    const out = html();

    expect(out.match(/<h1\b/g)).toHaveLength(1);
    expect(out).toMatch(/<main\b/);
    expect(out).toMatch(/<footer\b/);
    for (const key of [
      "statement.compliance.heading",
      "statement.results.heading",
      "statement.nonaccessible.heading",
      "statement.derogations.heading",
      "statement.establishment.heading",
      "statement.technologies.heading",
      "statement.environment.heading",
      "statement.tools.heading",
      "statement.sample.heading",
      "statement.contact.heading",
      "statement.recourse.heading",
    ] as const) {
      expect(out, key).toContain(
        `<h2>${MESSAGES_FR[key].replace(/'/g, "&#39;")}</h2>`,
      );
    }
  });

  it("loads no script, no external file and no font", () => {
    const out = html();

    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/<link\b/i);
    expect(out).not.toMatch(/<img\b/i);
    expect(out).not.toMatch(/\son[a-z]+=/i);
    expect(out).not.toMatch(/(src|href)="https?:\/\/(?!www\.acme\.fr)/);
  });
});

describe("what it states", () => {
  it("states the level in words, with the reference version, and the rate rounded down", () => {
    const out = html();

    expect(out).toContain(
      "est partiellement conforme avec le RGAA version 4.1",
    );
    expect(out).toContain("97 % des critères applicables");
    expect(out).toContain(
      "arrondi à l'entier inférieur".replace(/'/g, "&#39;"),
    );
    expect(out).toContain(
      "100 critère(s) conforme(s), 3 non conforme(s), 3 non applicable(s)",
    );
  });

  it.each([
    ["total", "est totalement conforme"],
    ["partiel", "est partiellement conforme"],
    ["non", "est non conforme"],
  ] as const)("says %s as '%s'", (declaredStatus, phrase) => {
    expect(html({ declaredStatus })).toContain(phrase);
  });

  it("does not print a rate it does not have", () => {
    expect(html({ rate: null })).not.toContain("% des critères");
  });

  it("dates the statement in the publisher's day (Paris), not in UTC", () => {
    // 00:30 in Paris on 2 October is still 1 October in UTC.
    expect(html({ publishedAt: "2026-10-01T22:30:00.000Z" })).toContain(
      "établie le 2 octobre 2026",
    );
    expect(html({ publishedAt: "2026-10-02T21:59:00.000Z" })).toContain(
      "établie le 2 octobre 2026",
    );
    expect(html({ publishedAt: "2026-10-02T22:01:00.000Z" })).toContain(
      "établie le 3 octobre 2026",
    );
  });

  it("dates the statement and gives its version", () => {
    const out = html();

    expect(out).toContain("établie le 2 octobre 2026");
    expect(out).toContain("Version 2 de la déclaration");
  });

  it("lists the non-accessible content in a table with a caption and column headers", () => {
    const out = html();

    expect(out).toMatch(/<table\b/);
    expect(out).toContain("<caption>");
    expect(out.match(/<th scope="col">/g)?.length).toBeGreaterThanOrEqual(3);
    expect(out).toContain('<th scope="row">');
    expect(out).toContain("1.1");
    expect(out).toContain("Vérification manuelle");
    expect(out).toContain("Test automatisé");
    expect(out).toContain("Le logo n&#39;a pas d&#39;alternative.");
  });

  it("says when there is nothing non-accessible, instead of an empty table", () => {
    const out = html({ nonAccessible: [], declaredStatus: "total", rate: 100 });

    expect(out).toContain("Aucun contenu non accessible");
    expect(out).not.toMatch(/<table\b/);
  });

  it("states derogations, or that none are invoked", () => {
    expect(html()).toContain("Aucune dérogation");
    expect(html({ derogations: "Le lecteur vidéo tiers." })).toContain(
      "Le lecteur vidéo tiers.",
    );
  });

  it("lists the technologies, environment, tools and the verified pages", () => {
    const out = html();

    expect(out).toContain("HTML5, CSS3, JavaScript");
    expect(out).toContain("Firefox 130 avec NVDA 2024");
    expect(out).toContain("axe-core, Colour Contrast Analyser");
    expect(out).toContain(
      '<a href="https://www.acme.fr/contact">https://www.acme.fr/contact</a>',
    );
  });

  it("gives the ways to reach the publisher, and the recourse", () => {
    const out = html();

    expect(out).toContain(
      '<a href="mailto:accessibilite@acme.fr">accessibilite@acme.fr</a>',
    );
    expect(out).toContain("Défenseur des droits");
    expect(out).toContain("Acme SAS");
  });

  it("offers the PDF when there is one", () => {
    expect(html()).toContain('<a href="/d/abcdefghijklmnop/pdf">');
    expect(html({ pdfPath: null })).not.toContain("/pdf");
  });
});

describe("a replaced version", () => {
  it("says so and points to the current one", () => {
    const out = html({ supersededBy: "/d/currentcurrentcu" });

    expect(out).toContain('<a href="/d/currentcurrentcu">');
    expect(out).toMatch(/remplacée|plus à jour/i);
  });

  it("says so even when no current one is known", () => {
    expect(html({ supersededBy: "" })).toMatch(/remplacée|plus à jour/i);
  });
});

describe("hostile content", () => {
  const evil = `<script>alert(1)</script><img src=x onerror=alert(1)>"'&`;

  it("escapes every field that comes from a person or from the audited site", () => {
    const out = html({
      entityName: evil,
      siteUrl: "https://acme.fr/?q=" + evil,
      derogations: evil,
      technologies: evil,
      testEnvironment: evil,
      tools: evil,
      nonAccessible: [
        { criterionId: evil, title: evil, sources: ["manual"], notes: evil },
      ],
      samplePages: ["https://acme.fr/" + evil],
      contactEmail: evil,
    });

    expect(out).not.toContain("<script>");
    expect(out).not.toMatch(/<img\b/);
    expect(out).not.toContain("onerror=alert(1)>");
    expect(out.match(/&lt;script&gt;/g)?.length).toBeGreaterThan(3);
  });

  it("never turns a non-http(s) address into a link", () => {
    const out = html({
      contactUrl: "javascript:alert(1)",
      contactEmail: null,
      samplePages: [
        "javascript:alert(2)",
        "data:text/html,x",
        "https://www.acme.fr/ok",
      ],
    });

    expect(out).not.toMatch(/href="javascript:/i);
    expect(out).not.toMatch(/href="data:/i);
    expect(out).toContain('<a href="https://www.acme.fr/ok">');
    // Shown as plain text, not dropped silently.
    expect(out).toContain("javascript:alert(2)");
  });

  it("does not let an email address break out of its link", () => {
    const out = html({ contactEmail: 'a@b.fr"><b>x</b>' });

    expect(out).not.toContain("<b>");
    expect(out).not.toMatch(/href="mailto:a@b.fr"/);
  });

  it("does not let a path break out of its link", () => {
    const out = html({
      pdfPath: '/d/x"><script>',
      supersededBy: '/d/y"><script>',
    });

    expect(out).not.toContain("<script>");
  });
});

describe("accessibility of the page itself", () => {
  it("keeps the text readable and the layout fluid", () => {
    const out = html();

    expect(out).toMatch(/color:\s*#1a1a1a/);
    expect(out).toMatch(/max-width/);
    expect(out).toContain("overflow-wrap");
    expect(out).toContain("white-space: pre-wrap");
  });
});
