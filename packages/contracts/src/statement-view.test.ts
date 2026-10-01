import { describe, expect, it } from "vitest";
import {
  toPublicView,
  type PublishedStatementInput,
} from "./statement-view.js";

const input = (
  patch: Partial<PublishedStatementInput> = {},
): PublishedStatementInput => ({
  status: "published",
  siteUrl: "https://acme.fr",
  version: 3,
  locale: "fr",
  entityName: "Acme",
  publishedAt: new Date("2026-10-02T09:00:00.000Z"),
  declaredStatus: "partiel",
  referentialVersion: "4.1",
  complianceRate: 90,
  snapshot: { counts: { conforme: 90, nonConforme: 10, na: 6, aVerifier: 0 } },
  nonAccessible: [
    { criterionId: "1.1", title: "t", sources: ["manual"], notes: "" },
  ],
  derogations: null,
  technologies: "HTML",
  testEnvironment: "Firefox",
  tools: "axe",
  samplePages: ["https://acme.fr/"],
  contactEmail: "a@acme.fr",
  contactUrl: null,
  slug: "abcdefghijkl",
  pdfReady: true,
  currentSlug: null,
  ...patch,
});

describe("toPublicView", () => {
  it("carries the frozen content of a published statement", () => {
    const view = toPublicView(input());

    expect(view).toMatchObject({
      locale: "fr",
      siteUrl: "https://acme.fr",
      entityName: "Acme",
      version: 3,
      declaredStatus: "partiel",
      rate: 90,
      referentialVersion: "4.1",
      counts: { conforme: 90, nonConforme: 10, na: 6, aVerifier: 0 },
      publishedAt: "2026-10-02T09:00:00.000Z",
      supersededBy: null,
    });
    expect(view.nonAccessible).toHaveLength(1);
  });

  it("offers the PDF only once it exists", () => {
    expect(toPublicView(input()).pdfPath).toBe("/d/abcdefghijkl/pdf");
    expect(toPublicView(input({ pdfReady: false })).pdfPath).toBeNull();
  });

  it("points a replaced version to the current one, or to nothing when unknown", () => {
    expect(
      toPublicView(
        input({ status: "superseded", currentSlug: "currentcurrent" }),
      ).supersededBy,
    ).toBe("/d/currentcurrent");
    expect(
      toPublicView(input({ status: "superseded", currentSlug: null }))
        .supersededBy,
    ).toBe("");
  });

  it("does not trust stored content: a bad language falls back, wrong types become empty", () => {
    const view = toPublicView(
      input({
        locale: "xx",
        samplePages: ["https://acme.fr/", 3 as never, null as never],
        nonAccessible: "nope" as never,
        entityName: null,
        technologies: null,
        snapshot: null,
      }),
    );

    expect(view.locale).toBe("fr");
    expect(view.samplePages).toEqual(["https://acme.fr/"]);
    expect(view.nonAccessible).toEqual([]);
    expect(view.entityName).toBe("");
    expect(view.technologies).toBe("");
    expect(view.counts).toEqual({
      conforme: 0,
      nonConforme: 0,
      na: 0,
      aVerifier: 0,
    });
  });
});
