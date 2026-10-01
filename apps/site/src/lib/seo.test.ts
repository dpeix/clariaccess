import { describe, expect, it } from "vitest";
import {
  articleJsonLd,
  breadcrumbJsonLd,
  canonicalUrl,
  jsonLdScript,
  organizationJsonLd,
  pageTitle,
} from "./seo.js";

const SITE = "https://www.example.fr";

describe("canonicalUrl", () => {
  it("resolves paths against the site origin with a trailing slash", () => {
    expect(canonicalUrl("/guides/eaa", SITE)).toBe(
      "https://www.example.fr/guides/eaa/",
    );
    expect(canonicalUrl("/guides/eaa/", SITE)).toBe(
      "https://www.example.fr/guides/eaa/",
    );
  });

  it("handles the home page", () => {
    expect(canonicalUrl("/", SITE)).toBe("https://www.example.fr/");
  });

  it("ignores a base path or trailing slash on the site url", () => {
    expect(canonicalUrl("/a", "https://www.example.fr/")).toBe(
      "https://www.example.fr/a/",
    );
  });

  it("does not add a slash to file-like paths", () => {
    expect(canonicalUrl("/modele.txt", SITE)).toBe(
      "https://www.example.fr/modele.txt",
    );
  });

  it("drops query and fragment", () => {
    expect(canonicalUrl("/a/?utm_source=x#top", SITE)).toBe(
      "https://www.example.fr/a/",
    );
  });
});

describe("pageTitle", () => {
  it("appends the site name", () => {
    expect(pageTitle("Guide EAA", "Marque")).toBe("Guide EAA | Marque");
  });

  it("uses the site name alone when there is no page title", () => {
    expect(pageTitle(undefined, "Marque")).toBe("Marque");
  });
});

describe("jsonLdScript", () => {
  it("cannot close the script element from inside the data", () => {
    const out = jsonLdScript({ name: "</script><script>alert(1)</script>" });

    expect(out).not.toContain("</script>");
    expect(JSON.parse(out)).toEqual({
      name: "</script><script>alert(1)</script>",
    });
  });

  it("escapes the HTML comment opener and line separators", () => {
    const out = jsonLdScript({ a: "<!--", b: " " });

    expect(out).not.toContain("<!--");
    expect(out).not.toContain(" ");
  });
});

describe("json-ld builders", () => {
  it("builds an Organization", () => {
    expect(organizationJsonLd({ name: "Marque", url: SITE })).toEqual({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Marque",
      url: SITE,
    });
  });

  it("builds a BreadcrumbList with 1-based positions", () => {
    const list = breadcrumbJsonLd([
      { name: "Accueil", url: `${SITE}/` },
      { name: "Guides", url: `${SITE}/guides/` },
    ]);

    expect(list["@type"]).toBe("BreadcrumbList");
    expect(list.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Accueil", item: `${SITE}/` },
      {
        "@type": "ListItem",
        position: 2,
        name: "Guides",
        item: `${SITE}/guides/`,
      },
    ]);
  });

  it("builds an Article with dates and publisher", () => {
    const article = articleJsonLd({
      headline: "Guide EAA",
      description: "d",
      url: `${SITE}/guides/eaa/`,
      dateModified: "2026-10-01",
      publisher: "Marque",
    });

    expect(article).toMatchObject({
      "@type": "Article",
      headline: "Guide EAA",
      dateModified: "2026-10-01",
      mainEntityOfPage: `${SITE}/guides/eaa/`,
      publisher: { "@type": "Organization", name: "Marque" },
    });
  });
});
