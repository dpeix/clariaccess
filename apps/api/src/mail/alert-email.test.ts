import { describe, expect, it } from "vitest";
import { renderAlertEmail } from "./alert-email.js";
import type { AlertSummary } from "../alerts/summary.js";

const summary: AlertSummary = {
  regressions: 2,
  newSevere: 1,
  top: [
    {
      ruleId: "image-alt",
      impact: "critical",
      pageUrl: "https://acme.example/produits",
      message: "Images must have alternate text",
      kind: "regression",
      count: 4,
    },
    {
      ruleId: "button-name",
      impact: "serious",
      pageUrl: "https://acme.example/",
      message: "Buttons must have discernible text",
      kind: "new",
      count: 1,
    },
  ],
};
const link =
  "https://app.example.fr/audits/6f1c1c1e-5d3b-4c9e-8a57-0b1f2a3c4d5e";

describe("renderAlertEmail", () => {
  it("has a fixed subject, so nothing from the site reaches a header", () => {
    expect(
      renderAlertEmail("https://evil\r\nBcc: x@y.z", summary, link).subject,
    ).toBe("Alerte d'accessibilité : nouveaux problèmes détectés");
  });

  it("says what changed and links to the audit", () => {
    const { text, html } = renderAlertEmail(
      "https://acme.example",
      summary,
      link,
    );

    expect(text).toContain("2 régressions");
    expect(text).toContain("1 nouveau problème sérieux ou critique");
    expect(text).toContain(link);
    expect(text).toContain("image-alt");
    expect(text).toContain("https://acme.example/produits");
    expect(html).toContain(`href="${link}"`);
  });

  it("says how many elements a line covers, only when there are several", () => {
    const { text } = renderAlertEmail("https://acme.example", summary, link);

    expect(text).toContain(
      "image-alt · https://acme.example/produits (4 éléments)",
    );
    expect(text).toContain("button-name · https://acme.example/\n");
    expect(text).not.toContain("button-name · https://acme.example/ (");
  });

  it("uses the singular and omits a category with nothing in it", () => {
    const { text } = renderAlertEmail(
      "https://acme.example",
      { ...summary, regressions: 1, newSevere: 0 },
      link,
    );

    expect(text).toContain("1 régression");
    expect(text).not.toContain("1 régressions");
    expect(text).not.toMatch(/nouveau.*problème/);
  });

  it("escapes what comes from the audited site in html", () => {
    const { html } = renderAlertEmail(
      "https://acme.example",
      {
        ...summary,
        top: [
          {
            ...summary.top[0]!,
            pageUrl: 'https://x.example/"><script>alert(1)</script>',
            message: "<img src=x onerror=alert(1)>",
          },
        ],
      },
      link,
    );

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
  });

  it("reminds that an automated audit is not a conformity statement", () => {
    expect(
      renderAlertEmail("https://acme.example", summary, link).text,
    ).toMatch(/automatis/i);
  });
});
